/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

/* 山东大学强智教务课表适配
 * 入口：http://bkzhjx.wh.sdu.edu.cn/sso.jsp（本科生院页上的「智慧教学服务平台」链接）
 *      → 学校统一身份认证 pass.sdu.edu.cn/cas → 回到「智慧教学管理与服务平台」
 *      xsMainV.htmlx。注意 /jsxsd/ 那个地址是平台自带的登录页，学生账号进不去，
 *      必须走统一认证；脚本在认证后落地的任意页面点运行都能取到课表。
 * 教务站：https://bkzhjx.wh.sdu.edu.cn/jsxsd/（域名带 wh，青岛校区学生同样使用，
 *        实测环境为青岛校区）
 * 课表页：#timetable 表格 + div.kbcontent（每格 div.kbcontent1 只有课名/周次/教室，
 *        div.kbcontent 才是完整块，含教师与「周次(节次)」）。
 * 限制：学期下拉只有当前学期一项，切换学期后课表为空，因此只支持当前学期。
 *
 * 来源与差异：骨架参考仓库内 resources/NJFU/njfu_01.js（同为强智老版 #timetable 结构），
 * 针对本校实测差异改写：①周次文本带「第」前缀（第4-17周(周)[01-02节]），解析前先剥离；
 * ②「教室」字段把教学楼名重复拼接（青岛校区振声苑青岛校区振声苑W102），按 jxlmc 收敛；
 * ③课表页没有单双周标记，也没有任何节次时分，作息由脚本内置（见 TIME_SLOTS 注释）。
 */

const TIMETABLE_URL = "/jsxsd/xskb/xskb_list.do?viweType=0&zc=&cj0701id=";
const CURRENT_WEEK_URL = "/jsxsd/framework/xsMainV_new.htmlx?t1=1";

/* 节次时间：教务站不返回每节具体时分（课表页、首页课表挂件、jxzlzc_xnxq_ajax、校历接口都没有），
 * 这里按青岛校区作息内置：每节 50 分钟、课间 10 分钟（第 2/3 节与第 6/7 节之间是大课间 20 分钟），
 * 上午 08:00 起、下午 14:00 起、晚上 19:00 起。
 * 注意 #timetable 的一个格对应两个小节（01-02 / 03-04 / 05-06 / 07-08 / 09-11），
 * 中间是有课间休息的，所以课程记作 startSection..endSection 两个独立小节，而不是合成长课。 */
const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:50" },
    { number: 6, startTime: "15:00", endTime: "15:50" },
    { number: 7, startTime: "16:10", endTime: "17:00" },
    { number: 8, startTime: "17:10", endTime: "18:00" },
    { number: 9, startTime: "19:00", endTime: "19:50" },
    { number: 10, startTime: "20:00", endTime: "20:50" },
    { number: 11, startTime: "21:00", endTime: "21:50" }
];

const DEFAULT_CLASS_DURATION = 50;
const DEFAULT_BREAK_DURATION = 10;
const DEFAULT_TOTAL_WEEKS = 20;

/* 校区前缀：青岛校区振声苑W102 -> 振声苑W102 */
const CAMPUS_PREFIX = /^(?:山东大学)?(?:青岛校区|威海校区|济南校区|中心校区|洪家楼校区|趵突泉校区|千佛山校区|软件园校区|兴隆山校区)/;

function showToast(message) {
    if (typeof window.shiguangBridge !== "undefined") {
        window.shiguangBridge.showToast(message);
    } else {
        console.log(message);
    }
}

