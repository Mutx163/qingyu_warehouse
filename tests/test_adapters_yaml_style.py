"""adapters.yaml 必须保持 App 行级解析器能读的扁平样式。

App 端逐行解析 resources/<folder>/adapters.yaml（不是 pyyaml），只认：

- 顶层段头 ``adapters:``（行内注释会让段头匹配失败）
- 2 空格缩进的列表项 ``- ``（0 缩进的列表项会被直接跳过）

历史上游用上述两种写法带进来 6 所学校，App 解析出 0 条后报
「未读取到 XX 的适配器信息」。同步脚本检出上游后会调用
normalize_adapters_style 规范化；这里同时钉住仓内文件本身已经规范，
以及规范化不会改坏字段值。
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_search_index import parse_adapters  # noqa: E402
from sync_upstream import normalize_adapters_yaml_text  # noqa: E402

ADAPTER_ID_LINE = re.compile(r"- adapter_id:")


def _first_content_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return line
    return ""


class NormalizeAdaptersTextTest(unittest.TestCase):
    def test_indent_zero_items_are_indented(self) -> None:
        upstream = (
            "adapters:\n"
            '- adapter_id: "CUG_01"\n'
            '  adapter_name: "中国地质大学（武汉）正方教务"\n'
            '  asset_js_path: "cug.js"\n'
        )
        normalized = normalize_adapters_yaml_text(upstream)
        self.assertEqual(
            normalized,
            "adapters:\n"
            '  - adapter_id: "CUG_01"\n'
            '    adapter_name: "中国地质大学（武汉）正方教务"\n'
            '    asset_js_path: "cug.js"\n',
        )
        self.assertEqual(
            [(a["adapter_id"], a["adapter_name"]) for a in parse_adapters(normalized)],
            [("CUG_01", "中国地质大学（武汉）正方教务")],
        )

    def test_inline_comment_on_section_header_is_removed(self) -> None:
        upstream = (
            "adapters: #固定字段\n"
            '  - adapter_id: "JLU_01" # id加上序号\n'
            '    adapter_name: "吉林大学（新）教务管理系统"\n'
        )
        normalized = normalize_adapters_yaml_text(upstream)
        self.assertTrue(normalized.startswith("adapters:\n"))
        # 字段行上的行内注释属于数据，保持原样。
        self.assertIn('adapter_id: "JLU_01" # id加上序号', normalized)
        self.assertEqual(len(parse_adapters(normalized)), 1)

    def test_canonical_text_is_unchanged(self) -> None:
        canonical = (
            "# comment\n"
            "adapters:\n"
            '  - adapter_id: "SDYU_01"\n'
            '    adapter_name: "山东青年政治学院"\n'
        )
        self.assertEqual(normalize_adapters_yaml_text(canonical), canonical)

    def test_crlf_is_preserved(self) -> None:
        upstream = 'adapters:\r\n- adapter_id: "X_01"\r\n  adapter_name: "X"\r\n'
        self.assertEqual(
            normalize_adapters_yaml_text(upstream),
            'adapters:\r\n  - adapter_id: "X_01"\r\n    adapter_name: "X"\r\n',
        )


class RepositoryAdaptersStyleTest(unittest.TestCase):
    """仓内每个 adapters.yaml 都必须是 App 可解析的规范样式。"""

    def test_every_adapters_yaml_is_app_compatible(self) -> None:
        files = sorted((ROOT / "resources").glob("*/adapters.yaml"))
        self.assertTrue(files)
        problems: list[str] = []
        for path in files:
            # 少数文件带 UTF-8 BOM（GZMTU），对行解析无影响，但会干扰首行判断。
            text = path.read_text(encoding="utf-8-sig")
            rel = path.relative_to(ROOT).as_posix()
            header = _first_content_line(text)
            if header.strip() != "adapters:":
                problems.append(f"{rel}: 段头不是 'adapters:'（{header!r}）")
            for line in text.splitlines():
                if line.strip().startswith("- adapter_id:"):
                    indent = len(line) - len(line.lstrip(" "))
                    if indent != 2:
                        problems.append(f"{rel}: 列表项缩进 {indent} 空格（应为 2）")
            entries = parse_adapters(text)
            declared = len(ADAPTER_ID_LINE.findall(text))
            if len(entries) != declared:
                problems.append(
                    f"{rel}: 声明 {declared} 条但只解析出 {len(entries)} 条"
                )
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
