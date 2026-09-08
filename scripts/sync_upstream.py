#!/usr/bin/env python3
"""Sync qingyu_warehouse from upstream shiguang_warehouse with compatibility checks.

索引更新采用条目级合并：检出上游 root_index.yaml 后，剔除被隔离学校的条目、
插回本地独有学校条目（按 initial 分组），并在落盘前校验合并结果，
保证整表替换不会丢失本地学校（merge_index_after_checkout）。
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from warehouse_upstream_compat import (
    ValidationIssue,
    ValidationReport,
    apply_v2_bridge_shim,
    find_upstream_script_updates,
    format_report,
    parse_adapters_asset_paths,
    parse_index_maps,
    validate_adapter_folder,
    validate_sync_plan,
)

UPSTREAM_REMOTE = "upstream"
UPSTREAM_REPO = "https://github.com/XingHeYuZhuan/shiguang_warehouse.git"
UPSTREAM_BRANCH = "main"
UPSTREAM_REF = f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"
ORIGIN_BRANCH = "main"
ID_PATTERN = re.compile(r'- id:\s*"([^"]+)"')


@dataclass
class SyncPlan:
    upstream_only: list[str]
    local_only: list[str]
    id_to_folder: dict[str, str]
    index_changed: bool
    resource_paths: list[str]
    refresh_schools: list[str] = field(default_factory=list)

    @property
    def validated_schools(self) -> list[str]:
        """预检/落盘校验需要覆盖的学校集合。"""
        return self.upstream_only + self.refresh_schools

    @property
    def touched_folders(self) -> list[str]:
        """本次实际落盘的资源目录（去重、保持顺序）。"""
        folders: list[str] = []
        for school_id in self.validated_schools:
            folder = self.id_to_folder.get(school_id)
            if folder and folder not in folders:
                folders.append(folder)
        return folders


def run_git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed ({result.returncode}):\n{result.stderr.strip()}"
        )
    return result


def read_upstream_index(warehouse_dir: Path) -> str:
    return run_git(
        ["show", f"{UPSTREAM_REF}:index/root_index.yaml"],
        warehouse_dir,
    ).stdout


def read_upstream_file(warehouse_dir: Path, relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/")
    return run_git(
        ["show", f"{UPSTREAM_REF}:{normalized}"],
        warehouse_dir,
    ).stdout


def parse_asset_js_path(line: str) -> str | None:
    """Parse an ``asset_js_path`` YAML scalar without treating comments as data."""
    stripped = line.strip()
    if not stripped.startswith("asset_js_path:"):
        return None

    value = stripped.split(":", 1)[1].strip()
    if not value:
        return None

    try:
        fields = shlex.split(value, comments=True, posix=True)
    except ValueError as exc:
        raise ValueError(f"Invalid asset_js_path value: {value!r}") from exc

    if not fields:
        return None
    if len(fields) != 1:
        raise ValueError(f"Expected one asset_js_path value, got: {value!r}")
    return fields[0]


def ensure_upstream_remote(warehouse_dir: Path) -> None:
    remotes = run_git(["remote"], warehouse_dir).stdout.splitlines()
    if UPSTREAM_REMOTE in remotes:
        return
    run_git(["remote", "add", UPSTREAM_REMOTE, UPSTREAM_REPO], warehouse_dir)


def fetch_remotes(warehouse_dir: Path) -> None:
    ensure_upstream_remote(warehouse_dir)
    run_git(["fetch", "origin", ORIGIN_BRANCH], warehouse_dir)
    run_git(["fetch", UPSTREAM_REMOTE, UPSTREAM_BRANCH], warehouse_dir)


def build_plan(warehouse_dir: Path, *, refresh_existing: bool = False) -> SyncPlan:
    local_yaml = (warehouse_dir / "index" / "root_index.yaml").read_text(encoding="utf-8")
    upstream_yaml = read_upstream_index(warehouse_dir)

    local_ids, local_map = parse_index_maps(local_yaml)
    upstream_ids, upstream_map = parse_index_maps(upstream_yaml)

    upstream_only = sorted(upstream_ids - local_ids)
    local_only = sorted(local_ids - upstream_ids)
    index_changed = local_yaml != upstream_yaml

    resource_paths: list[str] = []
    if index_changed:
        resource_paths.append("index/root_index.yaml")

    for school_id in upstream_only:
        folder = upstream_map.get(school_id)
        if not folder:
            raise RuntimeError(f"Missing resource_folder for upstream school id {school_id}")
        resource_paths.append(f"resources/{folder}")

    refresh_schools: list[str] = []
    if refresh_existing:
        changed = find_upstream_script_updates(
            warehouse_dir,
            local_ids & upstream_ids,
            {**upstream_map, **local_map},
            UPSTREAM_REF,
        )
        refresh_schools = [school_id for school_id, _folder in changed]
        for school_id in refresh_schools:
            folder = local_map.get(school_id) or upstream_map.get(school_id)
            path = f"resources/{folder}" if folder else None
            if path and path not in resource_paths:
                resource_paths.append(path)

    return SyncPlan(
        upstream_only=upstream_only,
        local_only=local_only,
        id_to_folder=upstream_map,
        index_changed=index_changed,
        resource_paths=resource_paths,
        refresh_schools=refresh_schools,
    )


def validate_upstream_scripts_in_staging(
    warehouse_dir: Path,
    school_ids: list[str],
    id_to_folder: dict[str, str],
) -> tuple[ValidationReport, dict[str, ValidationReport]]:
    report = ValidationReport()
    per_school: dict[str, ValidationReport] = {}
    with tempfile.TemporaryDirectory(prefix="warehouse-sync-") as tmp:
        staging = Path(tmp)
        for school_id in school_ids:
            folder = id_to_folder[school_id]
            rel_folder = f"resources/{folder}"
            target = staging / "resources" / folder
            target.mkdir(parents=True, exist_ok=True)

            adapters_text = read_upstream_file(warehouse_dir, f"{rel_folder}/adapters.yaml")

            # 多适配器学校的每个 asset_js_path 都要暂存；
            # 上游允许声明未提交的占位脚本（如 GLOBAL_TOOLS/test.js），
            # 此类文件跳过读取，并在暂存的 adapters.yaml 副本中剔除该适配器。
            available: set[str] = set()
            missing: set[str] = set()
            for line in adapters_text.splitlines():
                stripped = line.strip()
                if not stripped.startswith("asset_js_path:"):
                    continue
                asset = parse_asset_js_path(stripped)
                if not asset:
                    continue
                rel_asset = f"{rel_folder}/{asset}"
                if upstream_file_exists(warehouse_dir, rel_asset):
                    script_text = read_upstream_file(warehouse_dir, rel_asset)
                    (target / asset).write_text(script_text, encoding="utf-8")
                    available.add(asset)
                else:
                    missing.add(asset)

            if missing:
                (target / "adapters.yaml").write_text(
                    filter_adapters_yaml_blocks(adapters_text, missing),
                    encoding="utf-8",
                )
                report.warnings.append(
                    ValidationIssue(
                        level="warning",
                        code="upstream_placeholder_asset",
                        message=(
                            f"{school_id}: 上游声明的脚本不存在（占位），已跳过: "
                            + ", ".join(sorted(missing))
                        ),
                        path=rel_folder,
                    )
                )
            else:
                (target / "adapters.yaml").write_text(adapters_text, encoding="utf-8")

            school_report = validate_adapter_folder(
                target,
                school_id,
                allow_missing_assets=True,
            )
            per_school[school_id] = school_report
            report.merge(school_report)
    return report, per_school


def run_validation(
    warehouse_dir: Path,
    plan: SyncPlan,
    *,
    pre_checkout: bool,
) -> ValidationReport:
    local_yaml = (warehouse_dir / "index" / "root_index.yaml").read_text(encoding="utf-8")
    upstream_yaml = read_upstream_index(warehouse_dir)

    report = validate_sync_plan(
        local_yaml=local_yaml,
        upstream_yaml=upstream_yaml,
        checkout_paths=plan.resource_paths,
        warehouse_dir=warehouse_dir,
        upstream_ref=UPSTREAM_REF,
        validate_scripts=not pre_checkout,
        school_ids=plan.validated_schools,
        id_to_folder=plan.id_to_folder,
    )

    if pre_checkout and plan.validated_schools:
        script_report, per_school = validate_upstream_scripts_in_staging(
            warehouse_dir,
            plan.validated_schools,
            plan.id_to_folder,
        )
        report.merge(script_report)
        report.per_school_reports = per_school

    return report


def print_validation_report(report: ValidationReport) -> None:
    text = format_report(report)
    if text:
        print(text)


def quarantine_blocked_schools(
    plan: SyncPlan,
    per_school_reports: dict[str, ValidationReport],
    *,
    enabled: bool,
) -> dict[str, str]:
    """把预检存在阻断项的学校就地移出同步计划，返回「学校 -> 错误码」映射。

    隔离后这些学校的资源目录不会被检出，本地保持现状；
    其余学校照常走检出、垫片、校验、提交流程。
    """
    if not enabled or not per_school_reports:
        return {}
    blocked = {
        sid: ", ".join(sorted({issue.code for issue in rep.blocking}))
        for sid, rep in per_school_reports.items()
        if rep.blocking
    }
    if not blocked:
        return {}
    blocked_ids = set(blocked)
    plan.upstream_only = [s for s in plan.upstream_only if s not in blocked_ids]
    plan.refresh_schools = [s for s in plan.refresh_schools if s not in blocked_ids]
    keep_folders = {
        plan.id_to_folder.get(s) for s in plan.validated_schools
    } - {None}
    plan.resource_paths = [
        p
        for p in plan.resource_paths
        if p == "index/root_index.yaml"
        or p.replace("\\", "/").removeprefix("resources/") in keep_folders
    ]
    return blocked


def drop_school_issues(
    report: ValidationReport,
    folders: set[str],
) -> None:
    """从聚合报告中剔除指定资源目录学校的阻断/警告项。"""
    markers = tuple(f"/resources/{folder}/" for folder in folders)

    def _hit(path: str) -> bool:
        normalized = path.replace("\\", "/")
        return any(marker in normalized for marker in markers)

    report.blocking = [issue for issue in report.blocking if not _hit(issue.path)]
    report.warnings = [issue for issue in report.warnings if not _hit(issue.path)]


def upstream_file_exists(warehouse_dir: Path, relative_path: str) -> bool:
    normalized = relative_path.replace("\\", "/")
    result = run_git(
        ["cat-file", "-e", f"{UPSTREAM_REF}:{normalized}"],
        warehouse_dir,
        check=False,
    )
    return result.returncode == 0


def filter_adapters_yaml_blocks(yaml_text: str, drop_assets: set[str]) -> str:
    """按适配器块过滤 adapters.yaml 文本：丢弃 asset_js_path 命中项的整块。"""
    if not drop_assets:
        return yaml_text

    kept_lines: list[str] = []
    block: list[str] | None = None
    dropped_current = False

    def _flush() -> None:
        nonlocal block, dropped_current
        if block is not None and not dropped_current:
            kept_lines.extend(block)
        block = None
        dropped_current = False

    for line in yaml_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- adapter_id:"):
            _flush()
            block = [line]
            continue
        if block is None:
            kept_lines.append(line)
            continue
        block.append(line)
        if stripped.startswith("asset_js_path:"):
            asset = parse_asset_js_path(stripped)
            if asset is not None and asset in drop_assets:
                dropped_current = True
    _flush()

    text = "\n".join(kept_lines)
    if yaml_text.endswith("\n") and not text.endswith("\n"):
        text += "\n"
    return text


def checkout_upstream_paths(warehouse_dir: Path, paths: list[str]) -> None:
    if not paths:
        return
    run_git(["checkout", UPSTREAM_REF, "--", *paths], warehouse_dir)


def _strip_trailing_blank_lines(lines: list[str]) -> list[str]:
    end = len(lines)
    while end > 0 and not lines[end - 1].strip():
        end -= 1
    return lines[:end]


def extract_school_blocks(yaml_text: str, school_ids: list[str]) -> dict[str, list[str]]:
    """从索引文本提取指定学校条目的行块（不含块尾空行），保持原有顺序。"""
    wanted = set(school_ids)
    blocks: dict[str, list[str]] = {}
    current_id: str | None = None
    block: list[str] | None = None

    def _flush() -> None:
        nonlocal current_id, block
        if current_id in wanted and block:
            blocks[current_id] = _strip_trailing_blank_lines(block)
        current_id = None
        block = None

    for line in yaml_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- id:"):
            _flush()
            match = ID_PATTERN.search(stripped)
            current_id = match.group(1) if match else None
            block = [line]
        elif block is None:
            continue
        elif line and not line[0].isspace():
            # 顶层键/注释：schools 列表结束
            _flush()
        else:
            block.append(line)
    _flush()
    return blocks


def remove_school_blocks(yaml_text: str, school_ids: list[str]) -> str:
    """从索引文本删除指定学校条目块，并保持条目间恰好一个空行分隔。"""
    if not school_ids:
        return yaml_text
    drop = set(school_ids)
    kept: list[str] = []
    skipping = False
    for line in yaml_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- id:"):
            match = ID_PATTERN.search(stripped)
            will_skip = bool(match and match.group(1) in drop)
            if will_skip:
                while kept and not kept[-1].strip():
                    kept.pop()
            else:
                if skipping and kept and kept[-1].strip():
                    kept.append("")
                kept.append(line)
            skipping = will_skip
            continue
        if skipping:
            continue
        kept.append(line)
    text = "\n".join(kept)
    if yaml_text.endswith("\n") and not text.endswith("\n"):
        text += "\n"
    return text


def _initial_of_block(block: list[str]) -> str:
    for line in block:
        stripped = line.strip()
        if stripped.startswith("initial:"):
            return stripped.split(":", 1)[1].strip().strip('"')
    return ""


def _entry_initials(lines: list[str]) -> dict[int, str]:
    """返回 {条目起始行号: initial}，按文件顺序。"""
    initials: dict[int, str] = {}
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("- id:"):
            continue
        initial = ""
        for follow in lines[i + 1 : i + 6]:
            follow_stripped = follow.strip()
            if follow_stripped.startswith("- id:"):
                break
            if follow_stripped.startswith("initial:"):
                initial = follow_stripped.split(":", 1)[1].strip().strip('"')
                break
        initials[i] = initial
    return initials


def merge_school_blocks_into_index(upstream_text: str, blocks: dict[str, list[str]]) -> str:
    """把本地独有学校条目插回索引文本：同 initial 组插到组内首位，缺组则追加末尾。"""
    if not blocks:
        return upstream_text
    lines = upstream_text.splitlines()
    for block in blocks.values():
        initial = _initial_of_block(block)
        target = next(
            (idx for idx, ini in _entry_initials(lines).items() if ini == initial),
            None,
        )
        if target is None:
            if lines and lines[-1].strip():
                lines.extend(["", *block])
            else:
                lines.extend(block)
        else:
            lines[target:target] = [*block, ""]
    text = "\n".join(lines)
    if upstream_text.endswith("\n") and not text.endswith("\n"):
        text += "\n"
    return text


def merge_index_after_checkout(
    warehouse_dir: Path,
    pre_checkout_text: str,
    local_only: list[str],
    drop_ids: list[str],
) -> tuple[bool, str]:
    """检出上游索引后做条目级合并并校验，返回 (是否成功, 失败说明)。

    - 剔除被隔离学校的条目，避免索引引用未落盘的资源目录（同时让其可被后续同步重试）；
    - 插回本地独有学校条目，保证整表替换不丢本地学校；
    - 落盘前用 parse_index_maps 校验：本地学校一个不能少、resource_folder 不能被改。
    """
    index_path = warehouse_dir / "index" / "root_index.yaml"
    merged_text = index_path.read_text(encoding="utf-8")
    merged_text = remove_school_blocks(merged_text, drop_ids)

    local_blocks = extract_school_blocks(pre_checkout_text, local_only)
    missing = [sid for sid in local_only if sid not in local_blocks]
    if missing:
        return False, f"本地索引无法提取学校条目: {', '.join(missing)}"
    merged_text = merge_school_blocks_into_index(merged_text, local_blocks)

    merged_ids, merged_folders = parse_index_maps(merged_text)
    _, pre_folders = parse_index_maps(pre_checkout_text)
    lost = [sid for sid in local_only if sid not in merged_ids]
    hijacked = [
        sid
        for sid in local_only
        if sid in merged_ids and pre_folders.get(sid) != merged_folders.get(sid)
    ]
    not_dropped = [sid for sid in drop_ids if sid in merged_ids]
    problems: list[str] = []
    if lost:
        problems.append(f"丢失本地学校: {', '.join(lost)}")
    if hijacked:
        problems.append(f"resource_folder 被改动: {', '.join(hijacked)}")
    if not_dropped:
        problems.append(f"隔离学校仍留在索引: {', '.join(not_dropped)}")
    if problems:
        return False, "；".join(problems)

    index_path.write_text(merged_text, encoding="utf-8", newline="\n")
    return True, ""


def apply_v2_bridge_shims_to_folders(warehouse_dir: Path, folders: list[str]) -> int:
    """对本次落盘的适配脚本前置 v2->v1 兼容垫片，返回修改文件数。

    必须在 post-checkout 校验之前调用，保证校验与提交的都是最终字节。
    """
    applied = 0
    for folder in folders:
        rel_folder = warehouse_dir / "resources" / folder
        adapters_path = rel_folder / "adapters.yaml"
        if not adapters_path.is_file():
            continue
        assets = parse_adapters_asset_paths(adapters_path.read_text(encoding="utf-8"))
        for asset in assets:
            script_path = rel_folder / asset
            if not script_path.is_file():
                continue
            new_text, did_apply = apply_v2_bridge_shim(script_path.read_text(encoding="utf-8"))
            if did_apply:
                script_path.write_text(new_text, encoding="utf-8", newline="\n")
                applied += 1
    return applied


def ensure_git_identity(warehouse_dir: Path) -> None:
    name = os.environ.get("GIT_AUTHOR_NAME", "github-actions[bot]")
    email = os.environ.get(
        "GIT_AUTHOR_EMAIL",
        "41898282+github-actions[bot]@users.noreply.github.com",
    )
    run_git(["config", "user.name", name], warehouse_dir)
    run_git(["config", "user.email", email], warehouse_dir)


def commit_if_needed(
    warehouse_dir: Path,
    school_ids: list[str],
    staged_paths: list[str],
    dry_run: bool,
    refresh_count: int = 0,
    quarantine_note: str = "",
) -> str | None:
    if not staged_paths:
        return None

    status = run_git(
        ["status", "--porcelain", "--", *staged_paths],
        warehouse_dir,
    ).stdout.strip()
    if not status:
        return None

    if dry_run:
        return "dry-run"

    ensure_git_identity(warehouse_dir)
    names = ", ".join(school_ids) if school_ids else "index"
    message = (
        "sync: 从上游同步教务适配更新\n\n"
        f"新增学校: {names if school_ids else '无（仅索引/脚本更新）'}\n"
        + (
            f"刷新既有学校: {refresh_count} 个（已自动前置 v2 桥接兼容垫片）\n"
            if refresh_count
            else ""
        )
        + (
            f"隔离不兼容学校: {quarantine_note}\n"
            if quarantine_note
            else ""
        )
        + "来源: shiguang_warehouse/main"
    )
    run_git(["add", "--", *staged_paths], warehouse_dir)
    run_git(["commit", "-m", message], warehouse_dir)
    return run_git(["rev-parse", "--short", "HEAD"], warehouse_dir).stdout.strip()


def push_if_needed(warehouse_dir: Path, dry_run: bool, no_push: bool, committed: str | None) -> None:
    if committed is None or no_push or dry_run:
        return
    run_git(["push", "origin", ORIGIN_BRANCH], warehouse_dir)


def lookup_names(yaml_text: str, school_ids: list[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    current_id: str | None = None
    for raw_line in yaml_text.splitlines():
        stripped = raw_line.strip()
        id_match = ID_PATTERN.search(stripped)
        if stripped.startswith("- id:") and id_match:
            current_id = id_match.group(1)
            continue
        if current_id in school_ids and stripped.startswith("name:"):
            value = stripped.split(":", 1)[1].strip().strip('"')
            names[current_id] = value
    return names


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warehouse-dir",
        type=Path,
        default=repo_root,
        help="qingyu_warehouse repository root (default: parent of scripts/)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Plan and validate only")
    parser.add_argument("--no-push", action="store_true", help="Commit locally but do not push")
    parser.add_argument(
        "--ignore-warnings",
        action="store_true",
        help="Proceed when only warnings remain (blocking issues still abort)",
    )
    parser.add_argument(
        "--refresh-existing",
        action="store_true",
        help="同时同步上游已修改的既有学校脚本；落盘前自动前置 v2 桥接兼容垫片",
    )
    parser.add_argument(
        "--no-quarantine",
        action="store_true",
        help="关闭隔离机制：任一学校不兼容即整体中止（旧行为）",
    )
    args = parser.parse_args()

    warehouse_dir = args.warehouse_dir.resolve()
    scripts_dir = str(warehouse_dir / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)

    if not (warehouse_dir / ".git").is_dir():
        print(f"Not a git repository: {warehouse_dir}", file=sys.stderr)
        return 2

    print(f"[1/6] Warehouse repo: {warehouse_dir}")

    print("[2/6] Fetch origin + upstream")
    fetch_remotes(warehouse_dir)

    print("[3/6] Build sync plan")
    plan = build_plan(warehouse_dir, refresh_existing=args.refresh_existing)
    upstream_yaml = read_upstream_index(warehouse_dir)
    school_names = lookup_names(upstream_yaml, plan.upstream_only)

    if not plan.resource_paths:
        print("Already in sync with upstream (no new schools or index drift).")
    else:
        print(
            f"Plan: index_changed={plan.index_changed}, "
            f"new_schools={len(plan.upstream_only)}, "
            f"refresh_existing={len(plan.refresh_schools)}"
        )
        for school_id in plan.upstream_only:
            print(f"  + {school_id} {school_names.get(school_id, '')}")
        for school_id in plan.refresh_schools:
            print(f"  ~ {school_id} (refresh existing scripts)")

    print("[4/6] Pre-sync compatibility validation")
    pre_report = run_validation(warehouse_dir, plan, pre_checkout=True)

    quarantined_codes = quarantine_blocked_schools(
        plan,
        pre_report.per_school_reports,
        enabled=not args.no_quarantine,
    )
    if quarantined_codes:
        q_folders = {
            plan.id_to_folder.get(sid, "") for sid in quarantined_codes
        } - {""}
        drop_school_issues(pre_report, q_folders)
        print("QUARANTINE（兼容性阻断，本次跳过、本地保持现状）:")
        for sid, codes in sorted(quarantined_codes.items()):
            print(f"  [quarantined] {sid}: {codes}")

    print_validation_report(pre_report)
    if not pre_report.ok:
        print("\nSYNC ABORTED: 上游变更与轻屿环境不兼容，未修改任何文件。", file=sys.stderr)
        return 3
    if pre_report.warnings and not args.ignore_warnings:
        print("\nSYNC ABORTED: 存在警告项；修复脚本或确认风险后加 --ignore-warnings 重试。", file=sys.stderr)
        return 4

    if plan.resource_paths:
        if args.dry_run:
            print("DRY RUN: would checkout paths:")
            for path in plan.resource_paths:
                print(f"  - {path}")
        else:
            print("[5/6] Checkout upstream resources")
            index_in_paths = "index/root_index.yaml" in plan.resource_paths
            pre_checkout_index_text = (
                (warehouse_dir / "index" / "root_index.yaml").read_text(encoding="utf-8")
                if index_in_paths
                else ""
            )
            checkout_upstream_paths(warehouse_dir, plan.resource_paths)

            if index_in_paths:
                merged_ok, merge_detail = merge_index_after_checkout(
                    warehouse_dir,
                    pre_checkout_index_text,
                    plan.local_only,
                    sorted(quarantined_codes),
                )
                if not merged_ok:
                    print(
                        f"\nSYNC ABORTED: 索引合并校验失败（{merge_detail}），正在回滚工作区...",
                        file=sys.stderr,
                    )
                    run_git(["checkout", "HEAD", "--", *plan.resource_paths], warehouse_dir)
                    return 3
                if plan.local_only:
                    print(
                        f"索引合并：保留本地独有学校 {len(plan.local_only)} 所"
                        f"（{', '.join(plan.local_only)}）"
                    )
                if quarantined_codes:
                    print(f"索引合并：剔除隔离学校条目 {len(quarantined_codes)} 所")

            shimmed = apply_v2_bridge_shims_to_folders(warehouse_dir, plan.touched_folders)
            print(f"[5.5/6] Applied v2 bridge compat shim to {shimmed} script(s)")

            print("[6/6] Post-checkout validation + commit/push")
            post_report = run_validation(warehouse_dir, plan, pre_checkout=False)
            print_validation_report(post_report)
            if not post_report.ok:
                print("\nSYNC ABORTED: 检出后校验失败，正在回滚工作区...", file=sys.stderr)
                run_git(["checkout", "HEAD", "--", *plan.resource_paths], warehouse_dir)
                return 3
            if post_report.warnings and not args.ignore_warnings:
                print("\nSYNC ABORTED: 检出后仍有警告；已回滚。", file=sys.stderr)
                run_git(["checkout", "HEAD", "--", *plan.resource_paths], warehouse_dir)
                return 4
    else:
        print("[5/6] Checkout skipped (already in sync)")
        print("[6/6] Post-checkout validation skipped")

    committed = commit_if_needed(
        warehouse_dir,
        plan.upstream_only,
        plan.resource_paths,
        args.dry_run,
        refresh_count=len(plan.refresh_schools),
        quarantine_note=(
            (
                f"{len(quarantined_codes)} 个: "
                + ", ".join(sorted(quarantined_codes)[:8])
                + (" …" if len(quarantined_codes) > 8 else "")
            )
            if quarantined_codes
            else ""
        ),
    )
    push_if_needed(warehouse_dir, args.dry_run, args.no_push, committed)

    if pre_report.upstream_script_updates:
        print("\nNote: upstream also changed existing school scripts (not auto-synced):")
        for school_id, folder in pre_report.upstream_script_updates:
            print(f"  - {school_id} -> resources/{folder}")

    if args.dry_run:
        print("Dry run complete. No checkout, commit, or push occurred.")
        return 0

    if committed:
        print(f"qingyu_warehouse commit: {committed}")
    else:
        print("No commit needed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
