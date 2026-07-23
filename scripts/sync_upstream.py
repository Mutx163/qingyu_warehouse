#!/usr/bin/env python3
"""Sync qingyu_warehouse from upstream shiguang_warehouse with compatibility checks."""

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from warehouse_upstream_compat import (
    ValidationReport,
    format_report,
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


def build_plan(warehouse_dir: Path) -> SyncPlan:
    local_yaml = (warehouse_dir / "index" / "root_index.yaml").read_text(encoding="utf-8")
    upstream_yaml = read_upstream_index(warehouse_dir)

    local_ids, _local_map = parse_index_maps(local_yaml)
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

    return SyncPlan(
        upstream_only=upstream_only,
        local_only=local_only,
        id_to_folder=upstream_map,
        index_changed=index_changed,
        resource_paths=resource_paths,
    )


def validate_upstream_scripts_in_staging(
    warehouse_dir: Path,
    school_ids: list[str],
    id_to_folder: dict[str, str],
) -> ValidationReport:
    report = ValidationReport()
    with tempfile.TemporaryDirectory(prefix="warehouse-sync-") as tmp:
        staging = Path(tmp)
        for school_id in school_ids:
            folder = id_to_folder[school_id]
            rel_folder = f"resources/{folder}"
            target = staging / "resources" / folder
            target.mkdir(parents=True, exist_ok=True)

            adapters_text = read_upstream_file(warehouse_dir, f"{rel_folder}/adapters.yaml")
            (target / "adapters.yaml").write_text(adapters_text, encoding="utf-8")

            for line in adapters_text.splitlines():
                stripped = line.strip()
                if stripped.startswith("asset_js_path:"):
                    asset = parse_asset_js_path(stripped)
                    if asset:
                        script_text = read_upstream_file(warehouse_dir, f"{rel_folder}/{asset}")
                        (target / asset).write_text(script_text, encoding="utf-8")
                    break

            report.merge(validate_adapter_folder(target, school_id))
    return report


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
        school_ids=plan.upstream_only if not pre_checkout else plan.upstream_only,
        id_to_folder=plan.id_to_folder,
    )

    if pre_checkout and plan.upstream_only:
        report.merge(
            validate_upstream_scripts_in_staging(
                warehouse_dir,
                plan.upstream_only,
                plan.id_to_folder,
            )
        )

    return report


def print_validation_report(report: ValidationReport) -> None:
    text = format_report(report)
    if text:
        print(text)


def checkout_upstream_paths(warehouse_dir: Path, paths: list[str]) -> None:
    if not paths:
        return
    run_git(["checkout", UPSTREAM_REF, "--", *paths], warehouse_dir)


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
        "来源: shiguang_warehouse/main"
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
    plan = build_plan(warehouse_dir)
    upstream_yaml = read_upstream_index(warehouse_dir)
    school_names = lookup_names(upstream_yaml, plan.upstream_only)

    if not plan.resource_paths:
        print("Already in sync with upstream (no new schools or index drift).")
    else:
        print(
            f"Plan: index_changed={plan.index_changed}, "
            f"new_schools={len(plan.upstream_only)}"
        )
        for school_id in plan.upstream_only:
            print(f"  + {school_id} {school_names.get(school_id, '')}")

    print("[4/6] Pre-sync compatibility validation")
    pre_report = run_validation(warehouse_dir, plan, pre_checkout=True)
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
            checkout_upstream_paths(warehouse_dir, plan.resource_paths)

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
