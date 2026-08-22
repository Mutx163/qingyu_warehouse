// CDUTCM_01.js
// 成都中医药大学教务系统适配脚本
// 系统厂商：广州乘方科技有限公司（CFKJ / entss）
// 课表入口：/xsgrkbcx!xsgrkbMain.action -> 「我的课表」iframe
// 课表数据：/xsgrkbcx!xsAllKbList.action?xnxqdm=YYYYNN
//   - xnxqdm 形如 202601（2026-2027 学年第 1 学期）
//   - 返回 HTML 页面，内嵌 `var kbxx = [...]` JSON 数组
//   - 单周数据接口：/xsgrkbcx!xskbList.action?xnxqdm=X&zc=N（备用）
//
// 数据对象字段：
//   kcmc     课程名
//   kcbh     课程编号
//   jxbmc    教学班名称（如 "中医学2024级2班[22-42]"）
//   kcrwdm   教学任务代码（用于 view 详情）
//   jcdm2    节次代码（"01,02,03" 表示 1-3 节连堂；"00" 表示早读，每日 8:30 第 01 节之前）
//   zcs      周次数组（逗号分隔的离散数字，如 "16,15,14,13,18,17"）
//   xq       星期（字符串 "1"-"7"）
//   jxcdmcs  教学场地（可能为空，多场地逗号分隔）
//   teaxms   授课教师（可能为空，多教师逗号分隔）

// ===== 解析周次字符串为升序 number[] =====
function parseWeeks(zcs) {
    if (!zcs) return [];
    const set = new Set();
    String(zcs).split(',').forEach(part => {
        const n = parseInt(String(part).trim(), 10);
        if (!isNaN(n) && n > 0) set.add(n);
    });
    return Array.from(set).sort((a, b) => a - b);
}

// ===== 解析节次字符串为 number[]（保留 0，便于识别早读）=====
function parsePeriods(jcdm2) {
    if (!jcdm2) return [];
    return String(jcdm2).split(',')
        .map(s => parseInt(String(s).trim(), 10))
        .filter(n => !isNaN(n));
}

// ===== 早读默认时段（每日 8:20 结束、第 01 节 8:30 开始）=====
const MORNING_READING_START = '08:00';
const MORNING_READING_END = '08:20';

// ===== 时间模板（节次时间表，CDUTCM 教务不直接暴露）=====
// 推导规则：每节 40 分钟，节间 10 分钟
//   00 早读：08:00-08:20
//   01-05 上午：08:30 起
//   06-09 下午：14:00 起
//   10-12 晚上：18:30 起
const TIME_SLOTS = [
    { number: 0,  startTime: '08:00', endTime: '08:20' },
    { number: 1,  startTime: '08:30', endTime: '09:10' },
    { number: 2,  startTime: '09:20', endTime: '10:00' },
    { number: 3,  startTime: '10:10', endTime: '10:50' },
    { number: 4,  startTime: '11:00', endTime: '11:40' },
    { number: 5,  startTime: '11:50', endTime: '12:30' },
    { number: 6,  startTime: '14:00', endTime: '14:40' },
    { number: 7,  startTime: '14:50', endTime: '15:30' },
    { number: 8,  startTime: '15:40', endTime: '16:20' },
    { number: 9,  startTime: '16:30', endTime: '17:10' },
    { number: 10, startTime: '18:30', endTime: '19:10' },
    { number: 11, startTime: '19:20', endTime: '20:00' },
    { number: 12, startTime: '20:10', endTime: '20:50' }
];

// ===== 学期配置（学期开始日期运行时询问用户；其他字段为合理默认值）=====
const SEMESTER_DEFAULT_START_DATE = '2026-08-31';   // 默认 8 月底开学，可改
const SEMESTER_TOTAL_WEEKS = 22;                    // 从课表页 zc 下拉框推断
const DEFAULT_CLASS_DURATION = 40;                  // 分钟
const DEFAULT_BREAK_DURATION = 10;                  // 分钟
const FIRST_DAY_OF_WEEK = 1;                        // 周一

function isValidDateString(s) {
    if (!s) return false;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(s);
    if (isNaN(date.getTime())) return false;
    // round-trip 校验：避免 2025-02-29 被 JS 自动规范化成 2025-03-01
    return date.getFullYear() === year
        && date.getMonth() + 1 === month
        && date.getDate() === day;
}

