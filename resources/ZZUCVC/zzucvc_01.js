/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 郑州城建职业学院（青果 / KINGOSOFT 教务）拾光课程表适配脚本
//
// 【两个登录入口，执行导入时由脚本询问，用户自行选择】
//   入口 A 教务系统直连   https://jwxt.zzucvc.edu.cn/cas/login.action
//                         账号密码与教务系统一致，登录后直接在本页执行导入。
//   入口 B 智慧校园门户   https://portal.zzucvc.edu.cn/portal-pc/pc/zzcj/index.html#/
//                         统一身份认证入口。多数学生只在这里有账号、教务系统未单独
//                         开通密码，因此需从门户登录后由门户跳转进入教务系统。
//                         选择此入口时，脚本会给出跳转指引：在门户「应用中心 / 首页
//                         应用列表」中打开「教务管理系统」，待进入教务系统页面后，
//                         重新执行导入即可；整个取数过程与入口 A 完全相同。
//
// 本校实测接口（2026-11 抓包）：
//   当前学期    POST /jw/common/showYearTerm.action
//               → {"xn":"2026","xqM":"0",...}
//   学期列表    POST /frame/droplist/getDropLists.action
//               body: comboBoxName=Ms_KBBP_XNXQ&...
//               → [{"code":"2026,0","name":"2026-2027学年第一学期"},...]
//               注：同族的 Ms_KBBP_FBXKJGXNXQ 在本校返回 null，不能用
//   课表数据    GET  /wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=<base64(xn=..&xq=..)>
//               → GBK 编码 HTML 列表表格（课程/教师/时间地点分列，比周×节矩阵稳定）
//   开学日期    POST /frame/desk/showLessonScheduleInfosV14.action?xn=..&xq=..&jxz=1
//               → 第 1 周课表，表头形如 <td class="kb-content">一<br>08-31</td>
//   作息时间    POST /public/SchoolTimetable.show.jsp
//               body: menucode=&xn=..&xq_m=..&rad=1&is_ssxq=0&ssxq=&axq=
//               → 节次/开始/结束 三列表格；本校 2026-2027 暂未发布（返回“未设置作息时间！”），
//                 故按学期往前找最近一次公布的数据，全部未发布时用内置兜底并提示核对
//
// 学年学期编码：xn = 学年前年份（2026 即 2026-2027 学年），xq = 0 第一学期 / 1 第二学期

const HOST = 'https://jwxt.zzucvc.edu.cn';
const YEARTERM_URL = HOST + '/jw/common/showYearTerm.action';
const DROPLIST_URL = HOST + '/frame/droplist/getDropLists.action';
const KB_DATA_URL = HOST + '/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp';
const LESSON_INFO_URL = HOST + '/frame/desk/showLessonScheduleInfosV14.action';
const TIMETABLE_URL = HOST + '/public/SchoolTimetable.show.jsp';
const SCHOOL_CALENDAR_URL = HOST + '/public/SchoolCalendar.show.jsp';

const DROPLIST_BODY =
    'comboBoxName=Ms_KBBP_XNXQ&paramValue=&isYXB=0&isCDDW=0&isPYCC=0' +
    '&isPYCCNJ=0&zyPyccFiled=&isKBLB=0&isXQ=0&isBJ=0&isSXJD=0&isDJKSLB=0';

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

// 教务未公布作息时的兜底：取自本校 2025-2026 学年第二学期公布数据。
// 仅作最后手段（正常情况下走 fetchTimeSlots 回退到最近一次公布），导入后会提示核对。
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:30', endTime: '09:15' },
    { number: 2, startTime: '09:25', endTime: '10:10' },
    { number: 3, startTime: '10:20', endTime: '11:05' },
    { number: 4, startTime: '11:15', endTime: '12:00' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:55', endTime: '15:40' },
    { number: 7, startTime: '15:50', endTime: '16:35' },
    { number: 8, startTime: '16:45', endTime: '17:30' },
    { number: 9, startTime: '19:00', endTime: '19:45' },
    { number: 10, startTime: '19:55', endTime: '20:40' }
];

function validateYearInput(input) {
    if (/^\d{4}$/.test(String(input).trim())) return false;
    return '请输入四位数字学年，如 2026';
}

function validateDateInput(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input).trim())) return false;
    return '请输入正确格式的日期，如 2026-08-31';
}