function textOf(node) {
    return node ? (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim() : "";
}

function parseWeeks(rawText) {
    const text = String(rawText || "")
        .replace(/\s+/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/周次[:：]?/g, "");

    let globalParity = null;
    if (/[(（]单[)）]|单周/.test(text)) globalParity = "odd";
    else if (/[(（]双[)）]|双周/.test(text)) globalParity = "even";

    const weeks = new Set();

    text.split(/[,，;；]/).forEach((segment) => {
        if (!segment) return;
        const parity = segment.includes("单") ? "odd" : segment.includes("双") ? "even" : globalParity;
        const numbers = segment
            .replace(/第/g, "")
            .replace(/[^0-9\-—－~～、]/g, " ")
            .trim();
        if (!numbers) return;

        numbers.split(/[\s、]+/).forEach((part) => {
            const match = part.match(/^(\d+)(?:[-—－~～](\d+))?$/);
            if (!match) return;
            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);
            if (!start || !end || end < start) return;
            for (let week = start; week <= end && week <= 30; week++) {
                if (parity === "odd" && week % 2 === 0) continue;
                if (parity === "even" && week % 2 !== 0) continue;
                weeks.add(week);
            }
        });
    });

    return Array.from(weeks).sort((a, b) => a - b);
}

function cleanCourseName(rawName) {
    return String(rawName || "")
        .replace(/\s*[(（][^()（）]*班\s*[)）]\s*$/, "")
        .replace(/\s*[(（][A-Za-z][A-Za-z0-9]*\s*[-—－]\s*[0-9A-Za-z]*\s*[)）]\s*$/, "")
        .replace(/\s*[(（]\s*[)）]\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

/* 去掉开头的校区前缀：青岛校区振声苑W102 -> 振声苑W102 */
function stripCampusPrefix(text) {
    let out = String(text || "");
    let previous;
    do {
        previous = out;
        out = out.replace(CAMPUS_PREFIX, "");
    } while (out !== previous);
    return out;
}

function cleanPosition(roomText, buildingText) {
    const room = String(roomText || "").replace(/\s+/g, "");
    const building = stripCampusPrefix(String(buildingText || "").replace(/[【】\s]/g, "").trim());
    let text = stripCampusPrefix(room);

    if (building) {
        /* 教室字段会把教学楼名拼接多次：青岛校区振声苑青岛校区振声苑W102、会文南楼会文南楼225报告厅，
         * 取最后一次出现的位置，只保留一份教学楼名 + 房间号。 */
        if (!text) {
            text = building;
        } else if (text.includes(building)) {
            text = text.slice(text.lastIndexOf(building));
        } else {
            text = building + text;
        }
    }

    text = text.replace(/^[-—－:：]+/, "").trim();
    return text || "待定";
}

function parseSectionRange(weekText, fallbackSections) {
    const bracket = String(weekText || "").match(/\[([^\]]*)\]节/);
    const values = bracket ? (bracket[1].match(/\d+/g) || []).map(Number) : [];
    if (values.length) {
        return { startSection: values[0], endSection: values[values.length - 1] };
    }
    return fallbackSections || { startSection: 0, endSection: 0 };
}

/* 行标签形如「第一节 (01,02小节)」「第五节 (09,10,11小节)」，括号里才是真实小节号 */
function parseRowSections(labelText) {
    const text = String(labelText || "");
    const inner = text.match(/[（(]([\d,，\s]+)小节[)）]/);
    const values = (inner ? inner[1] : text).match(/\d+/g);
    if (!values || !values.length) return { startSection: 0, endSection: 0 };
    return {
        startSection: Number(values[0]),
        endSection: Number(values[values.length - 1])
    };
}

/* 课程块第一行是课名，形如「课程名(sd00000000 - 0 )」 */
function firstLineOf(div) {
    const clone = div.cloneNode(true);
    clone.querySelectorAll(".item-box").forEach((node) => node.remove());
    clone.querySelectorAll('font[name="wkxx"]').forEach((node) => node.remove());
    const firstLine = (clone.innerHTML || "").split(/<br\s*\/?>/i)[0];
    const temp = document.createElement("div");
    temp.innerHTML = firstLine;
    return textOf(temp);
}

function parseCourseBlock(blockHtml, day, fallbackSections) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = blockHtml;

    const weekText = textOf(tempDiv.querySelector('font[title="周次(节次)"]')) || textOf(tempDiv.querySelector('font[title="周次"]'));
    if (!weekText) return null;

    const wkxx = textOf(tempDiv.querySelector('font[name="wkxx"]'));
    let weeks = parseWeeks(weekText);
    if (weeks.length && /单/.test(wkxx) && !/双/.test(wkxx)) weeks = weeks.filter((week) => week % 2 === 1);
    if (weeks.length && /双/.test(wkxx) && !/单/.test(wkxx)) weeks = weeks.filter((week) => week % 2 === 0);

    if (!weeks.length) return null;

    const teacher = textOf(tempDiv.querySelector('font[title="教师"]')) || "未知";
    let name = cleanCourseName(firstLineOf(tempDiv));
    if (name && teacher && name.endsWith(teacher)) {
        name = name.slice(0, -teacher.length).trim();
    }
    if (!name) return null;

    const building = textOf(tempDiv.querySelector('font[name="jxlmc"]'))
        || textOf(tempDiv.querySelector('font[title="教学楼"]'));
    const position = cleanPosition(textOf(tempDiv.querySelector('font[title="教室"]')), building);

    const sections = parseSectionRange(weekText, fallbackSections);
    if (!sections.startSection || !sections.endSection) return null;

    return {
        name,
        teacher,
        position,
        day,
        startSection: sections.startSection,
        endSection: sections.endSection,
        weeks
    };
}

