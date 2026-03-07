/**
 * 长江大学（树维教务系统）课表导入适配脚本
 *
 * 树维教务系统特点：
 * 1. 课表以空 HTML 表格返回，课程数据通过 JavaScript 脚本动态注入
 * 2. 脚本中包含 `new TaskActivity(...)` 构造函数调用来定义课程
 * 3. 需要从脚本文本中直接提取课程信息，而不是解析 DOM
 *
 * 适用于使用树维教务系统的其他高校（需修改 BASE 地址）
 */

(function () {
    const BASE = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
    const MAX_PREVIEW_LEN = 300;

    const diagState = {
        currentStep: "init",
        events: []
    };

    function truncateText(value, maxLen) {
        const text = String(value == null ? "" : value);
        if (text.length <= maxLen) return text;
        return `${text.slice(0, maxLen)}...<truncated ${text.length - maxLen} chars>`;
    }

    function toSafeJson(value) {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function recordDiag(step, info) {
        diagState.currentStep = step || diagState.currentStep;
        diagState.events.push({
            at: new Date().toISOString(),
            step: diagState.currentStep,
            info: info || ""
        });

        if (diagState.events.length > 80) {
            diagState.events = diagState.events.slice(-80);
        }
    }

    function createImportError(step, message, context, cause) {
        const error = new Error(message || "导入失败");
        error.name = "ImportFlowError";
        error.step = step || diagState.currentStep;
        error.context = context || {};
        error.cause = cause;
        return error;
    }

    function formatErrorDetails(error) {
        const lines = [];
        const err = error || {};
        const step = err.step || diagState.currentStep || "unknown";
        const now = new Date().toISOString();

        lines.push(`Time: ${now}`);
        lines.push(`Step: ${step}`);
        lines.push(`Name: ${err.name || "Error"}`);
        lines.push(`Message: ${err.message || String(err)}`);

        if (err.stack) {
            lines.push("Stack:");
            lines.push(String(err.stack));
        }

        if (err.context && Object.keys(err.context).length > 0) {
            lines.push("Context:");
            lines.push(truncateText(toSafeJson(err.context), 1500));
        }

        if (err.cause) {
            const causeMsg = err.cause && err.cause.message ? err.cause.message : String(err.cause);
            lines.push(`Cause: ${causeMsg}`);
            if (err.cause && err.cause.stack) {
                lines.push("CauseStack:");
                lines.push(String(err.cause.stack));
            }
        }

        if (diagState.events.length > 0) {
            lines.push("Trace:");
            const recentEvents = diagState.events.slice(-20);
            recentEvents.forEach((event) => {
                lines.push(`[${event.at}] ${event.step} | ${truncateText(event.info, 200)}`);
            });
        }

        return lines.join("\n");
    }

    function extractCourseHtmlDebugInfo(courseHtml) {
        const text = String(courseHtml || "");
        const hasTaskActivity = /new\s+TaskActivity\s*\(/i.test(text);
        const hasUnitCount = /\bvar\s+unitCount\s*=\s*\d+/i.test(text);

        return {
            responseLength: text.length,
            hasTaskActivity,
            hasUnitCount,
            headPreview: truncateText(text.slice(0, 2000), 2000),
            tailPreview: truncateText(text.slice(-1000), 1000)
        };
    }

    function safeToast(message) {
        try {
            window.AndroidBridge && AndroidBridge.showToast(String(message || ""));
        } catch (_) {
            console.log("[Toast Fallback]", message);
        }
    }

    async function safeShowDetailedError(title, details) {
        const text = truncateText(details, 3500);

        try {
            if (window.AndroidBridgePromise && typeof window.AndroidBridgePromise.showAlert === "function") {
                await window.AndroidBridgePromise.showAlert(title || "导入失败", text, "确定");
                return;
            }
        } catch (alertError) {
            console.warn("[Error Alert Fallback] showAlert failed:", alertError);
        }

        safeToast(title || "导入失败");
        console.error("[Detailed Error]", text);
    }

    function ensureBridgePromise() {
        if (!window.AndroidBridgePromise) {
            throw new Error("AndroidBridgePromise 不可用，无法进行导入交互。");
        }
    }

    async function requestText(url, options) {
        const requestOptions = {
            credentials: "include",
            ...options
        };

        const method = requestOptions.method || "GET";
        recordDiag("http_request", `${method} ${url}`);

        let res;
        try {
            res = await fetch(url, requestOptions);
        } catch (networkError) {
            throw createImportError(
                "http_request",
                `网络请求失败: ${method} ${url}`,
                {
                    url,
                    method,
                    bodyPreview: truncateText(requestOptions.body, MAX_PREVIEW_LEN)
                },
                networkError
            );
        }

        const text = await res.text();
        recordDiag("http_response", `${method} ${url} -> ${res.status}, len=${text.length}`);

        if (!res.ok) {
            throw createImportError("http_response", `请求失败(${res.status}): ${url}`, {
                url,
                method,
                status: res.status,
                bodyPreview: truncateText(requestOptions.body, MAX_PREVIEW_LEN),
                responsePreview: truncateText(text, MAX_PREVIEW_LEN)
            });
        }
        return text;
    }

    // 从入口页面 HTML 中提取学生 ID 和学期选择组件的 tagId
    // 树维系统通过 bg.form.addInput 注入学生 ID，通过 semesterBar 提供学期选择
    function parseEntryParams(entryHtml) {
        const idsMatch = entryHtml.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
        const tagIdMatch = entryHtml.match(/id="(semesterBar\d+Semester)"/);

        return {
            studentId: idsMatch ? idsMatch[1] : "",
            tagId: tagIdMatch ? tagIdMatch[1] : ""
        };
    }

    // 解析学期列表，树维接口返回的是 JavaScript 对象字面量（非标准 JSON）
    // 格式: { semesters: { "2024-2025-1": [{id: 389, schoolYear: "2024-2025", name: "1"}] } }
    function parseSemesterResponse(rawText) {
        let data;
        try {
            // 使用 Function 构造器执行对象字面量文本
            data = Function(`return (${String(rawText || "").trim()});`)();
        } catch (parseError) {
            throw createImportError(
                "parse_semester",
                "学期数据解析失败",
                { rawPreview: truncateText(rawText, MAX_PREVIEW_LEN) },
                parseError
            );
        }

        const semesters = [];

        if (!data || !data.semesters || typeof data.semesters !== "object") {
            return semesters;
        }

        Object.keys(data.semesters).forEach((k) => {
            const arr = data.semesters[k];
            if (!Array.isArray(arr)) return;

            arr.forEach((s) => {
                if (!s || !s.id) return;
                semesters.push({
                    id: String(s.id),
                    name: `${s.schoolYear || ""} 第${s.name || ""}学期`.trim()
                });
            });
        });

        return semesters;
    }

    // 清除课程名后面的课程序号
    function cleanCourseName(name) {
        return String(name || "").replace(/\(\d+\)\s*$/, "").trim();
    }

    // 解析周次位图字符串，树维系统使用位图表示课程在哪些周有效
    function parseValidWeeksBitmap(bitmap) {
        if (!bitmap || typeof bitmap !== "string") return [];
        const weeks = [];
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === "1" && i >= 1) weeks.push(i);
        }
        return weeks;
    }

    function normalizeWeeks(weeks) {
        const list = Array.from(new Set((weeks || []).filter((w) => Number.isInteger(w) && w > 0)));
        list.sort((a, b) => a - b);
        return list;
    }

    // 将教务系统的节次映射到 TimeSlots 编号
    // 教务系统返回的节次顺序: 1-6为正常排列，7为午间课，8为晚间课
    // TimeSlots 的顺序: 完全按时间排列，3为午间课，6为晚间课
    function mapSectionToTimeSlotNumber(section) {
        const mapping = {
            1: 1,
            2: 2,
            3: 4,
            4: 5,
            5: 7,
            6: 8,
            7: 3,
            8: 6
        };
        return mapping[section] || section;
    }

    // 反引号化 JavaScript 字面量字符串，处理转义字符
    function unquoteJsLiteral(token) {
        const text = String(token || "").trim();
        if (!text) return "";
        if (text === "null" || text === "undefined") return "";

        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            const quote = text[0];
            let inner = text.slice(1, -1);

            inner = inner
                .replace(/\\\\/g, "\\")
                .replace(new RegExp(`\\\\${quote}`, "g"), quote)
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t");

            return inner;
        }

        return text;
    }

    // 分割 JavaScript 函数参数字符串，正确处理引号和转义
    function splitJsArgs(argsText) {
        const args = [];
        let curr = "";
        let inQuote = "";
        let escaped = false;

        for (let i = 0; i < argsText.length; i++) {
            const ch = argsText[i];

            if (escaped) {
                curr += ch;
                escaped = false;
                continue;
            }

            if (ch === "\\") {
                curr += ch;
                escaped = true;
                continue;
            }

            if (inQuote) {
                curr += ch;
                if (ch === inQuote) inQuote = "";
                continue;
            }

            if (ch === "\"" || ch === "'") {
                curr += ch;
                inQuote = ch;
                continue;
            }

            if (ch === ",") {
                args.push(curr.trim());
                curr = "";
                continue;
            }

            curr += ch;
        }

        if (curr.trim() || argsText.endsWith(",")) {
            args.push(curr.trim());
        }

        return args;
    }

    /**
     * 从课表响应的 JavaScript 脚本中解析课程（树维教务核心解析逻辑）
     *
     * 树维系统返回的 HTML 中，表格单元格是空的，真正的课程数据在 <script> 中：
     * var unitCount = 8;  // 每天的节次数
     * activity = new TaskActivity(teacherId, teacherName, courseId, courseName, ...);
     * index = day * unitCount + section;  // 计算课程在二维表格中的位置
     * table0.activities[index] = activity;
     *
     * @param {string} htmlText - 课表响应的完整 HTML
     * @returns {Array} 课程数组
     */
    function parseCoursesFromTaskActivityScript(htmlText) {
        const text = String(htmlText || "");
        if (!text) return [];

        // 提取 unitCount（每天的节次数，通常为 8）
        const unitCountMatch = text.match(/\bvar\s+unitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 0;
        if (!Number.isInteger(unitCount) || unitCount <= 0) return [];

        const courses = [];
        const stats = {
            blocks: 0,
            teacherRecovered: 0,
            teacherUnresolvedExpression: 0
        };
        // 匹配所有 TaskActivity 构造调用块
        // TaskActivity 参数顺序: teacherId, teacherName, courseId, courseName, classId, room, weekBitmap, ...
        const blockRe = /activity\s*=\s*new\s+TaskActivity\(([^]*?)\)\s*;\s*index\s*=\s*(?:(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)|(\d+))\s*;\s*table\d+\.activities\[index\]/g;
        let match;

        while ((match = blockRe.exec(text)) !== null) {
            stats.blocks += 1;
            const argsText = match[1] || "";
            const args = splitJsArgs(argsText);
            if (args.length < 7) continue;

            // 解析 index 计算表达式，确定星期几和第几节
            const dayPart = match[2];
            const sectionPart = match[3];
            const directIndexPart = match[4];

            let indexValue = -1;
            if (dayPart != null && sectionPart != null) {
                indexValue = parseInt(dayPart, 10) * unitCount + parseInt(sectionPart, 10);
            } else if (directIndexPart != null) {
                indexValue = parseInt(directIndexPart, 10);
            }

            if (!Number.isInteger(indexValue) || indexValue < 0) continue;

            // 从线性索引反推星期和节次
            const day = Math.floor(indexValue / unitCount) + 1;
            let section = (indexValue % unitCount) + 1;
            // 将教务系统的节次映射到 TimeSlots 编号
            section = mapSectionToTimeSlotNumber(section);
            if (day < 1 || day > 7 || section < 1 || section > 16) continue;

            // 提取课程字段：教师(args[1])、课程名(args[3])、教室(args[5])、周次位图(args[6])
            let teacher = unquoteJsLiteral(args[1]);
            // 如果教师名是表达式（如 actTeacherName.join(',')），反向解析真实姓名
            if (teacher && !/^['"]/.test(String(args[1]).trim()) && /join\s*\(/.test(String(args[1]))) {
                const resolved = resolveTeachersForTaskActivityBlock(text, match.index);
                if (resolved) {
                    teacher = resolved;
                    stats.teacherRecovered += 1;
                } else {
                    stats.teacherUnresolvedExpression += 1;
                }
            }
            const name = cleanCourseName(unquoteJsLiteral(args[3]));
            const position = unquoteJsLiteral(args[5]);
            const weekBitmap = unquoteJsLiteral(args[6]);
            const weeks = normalizeWeeks(parseValidWeeksBitmap(weekBitmap));

            if (!name) continue;

            courses.push({
                name,
                teacher,
                position,
                day,
                startSection: section,
                endSection: section,
                weeks
            });
        }

        console.info("[课程解析 TaskActivity]", {
            blocks: stats.blocks,
            parsedCourses: courses.length,
            teacherRecovered: stats.teacherRecovered,
            teacherUnresolvedExpression: stats.teacherUnresolvedExpression
        });

        return mergeContiguousSections(courses);
    }

    // 从 TaskActivity 块前的代码中反解析教师真实姓名
    // 树维系统会先定义 var actTeachers = [{id:123, name:"张三"}]，再用 actTeacherName.join(',') 传参
    function resolveTeachersForTaskActivityBlock(fullText, blockStartIndex) {
        // 向前搜索最近的 actTeachers 变量定义（一般在前 2000 字符内）
        const start = Math.max(0, blockStartIndex - 2200);
        const segment = fullText.slice(start, blockStartIndex);
        const re = /var\s+actTeachers\s*=\s*\[([^]*?)\]\s*;/g;
        let m;
        let last = null;
        while ((m = re.exec(segment)) !== null) {
            last = m[1];
        }
        if (!last) return "";

        const names = [];
        const nameRe = /name\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
        let nm;
        while ((nm = nameRe.exec(last)) !== null) {
            const name = (nm[1] || nm[2] || "").trim();
            if (name) names.push(name);
        }

        if (names.length === 0) return "";
        return Array.from(new Set(names)).join(",");
    }

    // 合并同一课程的连续节次
    function mergeContiguousSections(courses) {
        const list = (courses || [])
            .filter((c) => c && c.name && Number.isInteger(c.day) && Number.isInteger(c.startSection) && Number.isInteger(c.endSection))
            .map((c) => ({
                ...c,
                weeks: normalizeWeeks(c.weeks)
            }));

        list.sort((a, b) => {
            const ak = `${a.name}|${a.teacher}|${a.position}|${a.day}|${a.weeks.join(",")}`;
            const bk = `${b.name}|${b.teacher}|${b.position}|${b.day}|${b.weeks.join(",")}`;
            if (ak < bk) return -1;
            if (ak > bk) return 1;
            return a.startSection - b.startSection;
        });

        const merged = [];
        for (const item of list) {
            const prev = merged[merged.length - 1];
            const canMerge = prev
                && prev.name === item.name
                && prev.teacher === item.teacher
                && prev.position === item.position
                && prev.day === item.day
                && prev.weeks.join(",") === item.weeks.join(",")
                && prev.endSection + 1 >= item.startSection;

            if (canMerge) {
                prev.endSection = Math.max(prev.endSection, item.endSection);
            } else {
                merged.push({ ...item });
            }
        }
        return merged;
    }

    function getPresetTimeSlots() {
        return [
            { number: 1, startTime: "08:00", endTime: "08:45" },
            { number: 2, startTime: "10:05", endTime: "11:40" },
            { number: 3, startTime: "12:00", endTime: "13:35" }, // 午间课
            { number: 4, startTime: "14:00", endTime: "15:35" },
            { number: 5, startTime: "16:05", endTime: "17:40" },
            { number: 6, startTime: "17:45", endTime: "18:30" }, // 晚间课，部分课程为 18:00-18:45
            { number: 7, startTime: "19:00", endTime: "20:35" },
            { number: 8, startTime: "20:45", endTime: "22:20" }
        ];
    }

    async function runImportFlow() {
        ensureBridgePromise();
        recordDiag("start", `base=${BASE}`);
        safeToast("开始自动探测长江大学教务参数...");

        // 1) 探测学生 ID（ids）和学期选择组件 ID（tagId）
        recordDiag("detect_params", "request entry page");
        const entryUrl = `${BASE}/eams/courseTableForStd.action?&sf_request_type=ajax`;
        const entryHtml = await requestText(entryUrl, {
            method: "GET",
            headers: { "x-requested-with": "XMLHttpRequest" }
        });

        const params = parseEntryParams(entryHtml);
        recordDiag("detect_params", `studentId=${params.studentId ? "ok" : "missing"}, tagId=${params.tagId ? "ok" : "missing"}`);
        if (!params.studentId || !params.tagId) {
            await window.AndroidBridgePromise.showAlert(
                "参数探测失败",
                "未能识别学生 ID 或学期组件 tagId，请确认已登录后重试。",
                "确定"
            );
            return;
        }

        // 2) 获取学期列表并让用户选择（最近 8 个）
        recordDiag("load_semesters", "request semester list");
        const semesterRaw = await requestText(`${BASE}/eams/dataQuery.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `tagId=${encodeURIComponent(params.tagId)}&dataType=semesterCalendar`
        });

        const allSemesters = parseSemesterResponse(semesterRaw);
        recordDiag("load_semesters", `semesterCount=${allSemesters.length}`);
        if (allSemesters.length === 0) {
            throw createImportError("load_semesters", "学期列表为空，无法继续导入。", {
                responsePreview: truncateText(semesterRaw, MAX_PREVIEW_LEN)
            });
        }

        const recentSemesters = allSemesters.slice(-8);
        const selectIndex = await window.AndroidBridgePromise.showSingleSelection(
            "请选择导入学期",
            JSON.stringify(recentSemesters.map((s) => s.name || s.id)),
            recentSemesters.length - 1
        );

        if (selectIndex === null) {
            recordDiag("select_semester", "user cancelled");
            safeToast("已取消导入");
            return;
        }

        const selectedSemester = recentSemesters[selectIndex];
        recordDiag("select_semester", `selected=${selectedSemester.id}`);
        safeToast("正在获取课表数据...");

        // 3) 拉取选定学期的课表 HTML
        recordDiag("load_courses", "request course table html");
        const courseHtml = await requestText(`${BASE}/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: [
                "ignoreHead=1",
                "setting.kind=std",
                "startWeek=",
                `semester.id=${encodeURIComponent(selectedSemester.id)}`,
                `ids=${encodeURIComponent(params.studentId)}`
            ].join("&")
        });

        // 4) 解析课表脚本并保存到应用
        const courses = parseCoursesFromTaskActivityScript(courseHtml);
        recordDiag("parse_courses", `count=${courses.length}`);

        if (courses.length === 0) {
            const debugInfo = extractCourseHtmlDebugInfo(courseHtml);
            recordDiag("parse_courses", `no-course len=${debugInfo.responseLength}, hasTaskActivity=${debugInfo.hasTaskActivity}`);

            window.__IMPORT_DEBUG_LAST_COURSE_HTML = String(courseHtml || "");
            console.warn("[课表解析失败]", debugInfo);

            await safeShowDetailedError(
                "解析失败",
                [
                    "未能从课表响应中识别到课程。",
                    `响应长度: ${debugInfo.responseLength}`,
                    `包含 TaskActivity: ${debugInfo.hasTaskActivity}`,
                    `包含 unitCount: ${debugInfo.hasUnitCount}`,
                    "",
                    "[头部预览]",
                    debugInfo.headPreview,
                    "",
                    "[尾部预览]",
                    debugInfo.tailPreview,
                    "",
                    "完整响应: window.__IMPORT_DEBUG_LAST_COURSE_HTML"
                ].join("\n")
            );
            return;
        }

        recordDiag("save_courses", `count=${courses.length}`);
        console.info("[导入结果]", {
            courseCount: courses.length,
            sample: courses.slice(0, 3)
        });
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(getPresetTimeSlots()));

        recordDiag("done", "import success");
        safeToast(`导入成功，共 ${courses.length} 条课程`);
        AndroidBridge.notifyTaskCompletion();
    }

    (async function bootstrap() {
        try {
            await runImportFlow();
        } catch (error) {
            const normalizedError = (error && error.name === "ImportFlowError")
                ? error
                : createImportError(diagState.currentStep, error && error.message ? error.message : "未知错误", {}, error);

            const details = formatErrorDetails(normalizedError);
            console.error("[长江大学教务适配] 导入失败详情:\n" + details);
            await safeShowDetailedError("导入失败（详细信息）", details);
            safeToast(`导入失败：${normalizedError.message || normalizedError}`);
        }
    })();
})();
