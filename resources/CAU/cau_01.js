(async function () {
    "use strict";

    const RUN_KEY = "__qingyu_CAU_01_running__";
    // 单小节时间依据：[中国农业大学本科生院上课节次时间表](https://jwc.cau.edu.cn/art/2011/4/11/art_41137_763185.html)
    const VERIFIED_TIME_SLOTS = [
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
        { number: 11, startTime: "21:00", endTime: "21:50" },
        { number: 12, startTime: "21:50", endTime: "22:30" }
    ];
    const warnings = [];
    let coursesSaved = false;
    let ownsLock = false;
    const clean = value => String(value == null ? "" : value).replace(/\u00a0/g, " ").trim();
    const normalize = value => clean(value).replace(/[（【]/g, c => c === "（" ? "(" : "[")
        .replace(/[）】]/g, c => c === "）" ? ")" : "]")
        .replace(/[，、]/g, ",").replace(/[－—–~～至]/g, "-").replace(/：/g, ":");
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function fail(message) { throw new Error(message); }
    function warn(message) {
        if (!warnings.includes(message)) warnings.push(message);
        console.warn("[CAU_01] " + message);
    }
    function chineseNumber(value) {
        if (/^\d+$/.test(value)) return Number(value);
        const digits = { "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
        if (value === "十") return 10;
        if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)) {
            const parts = value.split("十");
            return (parts[0] ? digits[parts[0]] : 1) * 10 + (parts[1] ? digits[parts[1]] : 0);
        }
        return Object.prototype.hasOwnProperty.call(digits, value) ? digits[value] : null;
    }
    function parseDay(value) {
        const match = normalize(value).replace(/\s/g, "").match(/^(?:星期|周|礼拜)([一二三四五六日天1-7])$/);
        if (!match) return null;
        const days = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
        return days[match[1]] || Number(match[1]);
    }
    function parseNumberList(value, limit, sectionMode) {
        const result = new Set();
        const source = normalize(value).replace(/\s/g, "");
        if (!/^\d+(?:[-,]\d+)*$/.test(source)) fail("无法解析数字列表：" + value);
        for (const part of source.split(",")) {
            const numbers = part.split("-").map(Number);
            if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > limit)) fail("数字超出支持范围：" + value);
            if (numbers.some((n, i) => i > 0 && n <= numbers[i - 1])) fail("数字列表不是严格递增：" + value);
            if (numbers.length === 2) {
                for (let n = numbers[0]; n <= numbers[1]; n++) result.add(n);
            } else if (numbers.length === 1 || sectionMode) {
                numbers.forEach(n => result.add(n));
            } else {
                fail("周次范围格式不明确：" + value);
            }
        }
        return Array.from(result).sort((a, b) => a - b);
    }
    function parseSections(value) {
        const text = normalize(value);
        const expression = /[\[(]\s*(\d+(?:\s*[-,]\s*\d+)*)\s*(?:小)?节\s*[\])]/g;
        const sections = new Set();
        let match;
        while ((match = expression.exec(text))) {
            parseNumberList(match[1], 30, true).forEach(n => sections.add(n));
        }
        if (!sections.size) fail("缺少明确带“节”字的节次：" + clean(value));
        return Array.from(sections).sort((a, b) => a - b);
    }
    function parseWeeks(value) {
        let text = normalize(value).replace(/\[[^\]]*节[^\]]*\]/g, "").replace(/\s/g, "");
        if (!text.includes("周")) fail("缺少明确周次：" + value);
        text = text.replace(/周次[:]?/g, "").replace(/第(?=\d)/g, "");
        const expression = /(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\s*(?:\((周|单周|双周|单|双|全部)\)|周)(?:周)?(?:\((周|单周|双周|单|双|全部)\))?/g;
        const weeks = new Set();
        let match;
        let count = 0;
        const remainder = text.replace(expression, function (_, list, first, second) {
            count++;
            const markers = [first, second].filter(Boolean).join("");
            if (markers.includes("单") && markers.includes("双")) fail("单双周标记冲突：" + value);
            for (const week of parseNumberList(list, 30, false)) {
                if (markers.includes("单") && week % 2 !== 1) continue;
                if (markers.includes("双") && week % 2 !== 0) continue;
                weeks.add(week);
            }
            return "";
        });
        if (!count || /[^,;；]/.test(remainder) || !weeks.size) fail("无法完整解析周次：" + value);
        return Array.from(weeks).sort((a, b) => a - b);
    }
    function parseTime(value) {
        const match = normalize(value).match(/(?:^|[^\d:])(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?![\d:])/);
        if (!match) return null;
        const numbers = match.slice(1).map(Number);
        if (numbers[0] > 23 || numbers[2] > 23 || numbers[1] > 59 || numbers[3] > 59) fail("时间超出范围：" + value);
        const startMinutes = numbers[0] * 60 + numbers[1];
        const endMinutes = numbers[2] * 60 + numbers[3];
        if (endMinutes <= startMinutes) fail("结束时间必须晚于开始时间：" + value);
        return {
            startTime: String(numbers[0]).padStart(2, "0") + ":" + match[2],
            endTime: String(numbers[2]).padStart(2, "0") + ":" + match[4],
            startMinutes, endMinutes
        };
    }
    function calendarDate(value) {
        const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const [year, month, day] = match.slice(1).map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
    }
    function activeTab(doc) {
        return doc.querySelector(".layui-tab-title li.layui-this[data-sjcode]");
    }
    function isLoginPage(doc) {
        return !doc.querySelector("#timetable") && !!doc.querySelector('input[type="password"]');
    }
    function collectContexts() {
        let root = window;
        try { if (window.top.document) root = window.top; }
        catch (error) { console.warn("[CAU_01] 顶层页面跨域，改为检查当前页面。", error); }
        const contexts = [];
        const denied = [];
        const visited = new Set();
        function visit(win, visible, depth) {
            if (depth > 8 || visited.has(win)) return;
            visited.add(win);
            let doc;
            try { doc = win.document; }
            catch (error) { denied.push(String(error)); return; }
            contexts.push({ win, doc, visible });
            for (const frame of doc.querySelectorAll("iframe,frame")) {
                let shown = visible && !frame.hidden;
                try {
                    const style = win.getComputedStyle(frame);
                    shown = shown && style.display !== "none" && style.visibility !== "hidden";
                    if (frame.contentWindow) visit(frame.contentWindow, shown, depth + 1);
                } catch (error) {
                    denied.push((frame.getAttribute("src") || frame.id || "iframe") + "：" + error.message);
                }
            }
        }
        visit(root, true, 0);
        return { root, contexts, denied };
    }
    function snapshot(context) {
        const doc = context.doc;
        const form = doc.querySelector("#Form1");
        const table = doc.querySelector("#timetable");
        const semester = doc.querySelector("#xnxq01id");
        const week = doc.querySelector("#zc");
        const scheme = doc.querySelector("#kbjcmsid");
        if (!form || !table || !semester || !week) fail("课表缺少 Form1、timetable、学年学期或周次控件。");
        const term = clean(semester.value);
        if (!/^\d{4}-\d{4}-[123]$/.test(term)) fail("没有选中可识别的学年学期。");
        return { form, table, term, week: clean(week.value), scheme: scheme ? clean(scheme.value) : "", html: table.innerHTML };
    }
    async function waitForTimetable() {
        const deadline = Date.now() + 15000;
        let previous = "";
        let stableSince = 0;
        let lastDenied = [];
        while (Date.now() < deadline) {
            const scan = collectContexts();
            lastDenied = scan.denied;
            const tab = activeTab(scan.root.document);
            if (tab && tab.getAttribute("data-sjcode") !== "NEW_XSD_PYGL_WDKB_XQLLKB") fail("请先进入“个人课表（学期课表）”，不要在首页周课表或其他标签页导入。");
            const candidates = scan.contexts.filter(item => item.visible && item.doc.querySelector("#timetable") && item.doc.querySelector("#Form1"));
            if (candidates.length > 1) fail("同时发现多个可见课表，无法确定当前学期课表。");
            if (candidates.length === 1) {
                const context = candidates[0];
                const state = snapshot(context);
                const signature = state.term + "|" + state.week + "|" + state.scheme + "|" + state.html;
                const loading = context.doc.readyState === "loading" || !!context.doc.querySelector('#Form1 input[disabled][value="查询中"]');
                if (signature !== previous || loading) { previous = signature; stableSince = Date.now(); }
                if (!loading && Date.now() - stableSince >= 600) return { scan, context, state };
            } else if (scan.contexts.some(item => item.visible && isLoginPage(item.doc))) {
                fail("尚未登录或登录已失效，请重新登录后进入个人学期课表。");
            } else if (!tab && scan.root.document.readyState === "complete") {
                fail("当前不是个人学期课表页。请进入“个人课表（学期课表）”。");
            }
            await sleep(200);
        }
        fail("等待课表异步加载超时。" + (lastDenied.length ? "存在无法读取的 iframe：" + lastDenied.join("；") : "请确认页面已加载完成。"));
    }
    async function loadSemester(context, state) {
        if (context.win.location.protocol === "file:" || new URL(context.doc.baseURI).protocol === "file:") {
            if (state.week) fail("离线页面只包含单周数据，不能完整导入学期课表。请在在线教务页面运行。");
            warn("当前为保存的离线页面，使用页面内完整学期课表，未请求教务接口。");
            return context.doc;
        }
        const action = new URL(state.form.getAttribute("action"), context.doc.baseURI);
        if (action.origin !== context.win.location.origin || !/\/jsxsd\/xskb\/xskb_list\/?$/.test(action.pathname)) fail("课表查询表单地址与实际适配接口不一致，已停止导入。");
        const body = new URLSearchParams();
        for (const [key, value] of new FormData(state.form)) {
            if (typeof value === "string") body.append(key, value);
        }
        body.set("xnxq01id", state.term);
        body.set("zc", "");
        if (state.scheme) body.set("kbjcmsid", state.scheme);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response;
        let html;
        try {
            response = await context.win.fetch(action.href, {
                method: "POST", credentials: "include", cache: "no-store",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body: body.toString(), signal: controller.signal
            });
            if (!response.ok) fail("查询学期课表失败，HTTP " + response.status);
            html = await response.text();
        } catch (error) {
            if (state.week) fail("当前处于第 " + state.week + " 周，完整学期课表请求失败，不能用单周数据替代：" + error.message);
            warn("完整学期课表请求失败，使用当前“全部”周次页面：" + error.message);
            return context.doc;
        } finally { clearTimeout(timer); }
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (isLoginPage(doc) || (response.url && new URL(response.url).origin !== action.origin)) fail("教务接口返回登录页面，登录已失效。");
        const loaded = snapshot({ doc });
        if (loaded.term !== state.term || loaded.week || loaded.scheme !== state.scheme) fail("接口返回的学期、周次或时间模式与查询条件不一致，已停止导入。");
        return doc;
    }
    function buildGrid(table) {
        const grid = [];
        const rows = Array.from(table.rows);
        rows.forEach((row, r) => {
            if (!grid[r]) grid[r] = [];
            let c = 0;
            for (const cell of row.cells) {
                while (grid[r][c]) c++;
                const width = cell.colSpan || 1;
                const height = cell.rowSpan || 1;
                for (let rr = r; rr < r + height; rr++) {
                    if (!grid[rr]) grid[rr] = [];
                    for (let cc = c; cc < c + width; cc++) {
                        if (grid[rr][cc]) fail("课表存在重叠的合并单元格，无法可靠定位星期列。");
                        grid[rr][cc] = cell;
                    }
                }
                c += width;
            }
        });
        return { grid, rows };
    }
    function parseTimetable(doc) {
        const table = doc.querySelector("#timetable");
        if (!table) fail("未找到个人学期课表表格。");
        const { grid, rows } = buildGrid(table);
        const headerIndex = grid.findIndex(row => row.filter(cell => cell && parseDay(cell.textContent)).length === 7);
        if (headerIndex < 0) fail("未找到七个明确的星期列，禁止按列序猜测星期。");
        const columns = [];
        grid[headerIndex].forEach((cell, column) => {
            const day = cell && parseDay(cell.textContent);
            if (day) columns.push({ column, day });
        });
        if (new Set(columns.map(item => item.day)).size !== 7) fail("课表星期表头重复或不完整。");
        const groups = [];
        for (let r = headerIndex + 1; r < rows.length; r++) {
            const label = grid[r][0];
            if (!label) continue;
            const numberMatch = clean(label.textContent).match(/第([一二三四五六七八九十\d]+)大节/);
            if (!numberMatch) continue;
            const number = chineseNumber(numberMatch[1]);
            const sections = parseSections(label.textContent);
            const time = parseTime(label.textContent);
            if (!number || !time) fail("大节表头缺少编号或明确起止时间：" + clean(label.textContent));
            if (sections.some((n, i) => i > 0 && n !== sections[i - 1] + 1)) fail("大节包含不连续小节，无法建立时间模板。");
            groups.push({ row: r, number, sections, ...time });
        }
        groups.sort((a, b) => a.number - b.number);
        if (!groups.length) fail("未找到带时间的大节表头，无法确定实际课程时间。");
        groups.forEach((group, i) => {
            if (group.number !== i + 1) fail("大节编号不连续，不能生成可靠时间模板。");
            if (i > 0 && (group.startMinutes < groups[i - 1].endMinutes || group.sections[0] !== groups[i - 1].sections.slice(-1)[0] + 1)) fail("大节时间或小节顺序冲突。");
        });
        const pageSections = groups.flatMap(group => group.sections);
        if (pageSections.length !== VERIFIED_TIME_SLOTS.length || pageSections.some((number, i) => number !== i + 1)) {
            fail("当前时间模式不是完整的 1-12 小节，不能套用默认单小节时间模板。");
        }
        const timeSlots = VERIFIED_TIME_SLOTS.map(slot => ({ ...slot }));
        for (const group of groups) {
            const first = timeSlots[group.sections[0] - 1];
            const last = timeSlots[group.sections[group.sections.length - 1] - 1];
            if (!first || !last || first.startTime !== group.startTime || last.endTime !== group.endTime) {
                fail("当前页面第 " + group.number + " 大节与学校公开作息不一致，不能猜测单小节时间。");
            }
        }
        const courses = new Map();
        const cellsSeen = new Set();
        for (const group of groups) {
            for (const { column, day } of columns) {
                const cell = grid[group.row][column];
                if (!cell || cell.tagName !== "TD" || cell.colSpan !== 1) fail("星期 " + day + " 的课程单元格缺失或横跨星期列。");
                if (cellsSeen.has(cell)) continue;
                cellsSeen.add(cell);
                const references = Array.from(cell.querySelectorAll('input[name="jx0415zbdiv_2"]'));
                let containers = references.map(input => doc.getElementById(input.value));
                if (!references.length) containers = Array.from(cell.querySelectorAll('div.kbcontent[id$="-2"]'));
                if (containers.some(node => !node || node.closest("td") !== cell)) fail("课表详情引用不属于当前星期单元格。");
                if (!containers.length) {
                    if (clean(cell.textContent)) fail("课程单元格存在文字但没有可识别的详细课程块。");
                    continue;
                }
                for (const container of containers) {
                    const blocks = Array.from(container.children).filter(node => Array.from(node.classList).some(name => /^per-bg\d+$/.test(name)));
                    if (!blocks.length && clean(container.textContent).replace(/[-\s]/g, "")) fail("课程详情结构发生变化，无法可靠拆分同格多课。");
                    for (const block of blocks) {
                        const prefix = [];
                        for (const node of block.childNodes) {
                            if (node.nodeType === 1 && node.matches("font[title]")) break;
                            prefix.push(node.nodeType === 1 && node.tagName === "BR" ? "\n" : node.textContent);
                        }
                        const lines = prefix.join("").split(/\n+/).map(clean).filter(Boolean);
                        let name = lines[0] || "";
                        let courseNature;
                        if (/\[(?:必修)\]/.test(normalize(name))) courseNature = "required";
                        if (/\[(?:选修)\]/.test(normalize(name))) {
                            if (courseNature) fail("课程性质标记冲突：" + name);
                            courseNature = "elective";
                        }
                        name = clean(name.replace(/[\[【](?:必修|选修|\d+)[\]】]/g, ""));
                        if (!name || /^[\d\s\[\]()（）-]+$/.test(name) || /^(?:备注|无课表课程|星期[一二三四五六日])[:：]?$/.test(name)) fail("课程块中没有有效课程名称。");
                        const scheduleNodes = Array.from(block.querySelectorAll('font[title="周次(节次)"]'));
                        if (scheduleNodes.length !== 1) fail("课程“" + name + "”缺少唯一的周次节次详情。");
                        const schedule = scheduleNodes[0].textContent;
                        const sections = parseSections(schedule);
                        const weeks = parseWeeks(schedule);
                        const teacher = Array.from(block.querySelectorAll('font[title="教师"]')).map(node => clean(node.textContent)).filter(Boolean).join("、");
                        const position = Array.from(block.querySelectorAll('font[title="教室"]')).map(node => clean(node.textContent)).filter(Boolean).join("、");
                        const notes = lines.slice(1).filter(line => !/^\[\d+\]$/.test(normalize(line)));
                        for (const node of block.querySelectorAll('font[title*="班级"]')) {
                            const note = clean(node.textContent);
                            if (note) notes.push(note);
                        }
                        const ranges = [];
                        for (const section of sections) {
                            const last = ranges[ranges.length - 1];
                            if (last && section === last.end + 1) last.end = section;
                            else ranges.push({ start: section, end: section });
                        }
                        for (const range of ranges) {
                            if (range.start < 1 || range.end > timeSlots.length) fail("课程“" + name + "”的节次超出完整时间模板。");
                            const course = {
                                name, teacher, position, day,
                                startSection: range.start,
                                endSection: range.end,
                                isCustomTime: false,
                                weeks,
                                startWeek: weeks[0], endWeek: weeks[weeks.length - 1], customWeeks: weeks.slice(),
                                note: Array.from(new Set(notes.concat("教务小节：" + range.start + "-" + range.end + "节"))).join("；")
                            };
                            if (courseNature) course.courseNature = courseNature;
                            const key = JSON.stringify([name, teacher, position, day, range.start, range.end, weeks, courseNature || ""]);
                            if (!courses.has(key)) courses.set(key, course);
                        }
                    }
                }
            }
        }
        const unscheduled = doc.querySelector("#dataTables");
        if (unscheduled) {
            const count = Array.from(unscheduled.rows).filter(row => row.querySelector("td")).length;
            if (count) warn("另有 " + count + " 条“无课表课程”，缺少排课时间，未导入。");
        }
        const list = Array.from(courses.values()).sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.weeks[0] - b.weeks[0]);
        if (!list.length) fail("未解析到课程。请确认当前学期已排课且课表不是空表。");
        return { courses: list, timeSlots };
    }
    function calendarRecords(context, term) {
        try {
            const data = context.win.xnxqZcData;
            if (data && Array.isArray(data[term]) && data[term].length) return data[term];
        } catch (error) { console.warn("[CAU_01] 无法读取校历全局变量，尝试内嵌脚本。", error); }
        for (const script of context.doc.querySelectorAll("script:not([src])")) {
            const text = script.textContent;
            if (!/\bvar\s+xnxqZcData\s*=/.test(text)) continue;
            const termExpression = new RegExp('["\\\']' + term + '["\\\']\\s*:\\s*\\[([\\s\\S]*?)\\]');
            const termMatch = text.match(termExpression);
            if (!termMatch) continue;
            const records = [];
            for (const entry of termMatch[1].match(/\{[^{}]*\}/g) || []) {
                const week = entry.match(/\bzc\s*:\s*["'](\d+)["']/);
                const date = entry.match(/\bmimxrq\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/);
                if (week && date) records.push({ zc: week[1], mimxrq: date[1] });
            }
            if (records.length) return records;
        }
        return null;
    }
    function parseConfig(contexts, term, courses) {
        const candidates = [];
        for (const context of contexts) {
            const records = calendarRecords(context, term);
            if (!records) continue;
            const sorted = records.map(record => ({ week: Number(record.zc), date: clean(record.mimxrq) })).sort((a, b) => a.week - b.week);
            if (sorted.some((record, i) => record.week !== i + 1 || !calendarDate(record.date))) fail("当前学期校历的周次或日期不完整，不能保存错误学期配置。");
            const start = calendarDate(sorted[0].date);
            if (start.getUTCDay() !== 1 || sorted.some(record => calendarDate(record.date).getTime() - start.getTime() !== (record.week - 1) * 7 * 86400000)) fail("学期校历日期与按周一开始的周次不一致。");
            const maxWeek = Math.max(...courses.flatMap(course => course.weeks));
            if (sorted.length < maxWeek || sorted.length > 30) fail("校历总周数与实际课程周次冲突。");
            candidates.push({ semesterStartDate: sorted[0].date, semesterTotalWeeks: sorted.length });
        }
        if (!candidates.length) {
            warn("未找到所选学期的真实校历；未猜测开学日期或总周数，保留现有学期配置。");
            return null;
        }
        if (candidates.some(item => JSON.stringify(item) !== JSON.stringify(candidates[0]))) fail("多个页面提供的学期校历互相冲突。");
        return candidates[0];
    }
    function checkUnchanged(initial) {
        const scan = collectContexts();
        const tab = activeTab(scan.root.document);
        if (tab && tab.getAttribute("data-sjcode") !== "NEW_XSD_PYGL_WDKB_XQLLKB") fail("导入过程中切换了页面，已停止后续保存。");
        if (initial.context.win.document !== initial.context.doc) fail("导入过程中课表页面发生导航，已停止保存。");
        const now = snapshot(initial.context);
        if (now.term !== initial.state.term || now.week !== initial.state.week || now.scheme !== initial.state.scheme || now.html !== initial.state.html) fail("导入过程中切换了学期、周次、时间模式或课表内容，请等待页面稳定后重新运行。");
    }
    async function save(method, data) {
        const result = await window.AndroidBridgePromise[method](JSON.stringify(data));
        if (result !== true) fail(method + " 未确认保存成功（返回 " + String(result) + "）。");
    }

    try {
        if (window[RUN_KEY]) fail("课表导入正在运行，请勿重复执行。");
        window[RUN_KEY] = true;
        ownsLock = true;
        const bridge = window.AndroidBridgePromise;
        if (!bridge || ["saveImportedCourses", "savePresetTimeSlots", "saveCourseConfig", "showAlert"].some(method => typeof bridge[method] !== "function") || !window.AndroidBridge || typeof window.AndroidBridge.notifyTaskCompletion !== "function") fail("轻屿课表桥接接口不可用。请在浏览器扩展测试工具或应用导入环境中执行。");
        const initial = await waitForTimetable();
        const source = await loadSemester(initial.context, initial.state);
        const { courses, timeSlots } = parseTimetable(source);
        const config = parseConfig(collectContexts().contexts, initial.state.term, courses);
        checkUnchanged(initial);
        if (typeof window.AndroidBridge.showToast === "function") {
            window.AndroidBridge.showToast("本次按普通节次导入。重新导入时请选择替换旧课表，避免保留上一版自定义时间课程。");
        }
        await save("saveImportedCourses", courses);
        coursesSaved = true;
        checkUnchanged(initial);
        await save("savePresetTimeSlots", timeSlots);
        checkUnchanged(initial);
        if (config) await save("saveCourseConfig", config);
        const message = "已导入 " + courses.length + " 条普通节次课程安排及完整的 " + timeSlots.length + " 小节时间模板。";
        if (warnings.length) await window.AndroidBridgePromise.showAlert("课表已导入，请注意", message + "\n\n" + warnings.join("\n"), "知道了");
        if (typeof window.AndroidBridge.showToast === "function") window.AndroidBridge.showToast(message);
        await window.AndroidBridge.notifyTaskCompletion();
    } catch (error) {
        const message = (coursesSaved ? "课程已保存，但后续步骤未完成：" : "课表导入失败：") + (error && error.message ? error.message : String(error));
        console.error("[CAU_01] " + message, error);
        if (window.AndroidBridgePromise && typeof window.AndroidBridgePromise.showAlert === "function") {
            try { await window.AndroidBridgePromise.showAlert("课表导入失败", message, "确定"); }
            catch (alertError) { console.error("[CAU_01] 错误提示也未能显示。", alertError); }
        }
        throw new Error(message);
    } finally {
        if (ownsLock) delete window[RUN_KEY];
    }
})();