function buildDayMap(headerRow) {
    const map = new Map();
    if (!headerRow) return map;

    const cells = Array.from(headerRow.querySelectorAll("td,th"));
    const names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
    cells.forEach((cell, index) => {
        const label = textOf(cell).replace(/\s+/g, "");
        const day = names.findIndex((name) => label.includes(name));
        if (day >= 0) map.set(index, day + 1);
    });
    return map;
}

function extractCoursesFromDoc(doc) {
    const table = doc.getElementById("timetable");
    if (!table) {
        throw new Error("未获取到课表表格，请确认当前账号已登录教务系统。");
    }

    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return [];

    const dayMap = buildDayMap(rows[0]);
    const courses = [];

    rows.forEach((row, rowIndex) => {
        if (!rowIndex) return;

        const cells = Array.from(row.querySelectorAll("td,th"));
        if (cells.length < 3) return;

        const labelText = textOf(cells[0]);
        if (!labelText || labelText.includes("备注")) return;

        const fallbackSections = parseRowSections(labelText);

        cells.forEach((cell, cellIndex) => {
            if (cell.tagName === "TH") return;
            const day = dayMap.get(cellIndex) || cellIndex;
            if (day < 1 || day > 7) return;

            Array.from(cell.querySelectorAll("div.kbcontent")).forEach((div) => {
                const html = (div.innerHTML || "").trim();
                if (!html || html === "&nbsp;") return;

                const blocks = html.split(/-{10,}\s*<br\s*\/?>/i).filter((item) => item.trim());
                if (!blocks.length) blocks.push(html);

                blocks.forEach((block) => {
                    const course = parseCourseBlock(block, day, fallbackSections);
                    if (course) courses.push(course);
                });
            });
        });
    });

    const uniqueMap = new Map();
    courses.forEach((course) => {
        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.startSection,
            course.endSection,
            course.weeks.join(",")
        ].join("|");
        if (!uniqueMap.has(key)) uniqueMap.set(key, course);
    });

    return Array.from(uniqueMap.values());
}

function parseSemesterOptions(doc) {
    const select = doc.getElementById("xnxq01id");
    if (!select) return { labels: [], values: [], defaultIndex: 0 };

    const labels = [];
    const values = [];
    let defaultIndex = 0;

    Array.from(select.querySelectorAll("option")).forEach((option) => {
        labels.push(textOf(option));
        values.push(option.value);
        if (option.selected || option.hasAttribute("selected")) {
            defaultIndex = labels.length - 1;
        }
    });

    return { labels, values, defaultIndex };
}