// 本校接口编码不统一（实测）：课表 / 校历 / 作息页是 GBK，
// showLessonScheduleInfosV14 是 UTF-8。所以按响应头 + 内容兜底判断，
// 不能一律按 GBK 解，否则开学日期会解成乱码而匹配不到。
function decodeHtml(buf, contentType) {
    const tryDecode = (enc) => {
        try { return new TextDecoder(enc).decode(buf); } catch (e) { return null; }
    };
    const header = String(contentType || '').toLowerCase();
    // 响应头明确声明时直接用，不做猜测
    if (header.includes('utf-8')) {
        const t = tryDecode('utf-8');
        if (t !== null) return t;
    }
    if (header.includes('gbk') || header.includes('gb2312')) {
        const t = tryDecode('gbk');
        if (t !== null) return t;
    }
    // 响应头缺失或不可识别才按内容挑：合法解码得分更高的那个
    const score = (s) => {
        if (s === null) return -Infinity;
        const bad = (s.match(/�/g) || []).length;
        const cjk = (s.match(/[一-龥]/g) || []).length;
        return cjk * 2 - bad * 10;
    };
    const gbk = tryDecode('gbk');
    const utf8 = tryDecode('utf-8');
    return score(utf8) > score(gbk) ? utf8 : (gbk || utf8 || '');
}

async function fetchHtml(url, options) {
    const resp = await fetch(url, options);
    const buf = await resp.arrayBuffer();
    return decodeHtml(buf, resp.headers.get('Content-Type'));
}

// ---------- 学期 ----------

function parseTermCode(code) {
    const s = String(code == null ? '' : code).trim();
    // "2026,0" / "2026-0" / "20260" 三种形态都兼容
    let m = s.match(/^(\d{4})\s*[,\-]\s*(\d)$/);
    if (m) return { xn: m[1], xq: m[2] };
    m = s.match(/^(\d{4})(\d)$/);
    if (m) return { xn: m[1], xq: m[2] };
    return null;
}

async function fetchSemesterList() {
    try {
        const resp = await fetch(DROPLIST_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: DROPLIST_BODY,
            credentials: 'include'
        });
        const list = await resp.json();
        if (Array.isArray(list) && list.length > 0 && list[0].code) return list;
    } catch (e) { /* 回退到 showYearTerm 生成 */ }
    return null;
}

// 学期列表不可用时：以教务返回的当前学期为基准生成候选
function buildSemesterList(current) {
    const list = [];
    let xn = parseInt(current.xn, 10);
    let xq = current.xq === '1' ? 1 : 0;
    for (let i = 0; i < 8; i++) {
        list.push({
            code: xn + ',' + xq,
            name: xn + '-' + (xn + 1) + '学年' + (xq === 0 ? '第一学期' : '第二学期')
        });
        if (xq === 0) { xn -= 1; xq = 1; } else { xq = 0; }
    }
    return list;
}

async function fetchCurrentTerm() {
    try {
        const resp = await fetch(YEARTERM_URL, { method: 'POST', credentials: 'include' });
        const data = JSON.parse(await resp.text());
        if (data && data.xn) {
            return { xn: String(data.xn), xq: String(data.xqM === 1 || data.xqM === '1' ? '1' : '0') };
        }
    } catch (e) { /* 由调用方回退到手动输入 */ }
    return null;
}

async function selectSemester() {
    const current = await fetchCurrentTerm();

    let list = await fetchSemesterList();
    if (!list && current) list = buildSemesterList(current);

    if (!list) {
        const year = await window.shiguangBridgePromise.showPrompt(
            '选择学年', '请输入学年的前年份，如 2026 表示 2026-2027 学年：', '2026', 'validateYearInput'
        );
        if (year === null) return null;
        const xq = await window.shiguangBridgePromise.showSingleSelection(
            '选择学期', JSON.stringify(['第一学期', '第二学期']), 0
        );
        if (xq === null) return null;
        return { xn: String(year).trim(), xq: String(xq) };
    }

    let defaultIndex = 0;
    if (current) {
        const idx = list.findIndex(item => {
            const t = parseTermCode(item.code);
            return t && t.xn === current.xn && t.xq === current.xq;
        });
        if (idx >= 0) defaultIndex = idx;
    }

    const names = list.slice(0, 10).map(item => item.name);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        '选择导入学期', JSON.stringify(names), defaultIndex
    );
    if (index === null || index < 0 || index >= names.length) return null;

    const term = parseTermCode(list[index].code);
    if (!term || !/^\d{4}$/.test(term.xn)) return null;
    return term;
}

