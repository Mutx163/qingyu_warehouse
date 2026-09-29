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
// ⚠️ 改动前务必读完这两条，都是实测踩出来的：
//
// 1) 本脚本只解析「当前浏览器已渲染出来的」课表 DOM，不发任何请求。因此 import_url
//    必须直指课表页，且用户要停留在该页再运行。切勿改写成像某些学校那样 fetch 课表
//    接口——离屏 DOM 没有排版，innerText 不换行，下面基于「按行取字段」的解析会整体
//    失效（实测返回 0 条课程）。
//
// 2) 强智该系统的教师字段是 <font title="老师">，不是别的学校常见的
//    <font title="教师">。本脚本按 innerText 行序取值，天然不依赖该属性名。

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

    window.shiguangBridge.showToast("开始提取课表数据...");

    let table = schoolFindTimetable();
    if (!table) {
        if (schoolRedirectToTimetable()) {
            window.shiguangBridge.showToast("已登录，正在跳转到课表页…跳转后再点一次运行");
            return;
        }
        window.shiguangBridge.showToast("没找到课表！请先登录，再进入“学期理论课表”页面运行。");
        return;
    }

    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "强智教务解析",
        "已检测到课表页面，是否提取数据并导入？",
        "确认导入"
    );
    if (!alertConfirmed) return;

    try {
        let courses = [];
        let courseSet = new Set(); 
        let rows = table.querySelectorAll('tr');

        // 遍历课表每一行（跳过第一行的表头）
        for (let i = 1; i < rows.length; i++) {
            // 【关键修复1】同时获取 th 和 td，防止错位
            let cells = rows[i].querySelectorAll('td, th'); 
            
            for (let j = 0; j < cells.length; j++) {
                let cell = cells[j];
                
                // 【关键修复2】逆向计算星期几：倒数第7列永远是周一，倒数第1列永远是周日
                // 这能完美解决强智系统左侧节次列导致的数据错位问题
                let day = 7 - (cells.length - 1 - j);
                if (day < 1 || day > 7) continue; // 如果算出来不是1-7，说明是左侧的节次列，跳过

                let blocks = cell.innerText.split(/-{5,}/).map(t => t.trim()).filter(t => t);

                for (let block of blocks) {
                    if (!block || block === ' ' || block === '') continue;
                    
                    let lines = block.split(/\n/).map(l => l.trim()).filter(l => l);
                    if(lines.length < 4) {
                        lines = block.split(/\s+/).map(l => l.trim()).filter(l => l);
                    }
                    if (lines.length < 3) continue;

                    let name = lines[0].replace(/\[.*?\]/g, '').trim();
                    let teacher = lines[1] || "未知";

                    let timeRegex = /([\d\-,]+)(?:\((单|双|.*?)\))?.*?\[([\d\-]+)节\]/;
                    let timeLineIdx = lines.findIndex(l => timeRegex.test(l));
                    if (timeLineIdx === -1) continue;

                    let match = lines[timeLineIdx].match(timeRegex);
                    let weeksStr = match[1]; 
                    let oddEven = match[2];  
                    let sectionsStr = match[3]; 

                    let position = (timeLineIdx + 1 < lines.length) ? lines[timeLineIdx + 1] : "未知地点";

                    let weeks = [];
                    let weekParts = weeksStr.split(',');
                    for (let wp of weekParts) {
                        if (wp.includes('-')) {
                            let parts = wp.split('-');
                            let start = parseInt(parts[0]);
                            let end = parseInt(parts[1]);
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

        if (courses.length === 0) {
            window.shiguangBridge.showToast("没有抓取到数据，可能当前表格为空。");
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

    // 学期总周数：课表「周次」下拉最多到第 29 周，当前学期课程最远到第 18 周，
    // 取 20 兼顾后续周次。宿主目前只识别 semesterTotalWeeks 这一个字段。
    await window.shiguangBridgePromise.saveCourseConfig(
        JSON.stringify({ semesterTotalWeeks: 20 })
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

// ===== 课表页定位 =====
// 强智的登录表单不支持"登录后跳转"参数，登录成功一律落在「学生个人中心」。
// 所以 import_url 只能指向登录页（这是登录入口，不是最终目标页）；登录后由本段
// 自动跳到课表页，省得用户手敲网址。
const SCHOOL_TIMETABLE_URL = "http://jw.cqcst.edu.cn/cqdxcskjxy_jsxsd/xskb/xskb_list.do";

function schoolFindTimetable() {
    const table = document.getElementById('kbtable')
        || document.querySelector('.table_border')
        || document.querySelector('table');
    return (table && table.innerText.includes('星期')) ? table : null;
}

// 判据用「退出登录」链接：只有登录之后才会渲染，未登录时不会有。
function schoolRedirectToTimetable() {
    if (!document.querySelector('a[href*="Logout"]')) return false;
    window.location.href = SCHOOL_TIMETABLE_URL;
    return true;
}

runImportFlow();