// 运行时弹窗询问学期开始日期（YYYY-MM-DD）
async function promptSemesterStartDate() {
    while (true) {
        const input = await window.AndroidBridgePromise.showPrompt(
            '学期开始日期',
            '请输入本学期第一周周一的日期（YYYY-MM-DD）',
            SEMESTER_DEFAULT_START_DATE,
            null
        );
        if (input === null) return null;  // 用户取消
        if (isValidDateString(input)) return input;
        const retry = await window.AndroidBridgePromise.showAlert(
            '日期格式错误',
            `请输入 YYYY-MM-DD 格式，例如 ${SEMESTER_DEFAULT_START_DATE}`,
            '重试'
        );
    }
}

// ===== 拆分教学班名称中的 [N-M] 班分子 =====
function splitClassInfo(jxbmc) {
    const text = String(jxbmc || '').trim();
    const m = text.match(/^(.*?)\[(\d+)-(\d+)\]\s*$/);
    if (m) {
        return { base: m[1].trim(), range: `${m[2]}-${m[3]}` };
    }
    return { base: text, range: '' };
}

// ===== 解析单个 kbxx 项为课程对象 =====
function kbxxItemToCourse(item) {
    const day = parseInt(String(item.xq || '').trim(), 10);
    if (isNaN(day) || day < 1 || day > 7) return null;

    const name = String(item.kcmc || '').trim();
    if (!name) return null;

    const weeks = parseWeeks(item.zcs);
    if (weeks.length === 0) return null;

    const teacher = String(item.teaxms || '').trim();
    const position = String(item.jxcdmcs || '').trim();

    const classInfo = splitClassInfo(item.jxbmc);
    const noteParts = [];
    if (classInfo.base) noteParts.push(classInfo.base);
    if (classInfo.range) noteParts.push(`班分子 ${classInfo.range}`);
    const note = noteParts.join(' · ');

    const startWeek = weeks[0];
    const endWeek = weeks[weeks.length - 1];

    const baseFields = {
        // 桥接最低字段（强制保留）
        name,
        teacher,
        position,
        day,
        weeks,
        // 扩展字段（稳定识别就补）
        description: note,
        note,
        location: position,
        dayOfWeek: day,
        startWeek,
        endWeek
    };

    const periods = parsePeriods(item.jcdm2);

    // 早读（jcdm2="00"）：每日固定时段，发生在第 01 节 8:30 之前
    if (periods.length === 1 && periods[0] === 0) {
        return Object.assign({}, baseFields, {
            isCustomTime: true,
            customStartTime: MORNING_READING_START,
            customEndTime: MORNING_READING_END
        });
    }

    // 普通节次课程（连堂取 min/max）
    if (periods.length === 0) return null;
    const startSection = Math.min(...periods);
    const endSection = Math.max(...periods);
    if (startSection > endSection) return null;

    return Object.assign({}, baseFields, {
        startSection,
        endSection,
        courseNature: undefined
    });
}

// ===== 把整个 kbxx 数组转换为课程列表（含去重）=====
function parseKbxxToCourses(kbxx) {
    if (!Array.isArray(kbxx) || kbxx.length === 0) return [];

    const seen = new Map();
    kbxx.forEach(item => {
        const course = kbxxItemToCourse(item);
        if (!course) return;

        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.isCustomTime ? 'custom:' + (course.customStartTime || '') + '-' + (course.customEndTime || '') : (course.startSection + '-' + course.endSection),
            course.weeks.join(',')
        ].join('__');

        if (!seen.has(key)) seen.set(key, course);
    });

    return Array.from(seen.values()).sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        // 早读排在普通课之前
        if (a.isCustomTime && !b.isCustomTime) return -1;
        if (!a.isCustomTime && b.isCustomTime) return 1;
        if (a.isCustomTime && b.isCustomTime) return 0;
        return a.startSection - b.startSection ||
            a.endSection - b.endSection ||
            a.name.localeCompare(b.name);
    });
}

// ===== 从课表入口页 HTML 提取学期下拉框 =====
function extractSemesterOptions(htmlText) {
    const selectMatch = htmlText.match(/<select[^>]*id=['"]xnxqdm['"][^>]*>([\s\S]*?)<\/select>/i);
    if (!selectMatch) return null;

    const options = [];
    const optionRe = /<option[^>]*value=['"]([^'"]+)['"]([^>]*)>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = optionRe.exec(selectMatch[1])) !== null) {
        const value = (m[1] || '').trim();
        const attrs = m[2] || '';
        const label = (m[3] || '').replace(/<[^>]+>/g, '').trim();
        if (!value || !label) continue;
        const selected = /selected/i.test(attrs);
        options.push({ value, label, selected });
    }
    if (options.length === 0) return null;
    return options;
}