// ---------- 课表数据 ----------

async function fetchCourseHtml(xn, xq) {
    const params = btoa('xn=' + xn + '&xq=' + xq);
    const html = await fetchHtml(KB_DATA_URL + '?params=' + params, { credentials: 'include' });
    if (!html || html.includes('凭证已失效') || html.includes('请重新登录')) return null;
    return html;
}

// 一个课程行只保留可见的 12 列，隐藏域（id="trN_..." style="display:none"）不算
function visibleCells(row) {
    return Array.from(row.querySelectorAll('td')).filter(td => td.style.display !== 'none');
}

// 教师列形如 "[2320210020]姜紫云" 或 "[1]张三 [2]李四"
function cleanTeacher(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const names = [];
    const re = /\[[^\]]*\]\s*([^\[\]]+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const n = m[1].replace(/[;；,，]/g, ' ').trim();
        if (n) names.push(n);
    }
    if (names.length > 0) return names.join('、');
    return raw.replace(/[;；]/g, '、').trim();
}

// 周次表达式 → 升序数组。支持 "5-18"、"1-4,6-8"、"3"、"1-16"(单)，单双周在展开时过滤
function parseWeekSpec(spec, parity) {
    const weeks = [];
    for (const part of String(spec || '').split(/[,，]/)) {
        const p = part.trim();
        if (!p) continue;
        const range = p.match(/^(\d{1,2})\s*[-—~－]\s*(\d{1,2})$/);
        if (range) {
            const s = parseInt(range[1], 10), e = parseInt(range[2], 10);
            if (e < s) continue;
            for (let w = s; w <= e; w++) {
                if (parity === '单' && w % 2 === 0) continue;
                if (parity === '双' && w % 2 === 1) continue;
                weeks.push(w);
            }
        } else if (/^\d{1,2}$/.test(p)) {
            const w = parseInt(p, 10);
            if (parity === '单' && w % 2 === 0) continue;
            if (parity === '双' && w % 2 === 1) continue;
            weeks.push(w);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 单个时间段，如 "4-11周 五[5-6] 2号教学楼409(165)"、"5-16周(单) 五[3-4] 2号教学楼407(90)"
function parseTimeBlock(block) {
    const m = block.match(
        /^([\d,，\s\-—~－]+)\s*周\s*(?:[（(]\s*(单|双)\s*[)）])?\s*([一二三四五六日天])\s*\[\s*(\d{1,2})(?:\s*[-—~－]\s*(\d{1,2}))?\s*\]\s*(.*)$/
    );
    if (!m) return null;
    const day = DAY_MAP[m[3]];
    if (!day) return null;
    const startSection = parseInt(m[4], 10);
    const endSection = m[5] ? parseInt(m[5], 10) : startSection;
    if (!(startSection >= 1 && endSection >= startSection)) return null;
    const weeks = parseWeekSpec(m[1], m[2]);
    if (weeks.length === 0) return null;
    // 去掉地点末尾的教室容量，如 "2号教学楼409(165)" → "2号教学楼409"
    const position = String(m[6] || '').trim().replace(/[（(]\s*\d+\s*[)）]\s*$/, '').trim();
    return { day, startSection, endSection, weeks, position };
}

// 去掉教务各列里的方括号编码：[230002]职业发展与就业指导 → 职业发展与就业指导
function stripCode(text) {
    return String(text || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
}

function parseCourses(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');
    const courses = [];
    let skippedNoTime = 0;

    for (const row of rows) {
        const cells = visibleCells(row);
        if (cells.length < 11) continue;

        // 列序（实测）：0 上课班级代码 / 2 课程 / 5 修读性质 / 6 任课教师 / 10 上课时间地点
        const name = stripCode(cells[2] && cells[2].textContent);
        if (!name) continue;
        const teacher = cleanTeacher(cells[6] && cells[6].textContent);
        const timeText = String((cells[10] && cells[10].textContent) || '').trim();
        if (!timeText) { skippedNoTime++; continue; }

        // 一门课可能有多个上课时段，教务用全角分号分隔。
        // 只按分号切，别按逗号：周次列表本身可能含逗号（如 1-4,6-8周）
        for (const block of timeText.split(/[；;]/)) {
            const parsed = parseTimeBlock(block.replace(/\s+/g, ' ').trim());
            if (!parsed) continue;
            courses.push({
                name: name,
                teacher: teacher,
                position: parsed.position,
                day: parsed.day,
                startSection: parsed.startSection,
                endSection: parsed.endSection,
                weeks: parsed.weeks
            });
        }
    }
    return { courses: mergeAndDistinctCourses(courses), skippedNoTime: skippedNoTime };
}

// 两阶段合并去重：
// 阶段 1 合并同课程同周次的连续节次、去除完全重复记录；
// 阶段 2 合并同课程同节次的周次（如 5-8 周 + 9-16 周 → 5-16 周）
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...new Set(c.weeks)].sort((a, b) => a - b) : []
    }));

    const byKey = (a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0);

    list.sort((a, b) =>
        byKey(a, b) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0));

    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameGroup =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;
        if (sameGroup && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameGroup && isDuplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    step1.sort((a, b) =>
        byKey(a, b) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0));

    const step2 = [];
    let cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameGroup =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;
        if (sameGroup) {
            cur.weeks = [...new Set([...cur.weeks, ...nxt.weeks])].sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);
    return step2;
}