async function fetchTimetableHtml(termValue) {
    if (!termValue) {
        const response = await fetch(TIMETABLE_URL, { credentials: "include" });
        return response.text();
    }

    const body = new URLSearchParams();
    body.append("xnxq01id", termValue);
    body.append("viweType", "0");
    body.append("zc", "");
    body.append("cj0701id", "");

    const response = await fetch("/jsxsd/xskb/xskb_list.do", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include"
    });
    return response.text();
}

function looksLikeLoginPage(html) {
    if (!html) return true;
    if (html.indexOf('id="timetable"') >= 0) return false;
    return /id="yhm"|loginTemp|cas\/login|location\.href\s*=\s*["'][^"']*login/i.test(html);
}

async function fetchTermDoc(termValue) {
    const html = await fetchTimetableHtml(termValue);
    if (looksLikeLoginPage(html)) {
        throw new Error("会话已失效或未登录教务系统，请在浏览器中登录后重试。");
    }
    return new DOMParser().parseFromString(html, "text/html");
}

async function pickTerm(doc) {
    const { labels, values, defaultIndex } = parseSemesterOptions(doc);
    /* 山东大学的学期下拉只有当前学期一项，切到其它学期课表为空，因此不再弹窗 */
    if (labels.length <= 1 || typeof window.shiguangBridgePromise === "undefined") {
        return { doc, termLabel: labels[defaultIndex] || "" };
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择要导入的学期",
        JSON.stringify(labels),
        defaultIndex
    );
    if (selectedIndex === null || selectedIndex === -1) {
        throw new Error("已取消导入");
    }

    if (selectedIndex === defaultIndex) {
        return { doc, termLabel: labels[selectedIndex] };
    }

    const selectedDoc = await fetchTermDoc(values[selectedIndex]);
    return { doc: selectedDoc, termLabel: labels[selectedIndex] };
}

function formatDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

async function fetchSemesterStartDate() {
    try {
        const response = await fetch(CURRENT_WEEK_URL, { credentials: "include" });
        const html = await response.text();
        const match = html.match(/教学第\s*(\d+)\s*周/);
        if (!match) return null;

        const currentWeek = Number(match[1]);
        if (!currentWeek || currentWeek < 1) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekday = today.getDay() === 0 ? 7 : today.getDay();
        const thisMonday = new Date(today.getTime() - (weekday - 1) * 86400000);
        const firstMonday = new Date(thisMonday.getTime() - (currentWeek - 1) * 7 * 86400000);
        return formatDate(firstMonday);
    } catch (error) {
        console.warn("获取当前教学周失败，跳过学期开始日期", error);
        return null;
    }
}

async function saveToApp(courses) {
    const maxWeek = courses
        .flatMap((course) => course.weeks || [])
        .reduce((max, week) => Math.max(max, week), 0);
    const semesterTotalWeeks = Math.max(maxWeek, DEFAULT_TOTAL_WEEKS);

    if (typeof window.shiguangBridgePromise === "undefined") {
        console.log("Time slots:", TIME_SLOTS);
        console.log("Courses:", courses);
        alert(`解析完成：共 ${courses.length} 门课程。请查看控制台输出。`);
        return;
    }

    const semesterStartDate = await fetchSemesterStartDate();
    const config = {
        semesterTotalWeeks,
        defaultClassDuration: DEFAULT_CLASS_DURATION,
        defaultBreakDuration: DEFAULT_BREAK_DURATION,
        firstDayOfWeek: 1
    };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function runImportFlow() {
    try {
        showToast("正在获取 山东大学课表数据...");

        const initialDoc = await fetchTermDoc("");
        const { doc, termLabel } = await pickTerm(initialDoc);
        const courses = extractCoursesFromDoc(doc);

        if (!courses.length) {
            throw new Error("未解析到课程，请确认当前账号已登录教务系统且本学期有课。");
        }

        await saveToApp(courses);

        const message = `导入完成：山东大学${termLabel ? ` ${termLabel}` : ""}，共 ${courses.length} 门课程`;

        showToast(message);
        if (typeof window.shiguangBridge !== "undefined") {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error(error);
        showToast(`导入失败: ${error.message}`);
    }
}

runImportFlow();
