/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 重庆城市科技学院(CQCST, jw.cqcst.edu.cn) 拾光课程表适配脚本 —— 标准版
// 教务平台：强智科技（老版 jsxsd，课表页 /xskb/xskb_list.do，标题「学期理论课表」）
// 非该校在校开发者适配，出现问题请提交 issue 或 PR。
//
// 本版本只用上游标准接口（showAlert / showSingleSelection / saveCourseConfig /
// savePresetTimeSlots / saveImportedCourses），不含任何私有扩展，可直接回流上游。
// 「按教学楼自动分流作息」不在脚本里做：脚本只问清用户在哪个校区、下发该校区的
// 兜底作息，分流由宿主 App 读取专属数据文件（qingyu_only/CQCST/）按教室名完成。
//
// 数据获取方式：登录后**任意页面**点运行即可——脚本直接请求课表页
// /xskb/xskb_list.do（带会话 Cookie，拿到的就是浏览器里看到的那份默认学期课表），
// 字段靠源码里的标签（font[title=老师/教师、教室、周次(节次)]）提取，不依赖页面
// 排版。请求失败或页面异常时，退回解析当前已渲染出来的课表。
//
// ⚠️ 改字段提取方式前先读完这两条历史教训，都是实测踩出来的：
//
// 1) 旧版按「渲染后 innerText 按行取字段」解析，必须停留在课表页才能跑。离屏 DOM
//    没有排版、innerText 不换行，按行解析会整体失效（实测 0 条课程）。这正是本版
//    改成「fetch + 标签取值」的原因——别再退回去。
//
// 2) 强智该系统的教师字段是 <font title="老师">，不是别的学校常见的
//    <font title="教师">。标签提取两种都查，别只写一个。
//
// 3) 「周次(节次)」这个 title 不是每个学校都挂着，挂不上时会退回整块文本——
//    那条路上正则必须两头卡死，否则学时/教室号会被当周次，17 门课只进 1 门。
//    详见下面「课表提取」处的四条教训。

async function runImportFlow() {
    // 兼容电脑端测试
    if (typeof window.shiguangBridgePromise === 'undefined') {
        window.shiguangBridgePromise = {
            showAlert: async () => true,
            showSingleSelection: async (title, itemsJson, selectedIndex) => selectedIndex ?? 0,
            saveImportedCourses: async (json) => {
                console.log("===============================");
                console.log("🎉 【解析成功】以下是整理好的课表数据：");
                console.table(JSON.parse(json)); 
                console.log("===============================");
                alert("抓取成功！请在 F12 控制台查看具体的课程数据格式。");
                return true;
            },
            savePresetTimeSlots: async (json) => {
                console.log("⏰ 【作息时间】共 " + JSON.parse(json).length + " 节：");
                console.table(JSON.parse(json));
                return true;
            },
            saveCourseConfig: async (json) => {
                console.log("📅 【学期配置】" + json);
            }
        };
        window.shiguangBridge = {
            showToast: (msg) => console.log("[系统提示] " + msg),
            notifyTaskCompletion: () => console.log("[流程结束] 任务已完成并通知APP")
        };
    }

    window.shiguangBridge.showToast("准备提取课表数据...");

    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "强智教务解析",
        "将自动获取课表数据并导入，是否继续？（请确认已登录教务系统）",
        "确认导入"
    );
    if (!alertConfirmed) return;

    try {
        window.shiguangBridge.showToast("正在从教务系统获取课表...");

        const fetched = await schoolGetTimetable();
        if (!fetched.table) {
            window.shiguangBridge.showToast("没拿到课表！请先登录教务系统，登录后在任意页面再点一次运行。");
            return;
        }

        // 拿不到学期清单时（退回「解析当前已渲染页面」的老路径）就不问学期，
        // 直接用手上这份课表；空串表示「就用它」，与用户取消（null）区分开。
        const termId = fetched.terms.length ? await schoolPickTerm(fetched) : "";
        if (termId === null) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }
        const isCurrentTerm = !termId || termId === fetched.currentTermId;

        const table = await schoolGetTimetableForTerm(termId, fetched);
        if (!table) {
            window.shiguangBridge.showToast(`没拿到 ${termId} 学期的课表，可能该学期没有选课记录。`);
            return;
        }

        let courses = [];
        let courseSet = new Set();
        const unparsed = schoolExtractCourses(table, courses, courseSet);

        if (courses.length === 0) {
            window.shiguangBridge.showToast(`没有抓取到数据，${termId || '当前'} 学期的课表可能是空的。`);
            return;
        }

        // 认不出周次的块要当面说，不能悄悄少几门课让用户以为课表本来就空。
        const unparsedNote = unparsed > 0 ? `（另有 ${unparsed} 个课程块没认出周次，已跳过）` : "";
        const termNote = isCurrentTerm ? "" : `（${termId} 学期）`;
        window.shiguangBridge.showToast(`提取成功，共发现 ${courses.length} 门课程${termNote}${unparsedNote}，正在保存...`);

        const timeSchemeLabel = await schoolApplyTimeScheme(isCurrentTerm);
        if (timeSchemeLabel === null) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        if (saveResult) {
            window.shiguangBridge.showToast(
                `导入大功告成！已套用「${timeSchemeLabel}」作息${isCurrentTerm ? "" : "（往期学期不改开学日期，需要的话在设置里调）"}`
            );
            window.shiguangBridge.notifyTaskCompletion();
        }

    } catch (error) {
        console.error("解析过程中发生错误:", error);
        window.shiguangBridge.showToast("解析出错啦: " + error.message);
    }
}

