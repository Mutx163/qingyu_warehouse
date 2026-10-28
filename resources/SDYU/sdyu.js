/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 山东青年政治学院（jw.sdyu.edu.cn）拾光课程表适配脚本
// 基于正方教务 jwglxt（V-9.0）接口适配，已于 2026-10-28 在山东青年政治学院教务系统实测通过
//
// 数据来源（均为同源接口，复用浏览器已登录会话，无需任何账号密码）：
//   课表：POST /jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508   body: xnm&xqm&kzlx=ck&xsdm
//   周次/开学日期：POST /jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N253508
//   作息(节次时间)：POST /jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N253508
//   学年学期下拉：GET  /jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default
//
// 使用方式：登录教务系统后，在任意页面点击「执行导入」。脚本会自动读取学年学期供选择，
// 自动获取开学日期、总周数，并按教务系统真实作息表写入节次时间。
// 解析逻辑参考本仓库 DZU(德州学院)、SDNU(山东师范大学) 的正方 jwglxt 适配。
// 非该校在校开发者适配，出现问题请提交 issue 或 PR。

const COURSE_API_URL = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508";
const WEEK_API_URL = "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N253508";
const SECTION_API_URL = "/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N253508";
const INDEX_API_URL = "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default";

// 兜底作息：接口取不到时使用（取自山东青年政治学院教务系统 cxRjc 实测值）
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:01", endTime: "09:40" },
    { number: 3, startTime: "09:55", endTime: "10:35" },
    { number: 4, startTime: "10:35", endTime: "11:15" },
    { number: 5, startTime: "11:20", endTime: "12:00" },
    { number: 6, startTime: "13:40", endTime: "14:20" },
    { number: 7, startTime: "14:20", endTime: "15:00" },
    { number: 8, startTime: "15:15", endTime: "15:55" },
    { number: 9, startTime: "15:56", endTime: "16:35" },
    { number: 10, startTime: "18:00", endTime: "18:40" },
    { number: 11, startTime: "18:40", endTime: "19:20" },
    { number: 12, startTime: "19:25", endTime: "20:05" }
];

// ===== 解析工具 =====
function parseSections(rawText) {
    const match = String(rawText || "").match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
    if (!match) return [];

    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
        return [];
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseWeeks(rawText) {
    const weeks = new Set();
    const normalized = String(rawText || "")
        .replace(/周数[:：]?/g, "")
        .replace(/第/g, "")
        .replace(/[，、；;]/g, ",")
        .replace(/（/g, "(")
        .replace(/）/g, ")");

    normalized.split(",").forEach((segment) => {
        const cleanSegment = segment.replace(/周/g, "").trim();
        if (!cleanSegment) return;

        const isOdd = cleanSegment.includes("单");
        const isEven = cleanSegment.includes("双");
        const rangeMatch = cleanSegment.match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
        if (!rangeMatch) return;

        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2] || rangeMatch[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) return;

        for (let week = start; week <= end; week += 1) {
            if (isOdd && week % 2 === 0) continue;
            if (isEven && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });

    return Array.from(weeks).sort((left, right) => left - right);
}

/**
 * 节次与周次合并去重（同官方 Wiki《课程合并与去重函数》）
 * - 连续节次合并：1-2 节 + 3-4 节 → 1-4 节
 * - 同节次周次合并：单周 + 双周 → 全周
 * - 完全重复条目去重、周次排序
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 解析个人课表接口返回的 JSON（kbList）。
 * 字段：kcmc(课名) xm(教师) cdmc(教室) xqj(星期1-7) jcs(节次如"6-7") zcd(周次如"5-6周,8-17周")
 */
function parseApiData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        throw new Error("教务系统返回的课表数据结构异常，请联系适配器维护者。");
    }

    const courses = jsonData.kbList.flatMap((rawCourse) => {
        const name = String(rawCourse.kcmc || "").trim();
        const teacher = String(rawCourse.xm || "未知").trim() || "未知";
        const position = String(rawCourse.cdmc || "待定").trim() || "待定";
        const day = Number(rawCourse.xqj);
        const sections = parseSections(rawCourse.jcs);
        const weeks = parseWeeks(rawCourse.zcd);

        if (!name || !Number.isInteger(day) || day < 1 || day > 7 || !sections.length || !weeks.length) {
            return [];
        }

        return [{
            name,
            teacher,
            position,
            day,
            startSection: sections[0],
            endSection: sections[sections.length - 1],
            weeks
        }];
    });

    return mergeAndDistinctCourses(courses).sort((left, right) =>
        left.day - right.day ||
        left.startSection - right.startSection ||
        left.name.localeCompare(right.name)
    );
}

