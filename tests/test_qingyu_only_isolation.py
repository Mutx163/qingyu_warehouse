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


class QingyuOnlyCqcstDataTest(unittest.TestCase):
    """轻屿专属数据文件本身的形状约束。"""

    DATA = ROOT / "qingyu_only" / "CQCST" / "time_schemes.json"

    def setUp(self) -> None:
        self.payload = json.loads(self.DATA.read_text(encoding="utf-8"))

    def test_school_published_timetable_shape(self) -> None:
        sections = self.payload["sections"]
        self.assertEqual(len(sections), 13, "学校公布的是 13 节")
        # 第 1、2、5~13 节两校区一致，只有第 3、4 节分档。
        self.assertEqual(sections["1"]["startTime"], "08:20")
        self.assertEqual(sections["13"]["endTime"], "23:30")
        # 共通表里第 3、4 节必须被各校区的 overrides 全部覆盖。
        for campus in self.payload["campuses"]:
            for scheme in campus["schemes"]:
                for section in ("3", "4"):
                    self.assertIn(
                        section,
                        scheme.get("overrides", {}),
                        f'{campus["name"]}/{scheme["name"]} 缺第 {section} 节覆盖',
                    )

    def test_each_campus_has_exactly_one_fallback(self) -> None:
        # 无 keywords 的那套 = 兜底，会被设为课表默认；多于一套会让默认值不确定。
        for campus in self.payload["campuses"]:
            fallbacks = [s for s in campus["schemes"] if not s.get("keywords")]
            self.assertEqual(len(fallbacks), 1, f'{campus["name"]} 兜底不唯一')

    def test_both_campuses_present(self) -> None:
        ids = {c["id"] for c in self.payload["campuses"]}
        self.assertEqual(ids, {"yongchuan", "banan"})

    def test_building_keywords_are_non_empty(self) -> None:
        for campus in self.payload["campuses"]:
            for scheme in campus["schemes"]:
                for keyword in scheme.get("keywords", []):
                    self.assertTrue(keyword["pattern"].strip())
                    self.assertIn(keyword.get("mode", "prefix"),
                                  {"prefix", "contains", "exact"})

    def test_overrides_only_touch_known_sections(self) -> None:
        known = set(self.payload["sections"].keys())
        for campus in self.payload["campuses"]:
            for scheme in campus["schemes"]:
                self.assertTrue(set(scheme.get("overrides", {})).issubset(known))

    def test_every_clock_is_well_formed(self) -> None:
        import re

        clock = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
        entries = list(self.payload["sections"].values())
        for campus in self.payload["campuses"]:
            for scheme in campus["schemes"]:
                entries.extend(scheme.get("overrides", {}).values())
        for entry in entries:
            self.assertRegex(entry["startTime"], clock)
            self.assertRegex(entry["endTime"], clock)


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
