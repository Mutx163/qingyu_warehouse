"""每日同步提交信息的可读性约束。

这段文字会原样出现在 GitHub 每天发给维护者的邮件通知里。测试盯住的是
「学校必须有中文名」这条：只有 HNPTC 这类代号，收到邮件的人无法判断
这次同步到底进了什么学校。
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from sync_upstream import (  # noqa: E402
    build_commit_message,
    format_school_list,
    lookup_names,
)

SAMPLE_INDEX = """schools:
  - id: "GLOBAL_TOOLS"
    name: "通用工具集合"
    initial: "T"
    resource_folder: "GLOBAL_TOOLS"

  - id: "HNPTC"
    name: "湖南邮电职业技术学院"
    initial: "H"
    resource_folder: "HNPTC"

  - id: "CQCST"
    name: "重庆城市科技学院"
    initial: "C"
    resource_folder: "CQCST"
"""


class CommitMessageTest(unittest.TestCase):
    def test_new_schools_carry_chinese_name(self) -> None:
        names = lookup_names(SAMPLE_INDEX, ["HNPTC", "CQCST"])
        message = build_commit_message(["HNPTC"], school_names=names)
        self.assertIn("新增学校: HNPTC 湖南邮电职业技术学院", message)

    def test_unknown_school_falls_back_to_id_only(self) -> None:
        names = lookup_names(SAMPLE_INDEX, ["HNPTC"])
        message = build_commit_message(["HNPTC", "NOPE"], school_names=names)
        self.assertIn("新增学校: HNPTC 湖南邮电职业技术学院、NOPE", message)

    def test_no_new_school_still_reads(self) -> None:
        message = build_commit_message([])
        self.assertIn("新增学校: 无（仅索引/脚本更新）", message)
        self.assertIn("来源: shiguang_warehouse/main", message)

    def test_refreshed_schools_also_named(self) -> None:
        names = lookup_names(SAMPLE_INDEX, ["HNPTC", "CQCST"])
        message = build_commit_message(
            [],
            refresh_ids=["CQCST"],
            refresh_count=1,
            school_names=names,
        )
        self.assertIn("刷新既有学校: 1 个（CQCST 重庆城市科技学院；已自动前置 v2 桥接兼容垫片）", message)

    def test_quarantine_note_kept_verbatim(self) -> None:
        message = build_commit_message([], quarantine_note="2 个: XMU、ZZU")
        self.assertIn("隔离不兼容学校: 2 个: XMU、ZZU", message)

    def test_lookup_names_ignores_other_schools(self) -> None:
        names = lookup_names(SAMPLE_INDEX, ["HNPTC"])
        self.assertEqual(names, {"HNPTC": "湖南邮电职业技术学院"})

    def test_format_school_list_joins_with_chinese_comma(self) -> None:
        self.assertEqual(
            format_school_list(["A", "B"], {"A": "甲大学", "B": "乙大学"}),
            "A 甲大学、B 乙大学",
        )


if __name__ == "__main__":
    unittest.main()