// ===== 课表获取：优先直接请求课表页，失败退回当前已渲染的课表 =====
// 课表页是 GET 直出的（浏览器里就是直接打开这个网址），所以不带参数请求即可，
// 内容与登录后手动进入课表页看到的完全一致。强智登录后固定落在「学生个人中心」，
// 旧版靠「跳到课表页再点一次运行」，本版直接请求后这一步不再需要。

const SCHOOL_TIMETABLE_URL = "http://jw.cqcst.edu.cn/cqdxcskjxy_jsxsd/xskb/xskb_list.do";
// 学期下拉里除了当前学期还列多少个。43 个全列出来在手机上没法选，只取最近的几个
// （约 4 年，够任何年级回看自己的课表）。
const SCHOOL_TERM_CHOICES = 8;

// 请求课表页。termId 为空 = 当前学期（GET 直出，与浏览器里直接打开这个网址一致）；
// 给了学期就是 POST xnxq01id——页面上那个「学期」下拉就是这么切提交的，参数名
// 也从页面上读，不写死。返回 { doc, table, terms, currentTermId }。
async function schoolFetchTimetable(termId) {
    const init = termId
        ? {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "xnxq01id=" + encodeURIComponent(termId),
            credentials: "include"
        }
        : { credentials: "include" };

    const resp = await fetch(SCHOOL_TIMETABLE_URL, init);
    if (!resp.ok) throw new Error("课表页返回 " + resp.status);
    const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
    const table = doc.getElementById('kbtable') || doc.querySelector('.table_border');
    const termSelect = doc.querySelector('select[name="xnxq01id"]');
    // 学期清单直接读页面上的下拉：学校自己的权威列表，新增学期不用改脚本。
    const terms = termSelect
        ? Array.from(termSelect.options)
            .map(o => (o.value || '').trim())
            .filter(Boolean)
        : [];
    const selected = termSelect ? (termSelect.value || '').trim() : '';
    return {
        doc: doc,
        table: table,
        terms: terms,
        currentTermId: selected || (terms.length ? terms[0] : '')
    };
}

