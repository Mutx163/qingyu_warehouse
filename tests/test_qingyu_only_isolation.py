"""轻屿专属适配目录（qingyu_only/）的隔离约束。

These tests are the enforcement, not documentation: if someone later points the
upstream sync at this directory, the validator must refuse.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from warehouse_upstream_compat import (  # noqa: E402
    PROTECTED_PATH_PREFIXES,
    ValidationIssue,
    validate_protected_paths,
)


class QingyuOnlyIsolationTest(unittest.TestCase):
    def test_qingyu_only_is_protected(self) -> None:
        self.assertIn("qingyu_only/", PROTECTED_PATH_PREFIXES)

    def test_sync_plan_touching_qingyu_only_is_blocked(self) -> None:
        for path in (
            "qingyu_only/",
            "qingyu_only/CQCST",
            "qingyu_only/CQCST/adapters.yaml",
            "qingyu_only/CQCST/time_schemes.json",
        ):
            with self.subTest(path=path):
                report = validate_protected_paths([path])
                self.assertFalse(report.ok, f"{path} 应被拒绝但通过了")
                self.assertEqual(report.blocking[0].code, "protected_path")

    def test_windows_style_separators_also_blocked(self) -> None:
        report = validate_protected_paths(["qingyu_only\\CQCST\\adapters.yaml"])
        self.assertFalse(report.ok)

    def test_resources_is_not_protected(self) -> None:
        # 反向断言：resources/ 必须仍然可同步，否则整个同步功能会被误伤。
        report = validate_protected_paths(["resources/CQCST"])
        self.assertTrue(report.ok)

    def test_index_is_not_protected(self) -> None:
        report = validate_protected_paths(["index/root_index.yaml"])
        self.assertTrue(report.ok)


class QingyuOnlyDataDelegatesToValidatorTest(unittest.TestCase):
    """数据形状校验由 scripts/validate_qingyu_only.py 负责（单一事实来源）。

    这里只跑一遍校验器，确认「校验器本身没坏」——它同时是 CI 的一个步骤，
    若它自身抛异常，CI 会在校验数据之前就红。
    """

    def test_validator_passes_on_current_data(self) -> None:
        from validate_qingyu_only import main

        self.assertEqual(main(["validate_qingyu_only"]), 0)

    def test_validator_rejects_a_broken_file(self) -> None:
        # 反向断言：校验器必须真的会拒绝。全绿但其实什么都不检查的校验器
        # 比没有校验器更危险。
        import json
        import tempfile

        from validate_qingyu_only import main as validate_main

        with tempfile.TemporaryDirectory() as tmp:
            school = Path(tmp) / "TESTBAD"
            school.mkdir()
            (school / "adapters.yaml").write_text(
                "adapters:\n"
                "  - adapter_id: \"TESTBAD_02\"\n"
                "    time_schemes_file: \"time_schemes.json\"\n",
                encoding="utf-8",
            )
            (school / "time_schemes.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        # 第 2 节早于第 1 节结束：App 建模板时会拒绝
                        "sections": {
                            "1": {"startTime": "08:00", "endTime": "09:00"},
                            "2": {"startTime": "08:30", "endTime": "09:30"},
                        },
                        "campuses": [
                            {"id": "a", "name": "A", "schemes": [{"name": "兜底"}]}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            self.assertNotEqual(validate_main(["validate_qingyu_only", str(school)]), 0)


class QingyuOnlyCqcstSanityTest(unittest.TestCase):
    """重庆城市科技学院这一例的既知事实（改动作息表时会被提醒）。"""

    DATA = ROOT / "qingyu_only" / "CQCST" / "time_schemes.json"

    def setUp(self) -> None:
        self.payload = json.loads(self.DATA.read_text(encoding="utf-8-sig"))

    def test_thirteen_sections(self) -> None:
        self.assertEqual(len(self.payload["sections"]), 13, "学校公布的是 13 节")

    def test_both_campuses_present(self) -> None:
        ids = {c["id"] for c in self.payload["campuses"]}
        self.assertEqual(ids, {"yongchuan", "banan"})

    def test_main_building_keyword_is_a_prefix_rule(self) -> None:
        keywords = [
            k
            for campus in self.payload["campuses"]
            for scheme in campus["schemes"]
            for k in scheme.get("keywords", [])
        ]
        patterns = {k["pattern"] for k in keywords}
        # A主 = 永川主教学楼；A1/A2 = 巴南厚德楼/博学楼。
        # 「A1」「A2」不能用 contains：教室名形如 A1234，换 contains 会误吃别栋。
        self.assertEqual(patterns, {"A主", "A1", "A2"})
        for keyword in keywords:
            self.assertEqual(keyword.get("mode", "prefix"), "prefix")

    def test_only_sections_three_and_four_differ(self) -> None:
        # 学校作息只有第 3、4 节按校区/教学楼分档；若哪天数据里出现别的差异，
        # 说明基线选错了或抄错了。
        for campus in self.payload["campuses"]:
            for scheme in campus["schemes"]:
                self.assertTrue(
                    set(scheme.get("overrides", {})).issubset({"3", "4"}),
                    f'{campus["name"]}/{scheme["name"]} 出现了第 3、4 节以外的差异',
                )


class QingyuOnlyRegistrationTest(unittest.TestCase):
    ADAPTERS = ROOT / "qingyu_only" / "CQCST" / "adapters.yaml"

    def test_registration_uses_only_flat_fields(self) -> None:
        # App 的 YAML 解析器只认「每行一个 key: value」，嵌套会读成垃圾。
        text = self.ADAPTERS.read_text(encoding="utf-8")
        body = text.split("adapters:", 1)[1]
        for raw in body.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or line.startswith("-"):
                continue
            if ": " not in line and not line.endswith(":"):
                self.fail(f"无法按扁平键值解析: {line}")
            if line.endswith(":"):
                self.fail(f"不允许出现嵌套键（App 解析器会读成垃圾）: {line}")

    def test_registration_references_existing_data_file(self) -> None:
        text = self.ADAPTERS.read_text(encoding="utf-8")
        self.assertIn('time_schemes_file: "time_schemes.json"', text)
        self.assertTrue(
            (self.ADAPTERS.parent / "time_schemes.json").exists(),
            "time_schemes_file 指向的文件必须存在",
        )

    def test_registration_reuses_the_upstream_script(self) -> None:
        # 脚本不另存副本：轻屿专属条目复用 resources/ 下那份上游标准脚本。
        text = self.ADAPTERS.read_text(encoding="utf-8")
        self.assertIn('asset_js_path: "cqcst_01.js"', text)
        self.assertFalse(
            (self.ADAPTERS.parent / "cqcst_01.js").exists(),
            "qingyu_only 不应另存脚本副本，否则两份解析逻辑会漂移",
        )


if __name__ == "__main__":
    unittest.main()