// ---------- 开学日期 ----------

// 第 1 周课表表头形如 <td class="kb-content" ...>一<br>08-31</td>
async function fetchSemesterStartDate(xn, xq) {
    try {
        const html = await fetchHtml(
            LESSON_INFO_URL + '?xn=' + xn + '&xq=' + xq + '&jxz=1',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include'
            }
        );
        const match = html.match(/>\s*一\s*<br\s*\/?>\s*(\d{2})-(\d{2})</);
        if (match) {
            // 第一学期开学在 xn 年，第二学期在 xn+1 年
            const year = xq === '1' ? String(parseInt(xn, 10) + 1) : xn;
            return year + '-' + match[1] + '-' + match[2];
        }
    } catch (e) { /* 返回 null 由用户手动填写 */ }
    return null;
}

// ---------- 校历总周数 ----------

// 校历表按月份分段，每行形如 ["12","16","17",...]，首列是该周的周次。
// 取最大周次即为学期总周数（本校 2026-2027 第一学期为 25 周）。
async function fetchTotalWeeks(xn, xq) {
    try {
        const html = await fetchHtml(SCHOOL_CALENDAR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'menucode=&xn=' + xn + '&xq_m=' + xq + '&rad=1&is_ssxq=0&ssxq=&axq=',
            credentials: 'include'
        });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let maxWeek = 0;
        // 只看带「周次」表头的月历表，避免把外层容器行算进去
        for (const table of doc.querySelectorAll('table')) {
            const cells = Array.from(table.querySelectorAll('td'));
            if (!cells.some(td => td.textContent.replace(/\s/g, '') === '周次')) continue;
            for (const tr of table.querySelectorAll('tr')) {
                if (tr.children.length < 8) continue;
                const first = String((tr.children[0] && tr.children[0].textContent) || '').replace(/\s/g, '');
                if (!/^\d{1,2}$/.test(first)) continue;
                const w = parseInt(first, 10);
                if (w >= 1 && w <= 60 && w > maxWeek) maxWeek = w;
            }
        }
        return maxWeek > 0 ? maxWeek : null;
    } catch (e) { return null; }
}

// ---------- 作息时间 ----------

function parseTimeSlotsHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const slots = [];
    const rows = doc.querySelectorAll('tr');
    for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td,th')).map(c => c.textContent.replace(/\s+/g, ' ').trim());
        // 行形如 ["上午","1","08:30","09:15",""] 或 ["1","08:30","09:15",""]
        let number = NaN;
        let start = '';
        let end = '';
        for (const c of cells) {
            if (isNaN(number) && /^\d{1,2}$/.test(c)) number = parseInt(c, 10);
            else if (/^\d{2}:\d{2}$/.test(c)) {
                if (!start) start = c;
                else if (!end) { end = c; break; }
            }
        }
        if (number >= 1 && number <= 30 && start && end) {
            slots.push({ number: number, startTime: start, endTime: end });
        }
    }
    const map = new Map();
    slots.forEach(s => { if (!map.has(s.number)) map.set(s.number, s); });
    return Array.from(map.values()).sort((a, b) => a.number - b.number);
}