// ===== 学年学期 =====
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "山东青年政治学院课表导入",
        "请先在当前浏览器登录山东青年政治学院教务系统。登录成功后可在教务系统任意页面开始导入。",
        "开始导入"
    );
}

/**
 * 读取学年学期下拉（已实测：#xnm 学年下拉、#xqm 学期下拉，学期码 3=第一学期、12=第二学期、16=第三学期）
 */
async function fetchAcademicOptions() {
    try {
        const response = await fetch(INDEX_API_URL, { method: "GET", credentials: "include" });
        if (!response.ok) return null;

        const htmlText = await response.text();
        // 未登录时返回登录页，无下拉框
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        const now = new Date();
        const defaultYear = String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
        const defaultSemester = (now.getMonth() >= 7 || now.getMonth() === 0) ? "3" : "12";

        const sysYearIndex = allYearOptions.findIndex(opt => opt.selected);
        const calcYearIndex = allYearOptions.findIndex(opt => opt.value === defaultYear);
        const defaultYearIndex = sysYearIndex !== -1 ? sysYearIndex
            : (calcYearIndex !== -1 ? calcYearIndex : 0);

        const sysSemIndex = semesterOptions.findIndex(opt => opt.selected);
        const calcSemIndex = semesterOptions.findIndex(opt => opt.value === defaultSemester);
        const defaultSemesterIndex = sysSemIndex !== -1 ? sysSemIndex
            : (calcSemIndex !== -1 ? calcSemIndex : 0);

        return { allYearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex };
    } catch (e) {
        return null;
    }
}

async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        window.shiguangBridge.showToast("自动读取学年学期失败，改为手动输入。");
        return await manualSelectAcademicYearAndSemester();
    }

    const { allYearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(allYearOptions.map(item => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === undefined || yearIndex < 0) return null;
    const academicYear = allYearOptions[yearIndex].value;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map(item => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === undefined || semesterIndex < 0) return null;
    const semesterCode = semesterOptions[semesterIndex].value;

    return { academicYear, semesterCode };
}

async function manualSelectAcademicYearAndSemester() {
    const now = new Date();
    const defaultYear = String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
    const academicYear = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入学年的起始年份，例如 2026-2027 学年请输入 2026。",
        defaultYear,
        "validateYearInput"
    );
    if (academicYear === null) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期", "第三学期"]),
        now.getMonth() >= 7 || now.getMonth() === 0 ? 0 : 1
    );
    if (semesterIndex === null || semesterIndex === undefined || semesterIndex < 0) return null;
    const codes = ["3", "12", "16"];
    return { academicYear: String(academicYear).trim(), semesterCode: codes[semesterIndex] || "3" };
}

function validateYearInput(input) {
    return /^\d{4}$/.test(String(input || "").trim())
        ? false
        : "请输入四位数字的起始学年，例如 2026。";
}

// ===== 教务数据 =====
/**
 * 获取开学日期与总周数。返回数组每项含 rq（如 "2026-08-31/2026-09-06"）与 zs（周序号）。
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    try {
        const response = await fetch(WEEK_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });
        if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json) && json.length > 0) {
                const firstWeek = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
                let semesterStartDate = null;
                if (firstWeek.rq) {
                    const startDateStr = String(firstWeek.rq).split('/')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) semesterStartDate = startDateStr;
                }
                return { semesterStartDate, semesterTotalWeeks: json.length };
            }
        }
    } catch (e) {
        // 获取失败不影响主流程
    }
    return { semesterStartDate: null, semesterTotalWeeks: null };
}

/**
 * 获取教务系统真实作息（节次时间）。接口返回 [{jcmc:"1", qssj:"08:20", jssj:"09:00"}, ...]
 */
