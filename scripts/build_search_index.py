#!/usr/bin/env python3
"""Generate index/search_index.yaml — 教务导入「按适配器（脚本）名称搜索」全局索引。

轻屿课表的教务导入搜索需要命中学校内部的细分脚本名称（如通用工具里的
WakeUp 分享口令导入），而适配器名称分散在每个学校的
resources/<folder>/adapters.yaml 中，App 端逐校拉取代价太高。
本脚本把全部学校的适配器 ID 与名称聚合为单一索引文件，
App 只需一次请求即可完成脚本名搜索。

- 输入：index/root_index.yaml + resources/*/adapters.yaml
- 输出：index/search_index.yaml（确定性输出：输入不变则字节不变）
- version_id 取自聚合内容的 SHA-256 摘要前 16 位，便于比对新旧索引
- --check 模式：索引过期时以退出码 1 失败（供 CI 校验），不落盘

零第三方依赖：对两种已知固定形态的 YAML 做行级解析，与
warehouse_upstream_compat.py 的做法保持一致。
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT_INDEX_PATH = Path("index/root_index.yaml")
SEARCH_INDEX_PATH = Path("index/search_index.yaml")

_ID_PATTERN = re.compile(r'- id:\s*"([^"]*)"')


def _yaml_scalar(line: str, key: str) -> str | None:
    """解析 ``key: value`` 行的标量值：去掉行内注释与成对引号，不匹配返回 None。"""
    stripped = line.strip()
    prefix = f"{key}:"
    if not stripped.startswith(prefix):
        return None
    value = stripped[len(prefix) :].strip()
    # 行内注释：引号外的 # 视为注释起点（与仓库其他解析器同一规则）
    in_single = in_double = False
    out: list[str] = []
    for ch in value:
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            break
        out.append(ch)
    value = "".join(out).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value


def _yaml_scalar_unquoted(line: str, key: str) -> str:
    """_yaml_scalar 的宽松版：未命中返回空串。"""
    return _yaml_scalar(line, key) or ""


def parse_root_schools(text: str) -> list[dict[str, str]]:
    """按行解析 root_index.yaml 的 schools 列表，保持文件顺序。

    返回 [{id, name, initial, resource_folder}, ...]；缺失字段记空串。
    """
    schools: list[dict[str, str]] = []
    in_schools = False
    current: dict[str, str] | None = None

    def _flush() -> None:
        nonlocal current
        if current and current.get("id"):
            schools.append(current)
        current = None

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        if indent == 0:
            if stripped == "schools:":
                in_schools = True
            elif in_schools:
                # 下一个顶层键：schools 列表结束
                _flush()
                in_schools = False
            continue
        if not in_schools:
            continue
        if indent == 2 and stripped.startswith("- "):
            _flush()
            match = _ID_PATTERN.search(stripped)
            current = {"id": match.group(1) if match else ""}
            continue
        if current is not None:
            for field in ("name", "initial", "resource_folder"):
                value = _yaml_scalar(stripped, field)
                if value is not None:
                    current[field] = value
    _flush()
    return schools


def parse_adapters(text: str) -> list[dict[str, str]]:
    """按行解析 adapters.yaml 的 adapters 列表，保持文件顺序。

    返回 [{adapter_id, adapter_name}, ...]；两个字段都齐的条目才保留。
    """
    adapters: list[dict[str, str]] = []
    in_adapters = False
    current: dict[str, str] | None = None

    def _flush() -> None:
        nonlocal current
        if current and current.get("adapter_id") and current.get("adapter_name"):
            adapters.append(current)
        current = None

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        if indent == 0:
            if stripped == "adapters:":
                in_adapters = True
            elif in_adapters:
                _flush()
                in_adapters = False
            continue
        if not in_adapters:
            continue
        if indent == 2 and stripped.startswith("- "):
            _flush()
            # 跳过列表前缀 "- " 后再解析键值
            current = {"adapter_id": _yaml_scalar_unquoted(stripped[2:].lstrip(), "adapter_id")}
            continue
        if current is not None:
            value = _yaml_scalar(stripped, "adapter_name")
            if value is not None:
                current["adapter_name"] = value
    _flush()
    return adapters


def _quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_schools_text(warehouse_dir: Path) -> str:
    """聚合全部学校的适配器 ID/名称，返回 schools 段文本（不含 version_id 行）。"""
    root_path = warehouse_dir / ROOT_INDEX_PATH
    if not root_path.is_file():
        raise FileNotFoundError(f"根索引文件未找到: {root_path}")
    lines: list[str] = ["schools:"]
    school_count = adapter_count = 0
    for school in parse_root_schools(root_path.read_text(encoding="utf-8")):
        folder = school.get("resource_folder", "")
        adapters_path = warehouse_dir / "resources" / folder / "adapters.yaml"
        if not adapters_path.is_file():
            print(f"警告：未找到适配器配置 {adapters_path}，跳过学校 {school['id']}")
            continue
        entries = parse_adapters(adapters_path.read_text(encoding="utf-8"))
        if not entries:
            continue
        school_count += 1
        lines.append(f"  - id: {_quote(school['id'])}")
        lines.append("    adapters:")
        for adapter in entries:
            adapter_count += 1
            lines.append(f"      - adapter_id: {_quote(adapter['adapter_id'])}")
            lines.append(f"        adapter_name: {_quote(adapter['adapter_name'])}")
    if school_count == 0:
        raise RuntimeError("search index would be empty: no school adapters parsed")
    print(f"聚合 {school_count} 所学校 / {adapter_count} 个适配器")
    return "\n".join(lines) + "\n"


def render_search_index(schools_text: str) -> str:
    """拼上固定头注释与 version_id（内容摘要，保证确定性输出）。"""
    digest = hashlib.sha256(schools_text.encode("utf-8")).hexdigest()[:16]
    header = (
        "# index/search_index.yaml\n"
        "# 由 scripts/build_search_index.py 自动生成，请勿手动编辑。\n"
        "# 用途：轻屿课表教务导入的「按适配器（脚本）名称搜索」全局索引——\n"
        "# App 一次请求即可覆盖全部学校的细分脚本，无需逐校拉取 adapters.yaml。\n"
    )
    return f"{header}version_id: \"IDX_{digest}\"\n{schools_text}"


def regenerate(warehouse_dir: Path) -> bool:
    """重建索引文件；内容有变化时写入并返回 True（供同步流程随之提交）。"""
    rendered = render_search_index(build_schools_text(warehouse_dir))
    target = warehouse_dir / SEARCH_INDEX_PATH
    if target.is_file() and target.read_text(encoding="utf-8") == rendered:
        return False
    target.write_text(rendered, encoding="utf-8", newline="\n")
    return True


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warehouse-dir",
        type=Path,
        default=repo_root,
        help="qingyu_warehouse repository root (default: parent of scripts/)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="仅校验索引是否最新（过期则退出码 1），不写文件",
    )
    args = parser.parse_args()

    warehouse_dir = args.warehouse_dir.resolve()
    try:
        schools_text = build_schools_text(warehouse_dir)
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    rendered = render_search_index(schools_text)

    target = warehouse_dir / SEARCH_INDEX_PATH
    if args.check:
        if not target.is_file():
            print(f"错误：缺少 {SEARCH_INDEX_PATH}，请运行 python scripts/build_search_index.py 生成")
            return 1
        current = target.read_text(encoding="utf-8")
        if current == rendered:
            print("search index 已是最新")
            return 0
        print(
            f"错误：{SEARCH_INDEX_PATH} 已过期（源 adapters.yaml 与索引不一致），"
            "请运行 python scripts/build_search_index.py 重新生成并提交"
        )
        return 1

    if not regenerate(warehouse_dir):
        print("search index 无变化")
        return 0
    print(f"已写入 {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