// 让用户选学期，返回 termId；取消返回 null。当前学期排第一并标注，默认就是它——
// 绝大多数人只想导当前学期，不该为这个多花一次点击。
function schoolPickTerm(fetched) {
    const current = fetched.currentTermId;
    const others = fetched.terms.filter(t => t !== current).slice(0, SCHOOL_TERM_CHOICES - 1);
    if (!current && others.length === 0) return Promise.resolve("");

    const labels = (current ? [current + "（当前学期）"] : []).concat(others);
    return window.shiguangBridgePromise.showSingleSelection(
        "导入哪个学期的课表？",
        JSON.stringify(labels),
        0
    ).then(picked => {
        const index = schoolResolvePickIndex(picked, labels);
        if (index === null) return null;
        return current && index === 0 ? current : others[index - (current ? 1 : 0)];
    });
}

// 单选弹窗返回值的归一。
//
// 正常是**序号**（宿主手动弹窗与后台自动回答都回序号）。但宿主在「录制导入」回放
// 宏时回的是**选项文字**——录制侧把用户选的那一项按文字存进宏（见宿主
// `_showScriptSingleSelectionDialog` 的记录分支），回放时原样喂回来。文字喂给
// 期望序号的脚本，`Number(文字)` 是 NaN，于是每次录制导入都判成「取消」，用户在
// 屏幕上只看到刚点确认就变成「导入已取消」（2026-09-29 真机实测）。
//
// 所以两种都认：像数字就当序号，不像数字就按文字在选项里找。都对不上才算取消。
function schoolResolvePickIndex(picked, labels) {
    if (typeof picked === 'string' && picked.trim() !== '' && isNaN(Number(picked))) {
        const byLabel = labels.findIndex(label => label === picked.trim());
        return byLabel >= 0 ? byLabel : null;
    }
    return schoolNormalizePick(picked, labels.length);
}

// 取当前学期的课表页，顺带读出页面上的学期清单。请求失败时退回解析当前已渲染的
// 课表（那时拿不到学期信息，currentTermId 为空串）。
async function schoolGetTimetable() {
    try {
        const fetched = await schoolFetchTimetable(null);
        if (fetched.table) return fetched;
    } catch (error) {
        console.warn("直接请求课表页失败，退回解析当前页面:", error);
    }
    return { table: schoolFindRenderedTimetable(), terms: [], currentTermId: "" };
}

// 按用户选的学期再要一次课表；选的就是当前学期时直接复用第一次的结果，不多发请求。
async function schoolGetTimetableForTerm(termId, fetched) {
    if (!termId || termId === fetched.currentTermId) return fetched.table;
    try {
        const other = await schoolFetchTimetable(termId);
        if (other.table) return other.table;
    } catch (error) {
        console.warn("请求 " + termId + " 学期课表失败:", error);
    }
    return null;
}

function schoolFindRenderedTimetable() {
    const table = document.getElementById('kbtable')
        || document.querySelector('.table_border')
        || document.querySelector('table');
    return (table && table.innerText.includes('星期')) ? table : null;
}

// ===== 课表提取（按 DOM 结构取值，不依赖页面排版）=====
// 课程块里教师 / 教室 / 周次(节次) 都带 title 关键字（各校写法不一，按关键字找，
// 不写死整串），课程名取块内第一个非空文本节点。取值顺序从「最确定的字段」
// 退到「整块文本」，每层都必须自己独立成立。
//
// ⚠️ 改这块之前先读完下面四条，全是真机踩出来的：
//
// 1) 离屏 DOM 没有排版、innerText 不换行，**不能**把整块文本丢给宽松正则按行取
//    字段（旧版那么写，离屏实测 0 条课程）。现在只按 DOM 结构和 title 标签取值。
//
// 2) 整块文本只配当最后兜底，而且正则两头都得卡死：周次串「前面不能是数字」
//    （非数字或串首），否则教室「一教A205」紧接周次「1-16周」会在 textContent
//    里粘成「A2051-16周」；「后面必须紧跟周字/括号/串尾」，否则课程名里的学时
//    「[32]」会被当成周次——通配一路搭到 [1-2节]，周次变成 32。
//
// 3) 粘上前一个字段的数字时，丢的是起始周不是整段：按「起 ≤ 止 ≤ 30」从粘住的
//    那串数字末尾借 1~2 位补回来（「A2051-16周」借出「1-16周」）。
//
// 4) 周次推给 App 之前必须自查 1..30。App 侧学期上限 30 周
//    (ImportExportLogic.maxAllowedSemesterWeekCount)，越界周次会被 App 整条丢弃
//    ——脚本侧看着「17 门都推了」，用户那边却是「只进了 1 门」（2026-09-29 真机
//    实测）。宁可这里跳过并提示，也不要推垃圾数据过去。