async function fetchTimeSlots(academicYear, semesterCode) {
    try {
        const response = await fetch(SECTION_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}&xqh_id=1`,
            credentials: "include"
        });
        if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json) && json.length > 0) {
                const slots = json
                    .map(item => ({
                        number: Number(item.jcmc),
                        startTime: String(item.qssj || "").trim(),
                        endTime: String(item.jssj || "").trim()
                    }))
                    .filter(item => Number.isInteger(item.number) && /^\d{2}:\d{2}$/.test(item.startTime) && /^\d{2}:\d{2}$/.test(item.endTime))
                    .sort((a, b) => a.number - b.number);
                if (slots.length > 0) return slots;
            }
        }
    } catch (e) {
        // 获取失败回退到内置作息
    }
    return FALLBACK_TIME_SLOTS;
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在获取课表数据...");

    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=`;

    const [courseResponse, semesterInfo, timeSlots] = await Promise.all([
        fetch(COURSE_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: requestBody,
            credentials: "include"
        }),
        fetchSemesterInfo(academicYear, semesterCode),
        fetchTimeSlots(academicYear, semesterCode)
    ]);

    if (!courseResponse.ok) {
        throw new Error(`请求课表失败（HTTP ${courseResponse.status}）。`);
    }

    const responseText = await courseResponse.text();
    if (courseResponse.redirected || /login_slogin|用户登录|<html/i.test(responseText.slice(0, 2000))) {
        throw new Error("登录状态已失效，请刷新教务系统页面重新登录后再试。");
    }

    let jsonData;
    try {
        jsonData = JSON.parse(responseText);
    } catch (error) {
        throw new Error("教务系统未返回有效课表数据，请确认已经登录。");
    }

    const courses = parseApiData(jsonData);
    if (!courses.length) {
        throw new Error("所选学期未查询到课程，请检查学年和学期是否正确。");
    }

    return { courses, semesterInfo, timeSlots };
}

// ===== 保存 =====
async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error("SDYU: Save courses error", error);
        await window.shiguangBridgePromise.showAlert("保存失败", `课程保存失败：${error.message}`, "确定");
        return false;
    }
}

async function saveOptionalSettings(courses, semesterInfo, timeSlots) {
    const config = {
        semesterStartDate: semesterInfo.semesterStartDate,
        semesterTotalWeeks: semesterInfo.semesterTotalWeeks || Math.max(...courses.flatMap(c => c.weeks)),
        firstDayOfWeek: 1
    };

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        let msg = "课表配置更新成功！";
        if (config.semesterStartDate) msg += " 开学日期：" + config.semesterStartDate;
        if (config.semesterTotalWeeks) msg += " 共" + config.semesterTotalWeeks + "周";
        window.shiguangBridge.showToast(msg);
    } catch (error) {
        console.error("SDYU: Save config error", error);
        window.shiguangBridge.showToast(`课表配置保存失败：${error.message}`);
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("作息时间写入成功，共 " + timeSlots.length + " 节");
    } catch (error) {
        console.error("SDYU: Save time slots error", error);
        window.shiguangBridge.showToast(`作息时间保存失败：${error.message}`);
    }
}

// ===== 主流程 =====
async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    const { academicYear, semesterCode } = selection;

    let result;
    try {
        result = await fetchAndParseCourses(academicYear, semesterCode);
    } catch (error) {
        console.error("SDYU: Fetch or parse error", error);
        await window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
        return;
    }

    const saved = await saveCourses(result.courses);
    if (!saved) return;

    await saveOptionalSettings(result.courses, result.semesterInfo, result.timeSlots);
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${result.courses.length} 条课程安排。`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
