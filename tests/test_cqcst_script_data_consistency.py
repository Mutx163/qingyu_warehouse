"""轻屿专属作息数据与适配脚本必须对得上。

Why this test exists: App 侧「不额外问用户」的设计是——脚本问一句「选择学校作息
时间表」，App 拿脚本下发的那套节次时间与数据文件里各套**逐节比对**，反推用户选
的是哪个校区。

这个设计的地基就是「两边的作息一模一样」。一旦漂移，后果是静默的：用户在专属条目
里选了作息，App 判不出校区，于是整套专属作息不套用，退回脚本那套全局作息，界面
上却看不出任何异常——用户只会觉得「这功能好像没起作用」。

所以这条一致性必须在仓库侧守住（这里的 CI 一定会跑）。App 侧
`test/domain/warehouse_location_time_schemes_test.dart` 也对同一份数据做了交叉
校验，但它依赖本机有仓库副本，CI 上会跳过；权威检查在这里。
"""

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 脚本的形状：13 节公共表（第 3、4 节留 null）+ 每套只写第 3、4 节。
_COMMON_TABLE_START = "const SCHOOL_COMMON_TIME_SLOTS = ["
_COMMON_ENTRY = re.compile(r'\["(\d{1,2}:\d{2})",\s*"(\d{1,2}:\d{2})"\]|\bnull\b')
_SCHEME_PAIR = re.compile(
    r'third:\s*\["(\d{1,2}:\d{2})",\s*"(\d{1,2}:\d{2})"\],'
    r'\s*fourth:\s*\["(\d{1,2}:\d{2})",\s*"(\d{1,2}:\d{2})"\]'
)


def _clock_minutes(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def _parse_section_map(raw: dict) -> dict[int, tuple[str, str]]:
    return {
        int(index): (item["startTime"], item["endTime"])
        for index, item in raw.items()
    }


def _resolved_schemes(data: dict) -> list[list[tuple[str, str]]]:
    """把数据文件解析成「每套一套完整节次表」，规则与 App 侧一致。"""
    baseline = _parse_section_map(data["sections"])
    out: list[list[tuple[str, str]]] = []
    for campus in data["campuses"]:
        for scheme in campus["schemes"]:
            merged = dict(baseline)
            merged.update(_parse_section_map(scheme.get("overrides") or {}))
            out.append([merged[index] for index in sorted(merged)])
    return out


class CqcstScriptDataConsistencyTest(unittest.TestCase):
    DATA = ROOT / "qingyu_only" / "CQCST" / "time_schemes.json"
    SCRIPT = ROOT / "resources" / "CQCST" / "cqcst_01.js"

    def setUp(self) -> None:
        self.data = json.loads(self.DATA.read_text(encoding="utf-8"))
        self.source = self.SCRIPT.read_text(encoding="utf-8")
        self.resolved = _resolved_schemes(self.data)
        self.baseline = self.resolved[0]

    def _script_common_table(self) -> list[tuple[str, str] | None]:
        start = self.source.index(_COMMON_TABLE_START) + len(_COMMON_TABLE_START)
        body = self.source[start : self.source.index("];", start)]
        table: list[tuple[str, str] | None] = []
        for match in _COMMON_ENTRY.finditer(body):
            table.append(
                None if match.group(1) is None else (match.group(1), match.group(2))
            )
        return table

    def test_script_common_table_matches_baseline(self) -> None:
        table = self._script_common_table()
        self.assertEqual(len(table), 13, "脚本的公共表应当是 13 节")
        # 第 3、4 节刻意留空，由每套自己给 —— 数据文件正是用 overrides 表达它们。
        # 若脚本改成写死第 3、4 节，这条会红，提示两边的表达方式要一起改。
        self.assertIsNone(table[2])
        self.assertIsNone(table[3])
        for index, entry in enumerate(table):
            if entry is None:
                continue
            self.assertEqual(
                self.baseline[index],
                entry,
                f"第 {index + 1} 节与脚本不一致",
            )

    def test_every_scheme_pair_exists_in_the_script(self) -> None:
        # 数据文件里每套的第 3、4 节配对，必须在脚本的四套里能找到。
        # 数据文件用「基线 + overrides」表达，脚本用「公共表 + third/fourth」，
        # 两边形状不同，所以只比对那两节——那正是两边唯一的差异来源。
        script_pairs = {
            (m.group(1), m.group(2), m.group(3), m.group(4))
            for m in _SCHEME_PAIR.finditer(self.source)
        }
        self.assertEqual(len(script_pairs), 4, "脚本应当给出四套作息")
        for scheme in self.resolved:
            third = scheme[2]
            fourth = scheme[3]
            self.assertIn(
                (*third, *fourth),
                script_pairs,
                f"数据文件里第 3/4 节为 {third}/{fourth} 的一套，脚本里找不到对应项",
            )

    def test_scripts_only_use_upstream_bridge_methods(self) -> None:
        # 「脚本能原样回馈上游」这条原则的机械检查：脚本调用的桥接方法必须 ⊆
        # 上游标准集合。此前为了按教学楼分流作息曾自造 saveLocationTimeSchemes 并
        # 把它加进白名单，等于放宽自己的尺子，已撤。
        sys.path.insert(0, str(ROOT / "scripts"))
        from warehouse_upstream_compat import (  # noqa: PLC0415
            SUPPORTED_ANDROID_BRIDGE_PROMISE,
        )

        used = set(
            re.findall(r"(?:AndroidBridge|shiguangBridgePromise)\.(\w+)", self.source)
        )
        self.assertTrue(used, "应当至少调用一个桥接方法，否则这条检查形同虚设")
        self.assertEqual(used - set(SUPPORTED_ANDROID_BRIDGE_PROMISE), set())


if __name__ == "__main__":
    unittest.main()