async function fetchTimeSlotsForTerm(xn, xq) {
    const body = 'menucode=&xn=' + xn + '&xq_m=' + xq + '&rad=1&is_ssxq=0&ssxq=&axq=';
    const html = await fetchHtml(TIMETABLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body,
        credentials: 'include'
    });
    if (!html || html.includes('未设置') || html.includes('未发布')) return null;
    const slots = parseTimeSlotsHtml(html);
    return slots.length > 0 ? slots : null;
}

// 本校按学期公布作息：所选学期可能尚未发布，往前找最近一次公布的数据
async function fetchTimeSlots(xn, xq) {
    let curXn = parseInt(xn, 10);
    let curXq = xq === '1' ? '1' : '0';
    for (let i = 0; i < 6; i++) {
        try {
            const slots = await fetchTimeSlotsForTerm(curXn, curXq);
            if (slots) {
                return {
                    slots: slots,
                    fromTerm: { xn: String(curXn), xq: curXq },
                    isExact: String(curXn) === String(xn) && curXq === xq
                };
            }
        } catch (e) { /* 继续往前找 */ }
        if (curXq === '0') { curXn -= 1; curXq = '1'; } else { curXq = '0'; }
    }
    return null;
}

// ---------- 登录入口 ----------

// 教务系统直连入口与智慧校园门户入口。两者最终都落在同一个教务站点，
// 取数逻辑完全一致，差别只在用户怎么拿到登录态。
const ENTRY_JWXT = 0;
const ENTRY_PORTAL = 1;

function isJwxtHost() {
    return /^jwxt\./i.test(window.location.hostname);
}

function isPortalHost() {
    return /^portal\./i.test(window.location.hostname);
}

function isLoginPage() {
    return /\/cas\/login/i.test(window.location.pathname) || /login\.action|login\.jsp/i.test(window.location.href);
}

// 询问用户从哪个入口登录，返回 null 表示取消
async function selectLoginEntry() {
    const items = JSON.stringify([
        '教务系统直连（jwxt.zzucvc.edu.cn）',
        '智慧校园门户（portal.zzucvc.edu.cn）'
    ]);
    // 根据当前所在站点给出默认选项：已在教务系统页面上时默认直连
    const defaultIndex = isJwxtHost() ? ENTRY_JWXT : ENTRY_PORTAL;
    const index = await window.shiguangBridgePromise.showSingleSelection(
        '选择登录入口',
        items,
        defaultIndex
    );
    if (index === null || index < 0 || index > 1) return null;
    return index;
}

// 智慧校园入口：门户页面上无法直接读取教务数据（跨域），需先跳转进教务系统
async function guideFromPortal() {
    await window.shiguangBridgePromise.showAlert(
        '请先进入教务系统',
        '你当前位于智慧校园门户页面，课程数据保存在教务系统中，门户页面无法直接读取。\n\n'
        + '请按以下步骤操作：\n'
        + '1. 在门户「应用中心」或首页应用列表中找到「教务管理系统」并打开；\n'
        + '2. 确认页面已跳转至教务系统（地址栏为 jwxt.zzucvc.edu.cn）；\n'
        + '3. 返回课表 App，再次执行本次导入。\n\n'
        + '经门户进入教务系统后，无需再次输入账号密码。',
        '我知道了'
    );
}

// ---------- 导入流程 ----------