const SCHOOL_MAX_WEEK = 30;      // 与 App 侧学期周数上限保持一致
const SCHOOL_MAX_SECTION = 20;

// 节次：城科实测是 [01-02-03-04节]（连堂四节、两位补零），所以收的是「一串数字」
// 而不是「起-止」两个数：起 = 第一个，止 = 最后一个。另兜一层「第1-2节」——
// 必须带「第」字，否则会钻到方括号形态里面去、只截出中间那两个数。
const SCHOOL_SECTION_RE = /[\[［]\s*(\d{1,2}(?:\s*[-~～—–,，]\s*\d{1,2})*)\s*节\s*[\]］]/;
const SCHOOL_SECTION_LOOSE_RE = /第\s*(\d{1,2}(?:\s*[-~～—–]\s*\d{1,2})*)\s*节/;
// 周次串：前面不是数字（防粘上前一个字段），后面紧跟周字/括号/串尾（防学时被当周次）
const SCHOOL_WEEK_RE = /(\D|^)(\d{1,2}(?:\s*[-~～—–]\s*\d{1,2})*(?:\s*[,，、]\s*\d{1,2}(?:\s*[-~～—–]\s*\d{1,2})*)*)\s*(?=周|[（(]|$)/;
const SCHOOL_ODD_EVEN_RE = /[（(]\s*(单|双)\s*[)）]/;
// 表头「星期一…星期日」→ 1..7
const SCHOOL_DAY_HEADINGS = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7
};

