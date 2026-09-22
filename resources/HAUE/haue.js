/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 河南工程学院(haue.edu.cn) 轻屿课表适配脚本
// 基于强智新版教务系统(jwglxt)接口适配
// 接口: /jwglxt/kbcx/xskbcx_cxXsgrkb.html (个人课表)
// 校内入口 106.system.haue.edu.cn / 校外入口 124.system.haue.edu.cn 通用(location.origin 动态取)
// 域名不写死,登录哪个入口就跑哪个入口,同源请求避免CORS
// 非该校开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); // 匹配以数字周结束的

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }
        
        if (processed) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据(kbList 理论课表)。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");
    
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return []; 
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段: kcmc(课名), xm(教师), cdmc(教室), xqj(星期), jcs(节次范围), zcd(周次描述)
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc || 
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        
        if (weeksArray.length === 0) {
            continue;
        }
        
        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]); 

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)
        
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day, 
            startSection: startSection,
            endSection: endSection, 
            weeks: weeksArray
        });
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );
    
    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

/**
 * 检查是否在登录页面。
 */
function isLoginPage() {
    const url = window.location.href;
    return url.includes("/xtgl/login_slogin.html"); 
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年！";
    }
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（如2026-2027 应该填2026）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

/**
 * 将选择索引转换为 API 所需的学期码。
 * 强智: 第一学期=3, 第二学期=12
 */
function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = getSemesterCode(semesterIndex);
    
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = location.origin + "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

    console.log(`JS: 发送请求到 ${url}, body: ${xnmXqmBody}`);

    const requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8", 
        },
        "body": xnmXqmBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }
        
        const jsonText = await response.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            window.shiguangBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData); 

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }
        
        const config = {
            semesterTotalWeeks: 20,
            firstDayOfWeek: 1 
        };

        return { courses: courses, config: config }; 

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

// 河南工程学院作息时间(按大节推导,实测定校)
const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "18:20", endTime: "19:05" },
    { number: 10, startTime: "19:30", endTime: "20:15" },
    { number: 11, startTime: "20:25", endTime: "21:10" },
    { number: 12, startTime: "21:20", endTime: "22:05" }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        }
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;

    const academicYear = await getAcademicYear();
    if (academicYear === null) return;

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) return;

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) return;
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) return;
    
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