async function runImportFlow() {
    // 脚本依赖教务站点会话，只能在教务域名下取数
    if (!window.location.hostname.endsWith('zzucvc.edu.cn')) {
        await window.shiguangBridgePromise.showAlert(
            '无法导入',
            '当前页面不属于本校系统。请先登录教务系统或智慧校园门户，再执行导入。',
            '我知道了'
        );
        return;
    }

    const entry = await selectLoginEntry();
    if (entry === null) {
        window.shiguangBridge.showToast('已取消导入。');
        return;
    }

    if (entry === ENTRY_PORTAL) {
        // 从门户进入的用户：若已在教务系统页面（门户单点跳转过来），可直接继续；
        // 否则给出跳转指引，本次不导入。
        if (!isJwxtHost()) {
            window.shiguangBridge.showToast('请先从门户进入教务管理系统。');
            await guideFromPortal();
            return;
        }
    } else if (!isJwxtHost()) {
        await window.shiguangBridgePromise.showAlert(
            '请先登录教务系统',
            '你选择了教务系统直连入口，但当前页面不是教务系统。\n\n'
            + '请打开 jwxt.zzucvc.edu.cn 并完成登录后，再执行导入。',
            '我知道了'
        );
        return;
    }

    if (isLoginPage()) {
        window.shiguangBridge.showToast('请先登录教务系统，再执行导入。');
        return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        '导入课表',
        '即将从教务系统获取课表、作息与开学日期。请确保当前页面已登录教务系统。',
        '开始导入'
    );
    if (!confirmed) {
        window.shiguangBridge.showToast('已取消导入。');
        return;
    }

    // 1. 选择学期（列表来自网络请求，默认选中当前学期）
    const semester = await selectSemester();
    if (!semester) {
        window.shiguangBridge.showToast('已取消导入。');
        return;
    }
    const { xn, xq } = semester;

    // 2. 课表数据
    window.shiguangBridge.showToast('正在获取课表数据...');
    let html = null;
    try {
        html = await fetchCourseHtml(xn, xq);
    } catch (e) {
        html = null;
    }
    if (!html) {
        await window.shiguangBridgePromise.showAlert(
            '获取失败',
            '未能获取课表数据，可能尚未登录或会话已过期，请确认登录后重试。',
            '确定'
        );
        return;
    }
    const parsed = parseCourses(html);
    const courses = parsed.courses;
    if (courses.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            '没有课程',
            '已连接教务系统，但该学期没有解析到课程记录。',
            '确定'
        );
        return;
    }

    // 3. 开学日期（教务第 1 周课表）并让用户确认
    window.shiguangBridge.showToast('正在获取开学日期...');
    const startDate = await fetchSemesterStartDate(xn, xq);
    const confirmedDate = await window.shiguangBridgePromise.showPrompt(
        '确认开学日期',
        '请确认本学期第一周周一的日期（格式 YYYY-MM-DD）：',
        startDate || '',
        'validateDateInput'
    );
    if (confirmedDate === null) {
        window.shiguangBridge.showToast('导入已取消。');
        return;
    }

    // 4. 总周数：优先取校历，拿不到时才回退到课程周次最大值
    //    （本校课程只排到第 18 周，校历却有 25 周，按课程推算会把学期截短）
    window.shiguangBridge.showToast('正在获取学期周数...');
    let totalWeeks = (await fetchTotalWeeks(xn, xq)) || 0;
    if (totalWeeks === 0) {
        for (const c of courses) {
            for (const w of c.weeks) if (w > totalWeeks) totalWeeks = w;
        }
    }
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: String(confirmedDate).trim(),
            semesterTotalWeeks: totalWeeks > 0 ? totalWeeks : 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));
    } catch (e) {
        window.shiguangBridge.showToast('课表配置保存失败：' + e.message);
    }

    // 5. 作息时间（教务公布优先，往前找最近一次发布，全部未发布才用内置）
    let timeNote = '';
    try {
        const found = await fetchTimeSlots(xn, xq);
        if (found) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(found.slots));
            if (!found.isExact) {
                timeNote = '（作息取自 ' + found.fromTerm.xn + '-' + (parseInt(found.fromTerm.xn, 10) + 1) +
                    ' 学年' + (found.fromTerm.xq === '0' ? '第一学期' : '第二学期') + '，本学期尚未公布，请核对）';
            }
        } else {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(FALLBACK_TIME_SLOTS));
            timeNote = '（教务未公布作息，已用备用作息，请核对）';
        }
    } catch (e) {
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(FALLBACK_TIME_SLOTS));
        } catch (e2) { /* 作息失败不阻断课程导入 */ }
        timeNote = '（获取作息失败，已用备用作息，请核对）';
    }

    // 6. 提交课程
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
        await window.shiguangBridgePromise.showAlert('导入失败', '课程数据保存失败：' + e.message, '确定');
        return;
    }

    await window.shiguangBridgePromise.showAlert(
        '导入成功',
        '已导入 ' + courses.length + ' 条课程记录，开学日期 ' + String(confirmedDate).trim() + '。' +
        (timeNote ? '\n作息' + timeNote : '') +
        (parsed.skippedNoTime > 0 ? '\n另有 ' + parsed.skippedNoTime + ' 门课教务未排时间，已跳过。' : ''),
        '确定'
    );
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