// ===== 从全部周课表 HTML 提取 kbxx JSON =====
function extractKbxx(htmlText) {
    // 匹配 `var kbxx = [...]` 或 `kbxx = [...]`
    const match = htmlText.match(/(?:var\s+)?kbxx\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match || !match[1]) return null;
    try {
        return JSON.parse(match[1]);
    } catch (e) {
        console.warn('CDUTCM: kbxx JSON.parse failed', e);
        return null;
    }
}

// ===== 带 timeout 的 fetch（默认 15 秒）+ Referer 头 ======
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
        clearTimeout(timeoutId);
    }
}

// ===== 抓取全部周课表 HTML =====
async function fetchAllKbList(xnxqdm) {
    const url = `/xsgrkbcx!xsAllKbList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`;
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Referer': 'https://jwweb.cdutcm.edu.cn/xsgrkbcx!xsgrkbMain.action',
            'X-Requested-With': 'XMLHttpRequest'
        }
    });
    if (!response.ok) {
        throw new Error(`课表请求失败（HTTP ${response.status}）`);
    }
    return await response.text();
}

// ===== 抓取「我的课表」iframe 页（含 xnxqdm 学期下拉框）=====
//   - 入口页 /xsgrkbcx!xsgrkbMain.action 本身不含学期下拉框
//   - 学期下拉框在「我的课表」iframe: /xsgrkbcx!getXsgrbkList.action?xnxqdm=202601
//   - 当前学期可从页面 <option selected> 读取
async function fetchXsgrkbListPage() {
    // 当前年 + 上学年 秋季学期码（避免 4 次循环导致总超时）
    const currentYear = new Date().getFullYear();
    const candidateXnxqdm = [`${currentYear}01`, `${currentYear - 1}01`];
    let lastError = null;
    for (const xnxqdm of candidateXnxqdm) {
        try {
            const response = await fetchWithTimeout(
                `/xsgrkbcx!getXsgrbkList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`,
                {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Referer': 'https://jwweb.cdutcm.edu.cn/xsgrkbcx!xsgrkbMain.action',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                }
            );
            if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
            const text = await response.text();
            if (extractSemesterOptions(text)) return text;
        } catch (e) {
            lastError = e.message || String(e);
        }
    }
    throw new Error(
        `无法获取学期下拉框（${lastError || '无可用学期码'}）。` +
        `请先在浏览器里手动打开「信息查询 → 学生个人课表查询 → 我的课表」后再运行脚本。`
    );
}

// ===== 主流程 =====
async function runImportFlow() {
    try {
        AndroidBridge.showToast('开始读取课表入口...');

        const listHtml = await fetchXsgrkbListPage();
        const semesters = extractSemesterOptions(listHtml);
        if (!semesters) {
            throw new Error('未找到学期下拉框（页面结构可能已变），请检查抓取目标是否正确');
        }

        const defaultIndex = Math.max(0, semesters.findIndex(s => s.selected));
        const labels = semesters.map(s => s.label);

        const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
            '选择学期',
            JSON.stringify(labels),
            defaultIndex
        );
        if (selectedIndex === null || selectedIndex < 0) {
            AndroidBridge.showToast('已取消导入');
            return;
        }

        const xnxqdm = semesters[selectedIndex].value;
        AndroidBridge.showToast(`正在获取 ${semesters[selectedIndex].label} 课表...`);

        const kbHtml = await fetchAllKbList(xnxqdm);
        const kbxx = extractKbxx(kbHtml);
        if (!kbxx || kbxx.length === 0) {
            throw new Error('该学期未解析到课表数据，请确认当前登录状态和所选学期');
        }

        const courses = parseKbxxToCourses(kbxx);
        if (courses.length === 0) {
            throw new Error('未能转换为有效课程，请检查课表数据是否完整');
        }

        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));

        const semesterStartDate = await promptSemesterStartDate();
        if (!semesterStartDate) {
            AndroidBridge.showToast('已取消（未提供学期开始日期）');
            return;
        }
        const courseConfig = {
            semesterStartDate: semesterStartDate,
            semesterTotalWeeks: SEMESTER_TOTAL_WEEKS,
            defaultClassDuration: DEFAULT_CLASS_DURATION,
            defaultBreakDuration: DEFAULT_BREAK_DURATION,
            firstDayOfWeek: FIRST_DAY_OF_WEEK
        };
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));

        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程、时间模板、学期配置`);
        AndroidBridge.notifyTaskCompletion();
    } catch (error) {
        console.error('CDUTCM import failed:', error);
        await window.AndroidBridgePromise.showAlert(
            '导入失败',
            error && error.message ? error.message : String(error),
            '确定'
        );
    }
}

runImportFlow();
