#!/usr/bin/env python3
"""Compatibility and safety checks for qingyu_warehouse upstream sync."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

ID_PATTERN = re.compile(r'- id:\s*"([^"]+)"')
FOLDER_PATTERN = re.compile(r'resource_folder:\s*"([^"]+)"')

# Never checkout these from upstream — Qingyu-only surfaces.
PROTECTED_PATH_PREFIXES: tuple[str, ...] = (
    "tools/",
    "docs/",
    "proto/",
    "scripts/",
    ".github/",
    "CONTRIBUTING.md",
    "README.md",
    ".gitignore",
)

SUPPORTED_ANDROID_BRIDGE = frozenset({"showToast", "notifyTaskCompletion"})
SUPPORTED_ANDROID_BRIDGE_PROMISE = frozenset(
    {
        "showAlert",
        "showPrompt",
        "showSingleSelection",
        "saveImportedCourses",
        "savePresetTimeSlots",
        "saveCourseConfig",
    }
)

UNSUPPORTED_BRIDGE_MARKERS: tuple[tuple[str, str], ...] = (
    (
        r"AndroidBridgePromise\.showConfirmDialog\s*\(",
        "使用了轻屿未实现的 AndroidBridgePromise.showConfirmDialog（时光课表专有）",
    ),
    (
        r"ShiguangBridge",
        "引用了 ShiguangBridge（非轻屿桥接）",
    ),
    (
        r"WakeupBridge",
        "引用了 WakeupBridge（非轻屿桥接）",
    ),
)

ADAPTERS_REQUIRED_KEYS = (
    "adapter_id",
    "adapter_name",
    "asset_js_path",
)


@dataclass
class ValidationIssue:
    level: str  # "blocking" | "warning"
    code: str
    message: str
    path: str = ""


@dataclass
class ValidationReport:
    blocking: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)
    upstream_script_updates: list[tuple[str, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.blocking

    def merge(self, other: ValidationReport) -> None:
        self.blocking.extend(other.blocking)
        self.warnings.extend(other.warnings)
        self.upstream_script_updates.extend(other.upstream_script_updates)


def parse_index_maps(yaml_text: str) -> tuple[set[str], dict[str, str]]:
    ids: set[str] = set()
    id_to_folder: dict[str, str] = {}
    current_id: str | None = None

    for raw_line in yaml_text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        id_match = ID_PATTERN.search(stripped)
        if stripped.startswith("- id:") and id_match:
            current_id = id_match.group(1)
            ids.add(current_id)
            continue

        if current_id is None:
            continue

        folder_match = FOLDER_PATTERN.search(stripped)
        if stripped.startswith("resource_folder:") and folder_match:
            id_to_folder[current_id] = folder_match.group(1)

    return ids, id_to_folder


def validate_protected_paths(checkout_paths: list[str]) -> ValidationReport:
    report = ValidationReport()
    for path in checkout_paths:
        normalized = path.replace("\\", "/")
        for protected in PROTECTED_PATH_PREFIXES:
            if normalized == protected.rstrip("/") or normalized.startswith(protected):
                report.blocking.append(
                    ValidationIssue(
                        level="blocking",
                        code="protected_path",
                        message=f"同步路径触及轻屿保护目录/文件，已拒绝：{normalized}",
                        path=normalized,
                    )
                )
    return report


def validate_index_compatibility(local_yaml: str, upstream_yaml: str) -> ValidationReport:
    report = ValidationReport()
    local_ids, local_map = parse_index_maps(local_yaml)
    upstream_ids, upstream_map = parse_index_maps(upstream_yaml)

    local_only = sorted(local_ids - upstream_ids)
    for school_id in local_only:
        report.blocking.append(
            ValidationIssue(
                level="blocking",
                code="local_only_school",
                message=(
                    f"轻屿索引含上游不存在的学校 {school_id}；"
                    "整表替换会破坏本地环境，需人工合并"
                ),
                path=f"index/root_index.yaml#{school_id}",
            )
        )

    for school_id in sorted(local_ids & upstream_ids):
        local_folder = local_map.get(school_id, "")
        upstream_folder = upstream_map.get(school_id, "")
        if local_folder and upstream_folder and local_folder != upstream_folder:
            report.blocking.append(
                ValidationIssue(
                    level="blocking",
                    code="resource_folder_changed",
                    message=(
                        f"学校 {school_id} 的 resource_folder 上游已变更 "
                        f"({local_folder} -> {upstream_folder})，可能破坏现有导入路径"
                    ),
                    path=f"resources/{local_folder}",
                )
            )

    return report


def _parse_adapters_yaml(text: str) -> list[dict[str, str]]:
    adapters: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    key_pattern = re.compile(r"^(\w+):\s*\"?([^\"#]+?)\"?\s*(?:#.*)?$")

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- adapter_id:"):
            if current:
                adapters.append(current)
            match = key_pattern.match(stripped.removeprefix("- ").strip())
            current = {"adapter_id": match.group(2).strip() if match else ""}
            continue
        if current is None:
            continue
        match = key_pattern.match(stripped)
        if match:
            current[match.group(1)] = match.group(2).strip()
    if current:
        adapters.append(current)
    return adapters


def validate_adapter_folder(folder: Path, school_id: str) -> ValidationReport:
    report = ValidationReport()
    adapters_path = folder / "adapters.yaml"
    if not adapters_path.is_file():
        report.blocking.append(
            ValidationIssue(
                level="blocking",
                code="missing_adapters_yaml",
                message=f"{school_id} 缺少 adapters.yaml",
                path=str(adapters_path),
            )
        )
        return report

    adapters = _parse_adapters_yaml(adapters_path.read_text(encoding="utf-8"))
    if not adapters:
        report.blocking.append(
            ValidationIssue(
                level="blocking",
                code="empty_adapters_yaml",
                message=f"{school_id} 的 adapters.yaml 未解析到任何适配器",
                path=str(adapters_path),
            )
        )
        return report

    for adapter in adapters:
        for key in ADAPTERS_REQUIRED_KEYS:
            if not adapter.get(key):
                report.blocking.append(
                    ValidationIssue(
                        level="blocking",
                        code="adapter_field_missing",
                        message=f"{school_id} 适配器缺少字段 {key}",
                        path=str(adapters_path),
                    )
                )
        asset = adapter.get("asset_js_path", "")
        script_path = folder / asset
        if not asset or not script_path.is_file():
            report.blocking.append(
                ValidationIssue(
                    level="blocking",
                    code="missing_adapter_script",
                    message=f"{school_id} 缺少脚本 {asset}",
                    path=str(script_path),
                )
            )
            continue
        report.merge(validate_adapter_script(script_path, school_id, adapter.get("adapter_id", "")))

    return report


def validate_adapter_script(script_path: Path, school_id: str, adapter_id: str) -> ValidationReport:
    report = ValidationReport()
    text = script_path.read_text(encoding="utf-8")

    for pattern, reason in UNSUPPORTED_BRIDGE_MARKERS:
        if re.search(pattern, text):
            report.blocking.append(
                ValidationIssue(
                    level="blocking",
                    code="unsupported_bridge",
                    message=f"{school_id}/{adapter_id}: {reason}",
                    path=str(script_path),
                )
            )

    bridge_calls = set(re.findall(r"AndroidBridgePromise\.(\w+)", text))
    bridge_calls.update(re.findall(r"AndroidBridge\.(\w+)", text))

    for method in bridge_calls:
        if method in SUPPORTED_ANDROID_BRIDGE or method in SUPPORTED_ANDROID_BRIDGE_PROMISE:
            continue
        report.blocking.append(
            ValidationIssue(
                level="blocking",
                code="unknown_bridge_method",
                message=(
                    f"{school_id}/{adapter_id}: 调用了轻屿未实现的桥接方法 "
                    f"{method}"
                ),
                path=str(script_path),
            )
        )

    if "saveImportedCourses" not in text:
        report.warnings.append(
            ValidationIssue(
                level="warning",
                code="missing_save_import",
                message=f"{school_id}/{adapter_id}: 脚本未调用 saveImportedCourses，导入可能无法完成",
                path=str(script_path),
            )
        )

    if "notifyTaskCompletion" not in text:
        report.warnings.append(
            ValidationIssue(
                level="warning",
                code="missing_notify_complete",
                message=f"{school_id}/{adapter_id}: 脚本未调用 notifyTaskCompletion",
                path=str(script_path),
            )
        )

    return report


def find_upstream_script_updates(
    warehouse_dir: Path,
    local_ids: set[str],
    id_to_folder: dict[str, str],
    upstream_ref: str,
) -> list[tuple[str, str]]:
    updated: list[tuple[str, str]] = []
    for school_id in sorted(local_ids):
        folder = id_to_folder.get(school_id)
        if not folder:
            continue
        result = subprocess.run(
            [
                "git",
                "diff",
                "--quiet",
                "HEAD",
                upstream_ref,
                "--",
                f"resources/{folder}",
            ],
            cwd=warehouse_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode == 1:
            updated.append((school_id, folder))
    return updated


def validate_sync_plan(
    *,
    local_yaml: str,
    upstream_yaml: str,
    checkout_paths: list[str],
    warehouse_dir: Path | None = None,
    upstream_ref: str = "upstream/main",
    validate_scripts: bool = False,
    school_ids: list[str] | None = None,
    id_to_folder: dict[str, str] | None = None,
) -> ValidationReport:
    report = ValidationReport()
    report.merge(validate_protected_paths(checkout_paths))
    report.merge(validate_index_compatibility(local_yaml, upstream_yaml))

    if warehouse_dir and id_to_folder:
        local_ids, local_map = parse_index_maps(local_yaml)
        report.upstream_script_updates = find_upstream_script_updates(
            warehouse_dir,
            local_ids,
            local_map,
            upstream_ref,
        )

    if validate_scripts and warehouse_dir and school_ids and id_to_folder:
        for school_id in school_ids:
            folder = id_to_folder.get(school_id)
            if not folder:
                continue
            report.merge(
                validate_adapter_folder(
                    warehouse_dir / "resources" / folder,
                    school_id,
                )
            )

    return report


def format_report(report: ValidationReport) -> str:
    lines: list[str] = []
    if report.blocking:
        lines.append("BLOCKING:")
        for issue in report.blocking:
            suffix = f" ({issue.path})" if issue.path else ""
            lines.append(f"  [{issue.code}] {issue.message}{suffix}")
    if report.warnings:
        lines.append("WARNINGS:")
        for issue in report.warnings:
            suffix = f" ({issue.path})" if issue.path else ""
            lines.append(f"  [{issue.code}] {issue.message}{suffix}")
    if report.upstream_script_updates:
        lines.append("UPSTREAM_UPDATES_NOT_SYNCED:")
        for school_id, folder in report.upstream_script_updates:
            lines.append(f"  - {school_id} -> resources/{folder}")
    return "\n".join(lines)
