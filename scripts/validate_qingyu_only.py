"""校验 qingyu_only/ 下轻屿专属适配数据。

为什么需要它：这些文件是纯数据，没有任何 schema 强制。写错时以前只有两个下场——
App 运行时才炸，或者更糟：静默用错时间上了一个学期的闹钟。CI 必须拦。

单独运行：
    python scripts/validate_qingyu_only.py
    python scripts/validate_qingyu_only.py qingyu_only/CQCST   # 只校验指定学校
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QINGYU_ONLY = ROOT / "qingyu_only"

# 本地贡献者常在 GBK 控制台下运行，直接 print 中文/符号会 UnicodeEncodeError
# 并把真实报错盖掉。统一按 UTF-8 输出，编码不出的字符降级替换。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
VALID_MODES = {"prefix", "contains", "exact"}
SUPPORTED_VERSION = 1


def _clock_minutes(value: str) -> int | None:
    match = CLOCK.match(value or "")
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def _check_pair(entry: object, where: str, errors: list[str]) -> tuple[int, int] | None:
    if not isinstance(entry, dict):
        errors.append(f"{where}: 期望 {{startTime,endTime}} 对象，实际 {type(entry).__name__}")
        return None
    start_raw = entry.get("startTime")
    end_raw = entry.get("endTime")
    if not isinstance(start_raw, str) or not isinstance(end_raw, str):
        errors.append(f"{where}: startTime / endTime 必须是字符串")
        return None
    start = _clock_minutes(start_raw)
    end = _clock_minutes(end_raw)
    if start is None:
        errors.append(f"{where}: startTime={start_raw!r} 不是 HH:mm（需 00:00-23:59）")
    if end is None:
        errors.append(f"{where}: endTime={end_raw!r} 不是 HH:mm（需 00:00-23:59）")
    if start is None or end is None:
        return None
    if end <= start:
        errors.append(f"{where}: 结束 {end_raw} 必须晚于开始 {start_raw}")
    return (start, end)


def _check_monotonic(sections: dict[str, tuple[int, int]], where: str, errors: list[str]) -> None:
    """与 App 侧 time_scheme.dart::validateSectionTimes 同规则。

    App 建模板时会用同一条校验，CLI 先拦下来，报错信息能指到具体学校。
    """
    previous_end = -1
    for key in sorted(sections, key=lambda k: int(k)):
        start, end = sections[key]
        if previous_end >= 0 and start < previous_end:
            errors.append(
                f"{where} 第 {key} 节：开始时间早于第 {int(key) - 1} 节的结束时间，"
                f"App 侧会拒绝该模板"
            )
        previous_end = max(previous_end, end)


def _rel(path: Path) -> str:
    """仓库内显示相对路径；仓库外（另一个 worktree / 临时目录）退回绝对路径。

    直接 path.relative_to(ROOT) 在仓外会抛 ValueError，把「数据有问题」这条
    真正的报错盖掉。
    """
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _read_text(path: Path) -> str | None:
    """读 UTF-8（容 BOM）。非 UTF-8 返回 None，让调用方报明确的错。

    Windows 上用 GBK 保存的 yaml/json 很常见，直接 read_text 会抛
    UnicodeDecodeError，把「文件编码不对」这条真正的提示盖成 traceback。
    """
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return None


def validate_time_schemes(path: Path, errors: list[str]) -> None:
    rel = _rel(path)
    text = _read_text(path)
    if text is None:
        errors.append(f"{rel}: 不是 UTF-8 编码，请另存为 UTF-8 后再提交")
        return
    try:
        # utf-8-sig：Windows 上 PowerShell `Set-Content -Encoding UTF8` 与部分
        # 编辑器会写 BOM，直接用 utf-8 会报「Unexpected UTF-8 BOM」这种
        # 与内容无关的错，贡献者会看不懂。
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        errors.append(f"{rel}: JSON 解析失败（第 {exc.lineno} 行）—— {exc.msg}")
        return
    if not isinstance(payload, dict):
        errors.append(f"{rel}: 顶层必须是对象")
        return

    version = payload.get("version")
    if version != SUPPORTED_VERSION:
        errors.append(
            f"{rel}: version={version!r} 不受支持，当前只接受 {SUPPORTED_VERSION}"
        )

    raw_sections = payload.get("sections")
    if not isinstance(raw_sections, dict) or not raw_sections:
        errors.append(f"{rel}: 缺少非空的 sections（学校公布的共通作息）")
        return
    try:
        numbers = sorted(int(k) for k in raw_sections)
    except ValueError:
        errors.append(f"{rel}: sections 的键必须是节次数字字符串")
        return
    if numbers != list(range(1, len(numbers) + 1)):
        errors.append(
            f"{rel}: sections 的节次必须从 1 连续编号，实际为 {numbers}"
        )
    common: dict[str, tuple[int, int]] = {}
    for key in raw_sections:
        pair = _check_pair(raw_sections[key], f"{rel} sections[{key}]", errors)
        if pair is not None:
            common[str(key)] = pair
    _check_monotonic(common, rel, errors)

    campuses = payload.get("campuses")
    if not isinstance(campuses, list) or not campuses:
        errors.append(f"{rel}: 缺少非空的 campuses")
        return

    seen_ids: set[str] = set()
    for campus_index, campus in enumerate(campuses):
        where = f"{rel} campuses[{campus_index}]"
        if not isinstance(campus, dict):
            errors.append(f"{where}: 必须是对象")
            continue
        campus_id = campus.get("id")
        if not isinstance(campus_id, str) or not campus_id.strip():
            errors.append(f"{where}: id 必须是非空字符串")
        elif campus_id in seen_ids:
            errors.append(f"{where}: id={campus_id!r} 重复")
        else:
            seen_ids.add(campus_id)
        if not isinstance(campus.get("name"), str) or not campus["name"].strip():
            errors.append(f"{where}: name 必须是非空字符串")

        schemes = campus.get("schemes")
        if not isinstance(schemes, list) or not schemes:
            errors.append(f"{where}: schemes 必须是非空数组")
            continue
        fallback_count = 0
        seen_scheme_names: set[str] = set()
        for scheme_index, scheme in enumerate(schemes):
            swhere = f"{where} schemes[{scheme_index}]"
            if not isinstance(scheme, dict):
                errors.append(f"{swhere}: 必须是对象")
                continue
            name = scheme.get("name")
            if not isinstance(name, str) or not name.strip():
                errors.append(f"{swhere}: name 必须是非空字符串")
            elif name in seen_scheme_names:
                errors.append(f"{swhere}: name={name!r} 在同一校区内重复")
            else:
                seen_scheme_names.add(name)

            keywords = scheme.get("keywords") or []
            if not isinstance(keywords, list):
                errors.append(f"{swhere}: keywords 必须是数组")
                keywords = []
            for keyword_index, keyword in enumerate(keywords):
                kwhere = f"{swhere} keywords[{keyword_index}]"
                if not isinstance(keyword, dict):
                    errors.append(f"{kwhere}: 必须是对象")
                    continue
                pattern = keyword.get("pattern")
                if not isinstance(pattern, str) or not pattern.strip():
                    errors.append(f"{kwhere}: pattern 必须是非空字符串")
                mode = keyword.get("mode", "prefix")
                if mode not in VALID_MODES:
                    errors.append(
                        f"{kwhere}: mode={mode!r} 非法，只能是 {sorted(VALID_MODES)}"
                    )
            if not keywords:
                fallback_count += 1

            overrides = scheme.get("overrides") or {}
            if not isinstance(overrides, dict):
                errors.append(f"{swhere}: overrides 必须是对象")
                continue
            unknown = [k for k in overrides if str(k) not in common]
            if unknown:
                errors.append(
                    f"{swhere}: overrides 覆盖了 sections 里没有的节次 {sorted(unknown)}"
                )
            merged = dict(common)
            for key, entry in overrides.items():
                if str(key) not in common:
                    continue
                pair = _check_pair(entry, f"{swhere} overrides[{key}]", errors)
                if pair is not None:
                    merged[str(key)] = pair
            _check_monotonic(merged, swhere, errors)
        if fallback_count != 1:
            errors.append(
                f"{where}: 必须恰好有一套作息没有 keywords（它会成为课表默认），"
                f"实际 {fallback_count} 套"
            )


def validate_registration(folder: Path, errors: list[str]) -> None:
    """qingyu_only/<ID>/adapters.yaml 只能是扁平键值。

    App 的 YAML 解析器是逐行扁平解析（_parseYamlListMaps），嵌套结构会被读成
    垃圾键值而不是报错，所以这里显式拦。
    """
    path = folder / "adapters.yaml"
    rel = _rel(path)
    if not path.exists():
        errors.append(f"{rel}: 缺少登记文件")
        return
    text = _read_text(path)
    if text is None:
        errors.append(f"{rel}: 不是 UTF-8 编码，请另存为 UTF-8 后再提交")
        return
    body = text.split("adapters:", 1)
    if len(body) != 2:
        errors.append(f"{rel}: 缺少顶层 adapters: 列表")
        return

    referenced: list[str] = []
    for raw in body[1].splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        if ": " not in line:
            if line.endswith(":"):
                errors.append(
                    f"{rel}: 不允许嵌套键 `{line}` —— App 解析器会读成垃圾，"
                    f"结构化数据请另置文件并用 xxx_file 引用"
                )
            continue
        key, _, value = line.partition(": ")
        key = key.strip()
        value = value.strip()
        if key.endswith("_file"):
            target = value.strip("\"'")
            if not (folder / target).exists():
                errors.append(f"{rel}: {key} 指向的文件不存在：{target}")
            else:
                referenced.append(target)
        if key == "asset_js_path":
            script = value.strip("\"'")
            if (folder / script).exists():
                errors.append(
                    f"{rel}: qingyu_only 下不应另存脚本副本（{script}）——"
                    f"请复用 resources/ 下那份，避免两份解析逻辑漂移"
                )

    if referenced and not any(
        (folder / name).suffix == ".json" for name in referenced
    ):
        errors.append(f"{rel}: 至少要有一个 *_file 指向 .json 数据文件")


def collect_school_dirs(base: Path) -> list[Path]:
    if not base.exists():
        return []
    return sorted(p for p in base.iterdir() if p.is_dir())


def main(argv: list[str]) -> int:
    targets: list[Path] = []
    if len(argv) > 1:
        for arg in argv[1:]:
            candidate = (ROOT / arg).resolve()
            if not candidate.is_dir():
                print(f"✗ 目录不存在：{arg}")
                return 1
            targets.append(candidate)
    else:
        targets = collect_school_dirs(QINGYU_ONLY)

    if not targets:
        print("qingyu_only/ 下没有学校目录，无需校验")
        return 0

    errors: list[str] = []
    checked = 0
    for folder in targets:
        if folder.name == "tests" or folder.name.startswith("."):
            continue
        validate_registration(folder, errors)
        data_files = sorted(folder.glob("*.json"))
        if not data_files:
            errors.append(
                f"{_rel(folder)}: 没有 *.json 数据文件，专属适配无从生效"
            )
        for data_file in data_files:
            validate_time_schemes(data_file, errors)
            checked += 1

    if errors:
        print(f"✗ 轻屿专属适配数据校验失败（{len(errors)} 项）：\n")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"ok: {len(targets)} 个学校目录、{checked} 个数据文件校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
