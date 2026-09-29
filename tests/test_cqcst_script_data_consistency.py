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
import shutil
import subprocess
import sys
import tempfile
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


# 「周次(节次)」文本 → (周次, 起节, 止节)。
# 前 12 条按 2026-09-29 在城科真实课表页抓到的原文写的（课程块里周次节次藏在
# <span title="选课人数">，写作「(人数)周次(全部)[节次]」，节次是连堂的一串数字、
# 两位补零），后面几条是同平台其他写法的兜底。人名/班级/教室都换成了同形状的
# 占位——被测的是形状，不是具体是谁。
# 钉的坑：
#   1) 课程名里的总学时「[32]」「[96]」（对照培养方案：学分 × 16 ≈ 总学时）
#      不能被当成周次（越 30 周会被 App 整条丢弃，17 门课只进 1 门就是这么来的）；
#   2) 开头的「(33)」是选课人数，必须摘掉，否则和周次粘成「3311-12」；
#   3) 连堂四节 [01-02-03-04节] 要读成 1~4 节，只取前两个数会丢掉后半堂；
#   4) 教室号与周次在 textContent 里会粘成一串时，起始周要从粘住的那串数字借回来；
#   5) 真越界（96 周）时必须认不出，不能截成 6 周推给 App。
_WEEK_SECTION_CASES = [
    # (整块文本, 期望周次, 期望起节, 期望止节)
    # —— 城科真实样本 ——
    (
        "工装夹具设计及应用课程设计[32][必修]某某某25某某某（专升本）03班"
        "(33)11-12(全部)[01-02-03-04节]A1-401",
        [11, 12],
        1,
        4,
    ),
    ("(33)7,11(全部)[01-02-03-04节]", [7, 11], 1, 4),
    ("(97)1-2,5-10(全部)[01-02节]", [1, 2, 5, 6, 7, 8, 9, 10], 1, 2),
    ("(97)1-2(全部)[03-04节]", [1, 2], 3, 4),
    ("(97)1-3,6-10(全部)[05-06节]", [1, 2, 3, 6, 7, 8, 9, 10], 5, 6),
    ("(102)1-3,5-11(全部)[05-06节]", [1, 2, 3, 5, 6, 7, 8, 9, 10, 11], 5, 6),
    ("(33)11-12(全部)[05-06-07-08节]", [11, 12], 5, 8),
    ("(97)5(全部)[05-06节]", [5], 5, 6),
    ("(529)5-6(全部)[07-08节]", [5, 6], 7, 8),
    ("(102)9(全部)[07-08节]", [9], 7, 8),
    ("(33)13-18(全部)[09-10节]", [13, 14, 15, 16, 17, 18], 9, 10),
    (
        "毕业实习[96][必修]某某某25某某某（专升本）03班(33)13-18(全部)[09-10节]",
        [13, 14, 15, 16, 17, 18],
        9,
        10,
    ),
    # 周次(节次) 标签那一层只有周次、没有节次，不该硬凑出节次
    ("25某某某（专升本）03班7,11(全部)", None, None, None),
    # —— 同平台其他写法 ——
    ("1-16周(单)[1-2节]", [1, 3, 5, 7, 9, 11, 13, 15], 1, 2),
    ("1-16周[1-2节]", list(range(1, 17)), 1, 2),
    ("田径场A20510-16周[5-6节]", [10, 11, 12, 13, 14, 15, 16], 5, 6),
    ("1,3,5,7,9,11,13,15周(单)[7-8节]", [1, 3, 5, 7, 9, 11, 13, 15], 7, 8),
    ("1-8周(单),11-16周(单)[9-10节]", [1, 3, 5, 7, 11, 13, 15], 9, 10),
    ("3周[3节]", [3], 3, 3),
    ("1-8周(双)[11-12节]", [2, 4, 6, 8], 11, 12),
    ("第1-2节 1-16周", list(range(1, 17)), 1, 2),
    # 认不出周次的一律返回 null，绝不推猜出来的值
    ("怪课[96][必修]某某一教A99996周[1-2节]", None, None, None),
    ("高等数学[32][必修]张三", None, None, None),
]

_WEEK_SECTION_DRIVER = """
const fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(cases.map(function (text) {
    return schoolParseWeekSection(text);
})));
"""


class CqcstWeekSectionParsingTest(unittest.TestCase):
    """周次/节次解析必须守住 App 侧的入库条件。

    App 侧 `warehouse_course_import_logic.dart` 的 `_parseOne` 只在周次全部落在
    1..30（`ImportExportLogic.maxAllowedSemesterWeekCount`）时才收这条记录，
    超出的周次连同整门课一起消失，而脚本侧看着一切正常。所以周次怎么解析都
    得在这里钉住，不能靠真机再看。
    """

    SCRIPT = ROOT / "resources" / "CQCST" / "cqcst_01.js"

    def test_week_section_parsing(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("本机没有 node，跳过周次解析回归")

        source = self.SCRIPT.read_text(encoding="utf-8")
        start = source.index("// ===== 课表提取")
        end = source.index("// ===== 作息时间表", start)
        # 「课表提取」这一节里周次解析是纯字符串逻辑（不碰 DOM），切出来直接跑
        extract_section = source[start:end]
        with tempfile.TemporaryDirectory() as tmp:
            driver = Path(tmp) / "week_section_probe.cjs"
            driver.write_text(extract_section + _WEEK_SECTION_DRIVER, encoding="utf-8")
            # 走文件而不是管道：Windows 下管道的编码跟随系统区域设置，中文会被搅坏
            cases_file = Path(tmp) / "cases.json"
            cases_file.write_text(
                json.dumps([case[0] for case in _WEEK_SECTION_CASES], ensure_ascii=False),
                encoding="utf-8",
            )
            proc = subprocess.run(
                [node, str(driver), str(cases_file)],
                capture_output=True,
                check=True,
            )
        parsed = json.loads(proc.stdout.decode("utf-8"))

        self.assertEqual(len(parsed), len(_WEEK_SECTION_CASES))
        for (text, weeks, start_section, end_section), got in zip(_WEEK_SECTION_CASES, parsed):
            if weeks is None:
                self.assertIsNone(got, f"「{text}」应当认不出（宁可不导入也不推错周次）")
                continue
            self.assertIsNotNone(got, f"「{text}」应当解析出周次节次")
            self.assertEqual(got["weeks"], weeks, f"「{text}」的周次不对")
            self.assertEqual(got["startSection"], start_section, f"「{text}」的起始节不对")
            self.assertEqual(got["endSection"], end_section, f"「{text}」的结束节不对")
            for week in got["weeks"]:
                self.assertTrue(1 <= week <= 30, f"「{text}」的周次 {week} 会被 App 整条丢弃")


if __name__ == "__main__":
    unittest.main()