// "1-16" / "1,3,5" / "1-8,11-16" → 周次数组；单双周在这里展开。
// 越界（不在 1..30）的那段直接不要——它只会让 App 整条丢掉这门课。
function schoolExpandWeeks(token, oddEven) {
    const weeks = [];
    for (const piece of String(token).split(/[,，、]/)) {
        const seg = piece.trim();
        if (!seg) continue;
        const parts = seg.split(/[-~～—–]/).map(v => parseInt(v, 10));
        if (parts.length >= 2) {
            const from = parts[0];
            const to = parts[parts.length - 1];
            if (isNaN(from) || isNaN(to) || from < 1 || to < from || to > SCHOOL_MAX_WEEK) continue;
            for (let w = from; w <= to; w++) {
                if (oddEven === '单' && w % 2 === 0) continue;
                if (oddEven === '双' && w % 2 !== 0) continue;
                weeks.push(w);
            }
        } else {
            if (isNaN(parts[0]) || parts[0] < 1 || parts[0] > SCHOOL_MAX_WEEK) continue;
            weeks.push(parts[0]);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 从「周次(节次)」文本里解析出 { weeks, startSection, endSection }，认不出返回 null。
function schoolParseWeekSection(segment) {
    // 城科实测这一段长这样：「(33)11-12(全部)[01-02-03-04节]」——开头括号里是
    // 「选课人数」，不摘掉的话「33」和「11-12」会粘成「3311-12」。
    const text = String(segment || '').replace(/\s+/g, ' ').replace(/^\(\s*\d+\s*\)\s*/, '').trim();
    if (!text) return null;

    const section = text.match(SCHOOL_SECTION_RE);
    const loose = section ? null : text.match(SCHOOL_SECTION_LOOSE_RE);
    if (!section && !loose) return null;
    const hit = section || loose;
    const sections = hit[1].split(/[-~～—–,，]/).map(v => parseInt(v, 10)).filter(v => !isNaN(v));
    if (!sections.length) return null;
    const startSection = sections[0];
    const endSection = sections[sections.length - 1];
    if (!(startSection >= 1 && startSection <= SCHOOL_MAX_SECTION)) return null;
    if (!(endSection >= startSection && endSection <= SCHOOL_MAX_SECTION)) return null;

    // 方括号形态（强智模板）里周次写在节次前面；不带方括号的「第1-2节」两段
    // 前后都可能，把节次本身剔掉，剩下的都是周次信息。
    const head = section ? text.slice(0, section.index) : text.replace(hit[0], ' ');
    const oddEven = (head.match(SCHOOL_ODD_EVEN_RE) || [null, ''])[1] || '';
    const weeks = schoolWeeksFromHead(head, oddEven);
    if (!weeks.length) return null;
    return { weeks, startSection, endSection };
}

// 从周次行（节次方括号之前的那段文本）里取周次串。
function schoolWeeksFromHead(head, oddEven) {
    const compact = head.replace(/\s+/g, '');
    const candidates = [];

    // 整段就是纯周次记法时最省事：「1-8周(单),11-16周(单)」剥掉周字与括号组后
    // 剩「1-8,11-16」，两段都在。必须「剥完只剩数字和分隔符」才走这条——课程名里
    // 的学时「[32]」和教室号都带别的字符，会被这个条件挡在外面。
    const clean = compact.replace(/[（(][^)）]*[)）]/g, '').replace(/(?:星期|周)/g, '');
    if (/^[\d,，、\-~～—–]+$/.test(clean)) candidates.push(clean);

    const matched = SCHOOL_WEEK_RE.exec(compact);
    if (matched) {
        const token = matched[2];
        const before = compact.slice(0, matched.index + matched[1].length);
        const glued = /(\d+)([-~～—–])$/.exec(before);
        if (glued) {
            // 「…A2051-16周」：起始周粘在教室号的数字尾巴上，借 1~2 位试试。
            // 借不出合理的就只认这个 token（起 > 止 的那种展开时会被丢掉）。
            for (const take of [2, 1]) {
                if (glued[1].length < take) continue;
                candidates.push(glued[1].slice(-take) + glued[2] + token);
            }
        }
        candidates.push(token);
    }

    for (const candidate of candidates) {
        const weeks = schoolExpandWeeks(candidate, oddEven);
        if (weeks.length) return weeks;
    }
    // 认不出就返回空：宁可让上层报「有 N 块没认出周次」，也不推猜出来的周次。
    return [];
}

// 按 title 关键字找字段文本。各校 title 写法不一（老师/教师/任课教师…），
// 写死整串总会漏，所以按关键字匹配；同关键字取第一个有内容的。
function schoolFindLabeledText(root, keywords) {
    for (const el of Array.from(root.querySelectorAll('[title]'))) {
        const title = el.getAttribute('title') || '';
        if (!keywords.some(k => title.indexOf(k) >= 0)) continue;
        const text = (el.textContent || '').trim();
        if (text) return text;
    }
    return '';
}

// 课程名后缀里的「[必修]」「[选修]」→ 'required' / 'elective'，认不出给空串。
// 必须在剥后缀之前问它，否则性质跟着方括号一起被扔掉，App 侧对空值一律按必修
// 处理（CourseNatureX.fromValue 的 orElse），选修课会被错标成必修。
function schoolParseCourseNature(name) {
    const hit = String(name || '').match(/[[［【(（]\s*(必修|选修)\s*[\]］】)）]/);
    if (!hit) return '';
    return hit[1] === '必修' ? 'required' : 'elective';
}

// 找承载「周次(节次)」的那段文本：先看 title 标签；标签没有就在块里找
// 「含节次方括号、且文本最短」的元素。按元素取值才不会串味——整块拼起来
// 相邻字段之间是没有分隔符的。
// 城科实测：课程块（div.kbcontent）里**没有**周次标签，周次和节次都藏在
// <span title="选课人数"> 里，写作「(33)11-12(全部)[01-02-03-04节]」；带
// 周次标签的那个 div 是另一层（div.kbcontent1，可见层），只够看周次、不含节次。
function schoolFindWeekSegment(root) {
    const labelled = schoolFindLabeledText(root, ['周次', '节次']);
    if (labelled) return labelled;

    const candidates = [];
    for (const el of Array.from(root.querySelectorAll('font, span, div, p, td, li'))) {
        const text = el.textContent || '';
        if (SCHOOL_SECTION_RE.test(text)) candidates.push(text);
    }
    if (candidates.length) {
        candidates.sort((a, b) => a.length - b.length);
        return candidates[0];
    }
    return root.textContent || '';
}

// 找表头那一行的「星期一…星期日」，把列号对成星期几。表头左侧是「节次/星期」
// 这类标题，所以按 7 个星期齐全来认。认不到返回 null，调用方退回倒推。
function schoolBuildDayHeader(table) {
    const rows = table.querySelectorAll('tr');
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const cells = rows[i].querySelectorAll('td, th');
        if (cells.length < 8) continue;
        const days = {};
        for (let j = 0; j < cells.length; j++) {
            const label = (cells[j].textContent || '').replace(/[\s星期周]/g, '');
            const day = SCHOOL_DAY_HEADINGS[label];
            if (day) days[j] = day;
        }
        if (Object.keys(days).length >= 7) return { count: cells.length, days: days };
    }
    return null;
}

// 返回「没认出周次节次、被跳过的块数」——调用方要把它告诉用户，不能悄悄少课。
function schoolExtractCourses(table, courses, courseSet) {
    const dayHeader = schoolBuildDayHeader(table);
    let unparsed = 0;
    let sample = '';

    const rows = table.querySelectorAll('tr');
    for (let i = 0; i < rows.length; i++) {
        // 【关键修复1】同时获取 th 和 td，防止错位
        let cells = rows[i].querySelectorAll('td, th');

        // 课表底部还有一行「备注:」，内容是「课程名 老师 周次;」的汇总文本，不是课程。
        // 它比表头窄（真实页面里只有 2 列），倒推公式会把它安到周天上——有表头可
        // 按时，列数比表头少的行一律不是「星期行」。
        if (dayHeader && cells.length < dayHeader.count) continue;

        for (let j = 0; j < cells.length; j++) {
            let cell = cells[j];

            // 【关键修复2】星期几：表头这一行对得上就按表头定位（多一列「备注」时
            // 倒推会整体错一天，而错一天是看不出来的错）；对不上才用「倒数第 7 列
            // 是周一」的倒推——强智左侧的节次列会把它顶偏，倒推能兼容。
            let day = 7 - (cells.length - 1 - j);
            if (dayHeader && cells.length === dayHeader.count) day = dayHeader.days[j] || 0;
            if (day < 1 || day > 7) continue; // 左侧的节次列不是星期几，跳过

            // 表头那行的「星期一…星期日」不是课程块；底部「备注:」那一格也不是。
            // 两者都是 8 列，倒推出的星期几照样在 1..7 里，不挡掉会被当课程解析一次。
            const cellLabel = (cell.textContent || '').replace(/\s/g, '');
            if (/^(?:星期)?[一二三四五六日天]$/.test(cellLabel) || cellLabel.indexOf('备注') === 0) continue;

            // 每格里的课程块放在 div.kbcontent 中；个别模板没有这个类名时整格兜底
            const containers = cell.querySelectorAll('div.kbcontent');
            const blocksIn = containers.length ? Array.from(containers) : [cell];

            for (const container of blocksIn) {
                const parts = container.innerHTML.split(/-{5,}/);
                for (const part of parts) {
                    if (!part || !part.trim()) continue;

                    // 离屏 DOM 没有排版，innerText 不可用：把块塞进临时节点按结构取值
                    const temp = document.createElement('div');
                    temp.innerHTML = part;

                    let name = '';
                    for (const node of temp.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== '') {
                            name = node.textContent.trim();
                            break;
                        }
                    }
                    if (!name) {
                        const stripped = temp.cloneNode(true);
                        stripped.querySelectorAll('font').forEach(f => f.remove());
                        name = (stripped.textContent || '').trim().split(/\s*\n\s*/)[0].split(/\s+/).filter(Boolean)[0] || '';
                    }
                    // 强智课程名自带「[32][必修]」这类后缀：[数字] 是**总学时**（对照
                    // 培养方案：学分 × 16 ≈ 总学时，2 学分 → 32、6 学分 → 96），
                    // 不是学分；[必修]/[选修] 是课程性质。
                    // 学时那个数字必须剥：不剥的话它会被当成周次，而它远大于 App 的
                    // 30 周上限，整门课连同 16/17 门一起消失（2026-09-29 真机实测）。
                    // 性质则先取出来喂给 App，别跟着方括号一起扔。
                    const courseNature = schoolParseCourseNature(name);
                    name = name.replace(/\[.*?\]/g, '').trim();
                    if (!name) continue;

                    let teacher = schoolFindLabeledText(temp, ['老师', '教师', '任课'])
                        .replace(/^任课教师[:：]?/, '').trim() || "未知";
                    let position = schoolFindLabeledText(temp, ['教室', '地点', '场地']) || "未知地点";

                    const weekSection = schoolParseWeekSection(schoolFindWeekSegment(temp));
                    if (!weekSection) {
                        unparsed++;
                        if (!sample) {
                            sample = (temp.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                        }
                        continue;
                    }
                    const weeks = weekSection.weeks;
                    const startSection = weekSection.startSection;
                    const endSection = weekSection.endSection;

                    let uid = `${name}-${day}-${startSection}-${endSection}-${weeks.join(',')}`;
                    if (!courseSet.has(uid)) {
                        courseSet.add(uid);
                        courses.push({
                            name: name,
                            teacher: teacher,
                            position: position,
                            day: day,
                            startSection: startSection,
                            endSection: endSection,
                            weeks: weeks,
                            // 'required' / 'elective'，认不出给空串（等价于必修）
                            courseNature: courseNature
                        });
                    }
                }
            }
        }
    }

    if (unparsed > 0) {
        console.warn(`qingyu-cqcst: ${unparsed} 个课程块没认出周次节次，例：${sample}`);
    }
    return unparsed;
}

// ===== 作息时间表（学校公布：永川校区 / 巴南校区 教学作息时间表）=====
// 第 1、2、5~13 节两校区完全一致，只有第 3、4 节按校区与教学楼类型分档，
// 四套之间最多差 15 分钟。
const SCHOOL_COMMON_TIME_SLOTS = [
    ["08:20", "09:05"], // 第1节
    ["09:15", "10:00"], // 第2节
    null,               // 第3节（见 SCHOOL_TIME_SCHEMES）
    null,               // 第4节（见 SCHOOL_TIME_SCHEMES）
    ["14:00", "14:45"], // 第5节
    ["14:55", "15:40"], // 第6节
    ["16:00", "16:45"], // 第7节
    ["16:55", "17:40"], // 第8节
    ["18:50", "19:35"], // 第9节
    ["19:45", "20:30"], // 第10节
    ["20:45", "21:30"], // 第11节
    ["21:45", "22:30"], // 第12节
    ["22:45", "23:30"]  // 第13节
];

const SCHOOL_TIME_SCHEMES = [
    { label: "永川校区 · A主/主教学楼",      third: ["10:30", "11:15"], fourth: ["11:25", "12:10"] },
    { label: "永川校区 · 其他教学楼",        third: ["10:20", "11:05"], fourth: ["11:15", "12:00"] },
    { label: "巴南校区 · A1厚德楼/A2博学楼", third: ["10:25", "11:10"], fourth: ["11:20", "12:05"] },
    { label: "巴南校区 · 其他教学楼",        third: ["10:15", "11:00"], fourth: ["11:10", "11:55"] }
];
// 这张表不直接弹给用户选——楼级选项用户答不了。用户只答「你在哪个校区」，
// 每个校区按下标取它的兜底作息（「其他教学楼」那套）下发。
// ⚠️ schemeIndex 按上面的数组下标写死，重排 SCHOOL_TIME_SCHEMES 必须同步改这里；
// 各套的 third/fourth 数值必须与 qingyu_only/CQCST/time_schemes.json 逐节一致
//（tests/test_cqcst_script_data_consistency.py 会拦漂移）。
const SCHOOL_CAMPUS_CHOICES = [
    { label: "永川校区", schemeIndex: 1 },
    { label: "巴南校区", schemeIndex: 3 }
];

// App 按数组下标对应节次（忽略 number 字段），所以必须按下标顺序给出 13 节。
function schoolBuildTimeSlots(schemeIndex) {
    const scheme = SCHOOL_TIME_SCHEMES[schemeIndex] || SCHOOL_TIME_SCHEMES[0];
    return SCHOOL_COMMON_TIME_SLOTS.map((slot, i) => {
        const t = i === 2 ? scheme.third : (i === 3 ? scheme.fourth : slot);
        return { number: i + 1, startTime: t[0], endTime: t[1] };
    });
}

// 取消时宿主返回 null / -1 / 越界值，统一按取消处理。
function schoolNormalizePick(picked, length) {
    if (picked === null || picked === undefined) return null;
    const index = Number(picked);
    if (!Number.isInteger(index) || index < 0 || index >= length) return null;
    return index;
}

// 返回实际套用的作息名称（校区名）；返回 null 表示用户取消或保存失败。
async function schoolApplyTimeScheme(isCurrentTerm) {
    // 走 schoolResolvePickIndex：录制导入回放时宿主回的是选项文字而不是序号。
    const pick = schoolResolvePickIndex(
        await window.shiguangBridgePromise.showSingleSelection(
            "你在哪个校区？",
            JSON.stringify(SCHOOL_CAMPUS_CHOICES.map(c => c.label)),
            0
        ),
        SCHOOL_CAMPUS_CHOICES.map(c => c.label)
    );
    if (pick === null) return null;
    const schemeIndex = SCHOOL_CAMPUS_CHOICES[pick].schemeIndex;

    // 学期配置（⚠️ 每学期更新）：
    // 总周数——实测三个学期的课表最远周次分别是 20（2025-2026-2）、18（2026-2027-1）、
    //   17（2025-2026-1），学校一个学期 20 周，取 20。
    // 开学日期——2026-2027-1 学期第一周从 2026-09-07（周一）起。App 用它算当前
    //   周次，不预置的话首页周数对不上。历法校验在 App 侧（warehouseSemesterStartDate）。
    //   ⚠️ 只对当前学期下发：往期学期沿用 App 里现有的开学日期（App 侧 copyWith
    //   对缺省字段保持原值，不会被清空），硬塞一个别的学期的日期只会算错周次。
    const config = isCurrentTerm
        ? { semesterTotalWeeks: 20, semesterStartDate: "2026-09-07" }
        : { semesterTotalWeeks: 20 };
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

    const ok = await window.shiguangBridgePromise.savePresetTimeSlots(
        JSON.stringify(schoolBuildTimeSlots(schemeIndex))
    );
    if (!ok) {
        window.shiguangBridge.showToast("作息时间保存失败，课程时间可能不准，可稍后在设置里调整");
        return null;
    }
    return SCHOOL_CAMPUS_CHOICES[pick].label;
}

runImportFlow();
