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
        "将自动获取本学期课表数据并导入，是否继续？（请确认已登录教务系统）",
        "确认导入"
    );
    if (!alertConfirmed) return;

    try {
        window.shiguangBridge.showToast("正在从教务系统获取课表...");

        const table = await schoolGetTimetableTable();
        if (!table) {
            window.shiguangBridge.showToast("没拿到课表！请先登录教务系统，登录后在任意页面再点一次运行。");
            return;
        }

        let courses = [];
        let courseSet = new Set();
        schoolExtractCourses(table, courses, courseSet);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("没有抓取到数据，可能当前学期课表为空。");
            return;
        }

        window.shiguangBridge.showToast(`提取成功，共发现 ${courses.length} 门课程，正在保存...`);

        const timeSchemeLabel = await schoolApplyTimeScheme();
        if (timeSchemeLabel === null) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (saveResult) {
            window.shiguangBridge.showToast(`导入大功告成！已套用「${timeSchemeLabel}」作息`);
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

async function schoolGetTimetableTable() {
    try {
        const resp = await fetch(SCHOOL_TIMETABLE_URL, { credentials: "include" });
        if (!resp.ok) throw new Error("课表页返回 " + resp.status);
        const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
        const table = doc.getElementById('kbtable') || doc.querySelector('.table_border');
        if (table) return table;
    } catch (error) {
        console.warn("直接请求课表页失败，退回解析当前页面:", error);
    }
    return schoolFindRenderedTimetable();
}

function schoolFindRenderedTimetable() {
    const table = document.getElementById('kbtable')
        || document.querySelector('.table_border')
        || document.querySelector('table');
    return (table && table.innerText.includes('星期')) ? table : null;
}

// ===== 课表提取（DOM 结构取值，不依赖页面排版）=====
// 每个课程块的字段靠源码里的 title 标签取；课程名没有统一标签，取块内第一个
// 非空文本节点（强智模板里课程名总是直接挂在块开头，友校同平台脚本已验证），
// 万一模板变化取不到，再把带标签的字段从文本里剔掉当兜底。
// 周次节次仍沿用旧版实测过的正则，对整块文本匹配——无论它挂在哪个标签里。

function schoolExtractCourses(table, courses, courseSet) {
    const timeRegex = /([\d\-,]+)(?:\((单|双|.*?)\))?.*?\[([\d\-]+)节\]/;

    const rows = table.querySelectorAll('tr');
    for (let i = 0; i < rows.length; i++) {
        // 【关键修复1】同时获取 th 和 td，防止错位
        let cells = rows[i].querySelectorAll('td, th');

        for (let j = 0; j < cells.length; j++) {
            let cell = cells[j];

            // 【关键修复2】逆向计算星期几：倒数第7列永远是周一，倒数第1列永远是周日
            // 这能完美解决强智系统左侧节次列导致的数据错位问题，也天然兼容跨行课
            let day = 7 - (cells.length - 1 - j);
            if (day < 1 || day > 7) continue; // 如果算出来不是1-7，说明是左侧的节次列，跳过

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
                        name = (stripped.textContent || '').trim().split(/\s+/).filter(Boolean)[0] || '';
                    }

                    let teacher = (temp.querySelector('font[title="老师"]')
                        || temp.querySelector('font[title="教师"]'))?.textContent.trim() || "未知";
                    let position = temp.querySelector('font[title="教室"]')?.textContent.trim() || "未知地点";

                    const match = (temp.textContent || '').match(timeRegex);
                    if (!match) continue;
                    let weeksStr = match[1];
                    let oddEven = match[2];
                    let sectionsStr = match[3];

                    let weeks = [];
                    let weekParts = weeksStr.split(',');
                    for (let wp of weekParts) {
                        if (wp.includes('-')) {
                            let parts2 = wp.split('-');
                            let start = parseInt(parts2[0]);
                            let end = parseInt(parts2[1]);
                            for (let w = start; w <= end; w++) {
                                if (oddEven === '单' && w % 2 === 0) continue;
                                if (oddEven === '双' && w % 2 !== 0) continue;
                                weeks.push(w);
                            }
                        } else {
                            weeks.push(parseInt(wp));
                        }
                    }

                    let secParts = sectionsStr.split('-');
                    let startSection = parseInt(secParts[0]);
                    let endSection = parseInt(secParts[secParts.length - 1]);

                    if (!name || !weeks.length || isNaN(startSection)) continue;

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
                            weeks: weeks
                        });
                    }
                }
            }
        }
    }
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
async function schoolApplyTimeScheme() {
    const pick = schoolNormalizePick(
        await window.shiguangBridgePromise.showSingleSelection(
            "你在哪个校区？",
            JSON.stringify(SCHOOL_CAMPUS_CHOICES.map(c => c.label)),
            0
        ),
        SCHOOL_CAMPUS_CHOICES.length
    );
    if (pick === null) return null;
    const schemeIndex = SCHOOL_CAMPUS_CHOICES[pick].schemeIndex;

    // 学期配置（⚠️ 每学期更新）：
    // 总周数——课表「周次」下拉最多到第 29 周，当前学期课程最远到第 18 周，
    //   取 20 兼顾后续周次。
    // 开学日期——2026-2027-1 学期第一周从 2026-09-07（周一）起。App 用它算当前
    //   周次，不预置的话首页周数对不上。历法校验在 App 侧（warehouseSemesterStartDate）。
    await window.shiguangBridgePromise.saveCourseConfig(
        JSON.stringify({ semesterTotalWeeks: 20, semesterStartDate: "2026-09-07" })
    );

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
