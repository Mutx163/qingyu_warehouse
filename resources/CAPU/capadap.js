// 文件: capadap.js
//后期可加入接口-获取校区  https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduledCampus.do


/**
 * 显示导入提示
 */
async function promptUserToStart() {
    const confirmed = await window.AndroidBridgePromise.showAlert(
        "导入确认",
        "请确保您已经登录咯~",
        "开始导入"
    );
    if (!confirmed) {
        AndroidBridge.showToast("用户取消了导入");
        return false;
    }
    AndroidBridge.showToast("开始流程咯~");
    return true;
}

/**
 * 请求工具
 */
async function api(url, options = {}) {
    //设置默认值
    const method = options.method || (options.data ? "POST" : "GET");

    const headers = {
        "fetch-api": "true",
        "x-requested-with": "XMLHttpRequest",
        "Referer": "https://jwxt.cap.edu.cn/jwapp/sys/homeapp/home/index.html",
        ...(options.data && { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }),
        ...options.headers // 允许传入自定义 header 覆盖上面这些
    };
    //发起请求
    const res = await fetch(url, {
        method: method,
        headers: headers,
        body: options.data || null,
        credentials: "include"
    });

    return res.json();
}

//共享变量
const AppConfig = {
    currentSemester: null,
    postData: null,
};

/**
 * 提取上课时间   开学时间   课程周数
 */
async function extractCourseTime() { 

    try {  //上课时间
        const userRes = await api("https://jwxt.cap.edu.cn/jwapp/sys/homeapp/api/home/currentUser.do");
        AppConfig.currentSemester = userRes.datas.welcomeInfo.xnxqdm; //获取学期
        console.log("检测到当前学期:", AppConfig.currentSemester);

        AppConfig.postData = `XNXQDM=${AppConfig.currentSemester}&XQDM=01`;
        //XQDM这里暂不知道有什么用，2返回的也是一个时间 不知道是不是代表不同校区 暂时用（‘龙泉’校区）替代
        const res = await api("https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMySectionList.do", {
            data: AppConfig.postData,
        })
        const rawSections = res.datas.getMySectionList;

        const cleanSections = rawSections
        .filter(item => item.name.includes("第")) 
        .map(item => ({
            "number": parseInt(item.name.replace(/[^0-9]/g, "")),
            "startTime": item.startTime, // 必须叫 startTime
            "endTime": item.endTime      // 必须叫 endTime
        }))
        .sort((a, b) => a.number - b.number);
        console.log(cleanSections)
        //开学时间 课程周数
        
        const weekRes = await api("https://jwxt.cap.edu.cn/jwapp/sys/homeapp/api/home/getTermWeeks.do",
            {
            data: `termCode=${AppConfig.currentSemester}`
            });
        const finalWeeks = weekRes.datas.map(item => ({
        "week": item.serialNumber,          // 周序 (1, 2, 3...)
        "startTime": item.startDate.split(' ')[0], // 格式化为 YYYY-MM-DD
        "endTime": item.endDate.split(' ')[0],   // 格式化为 YYYY-MM-DD
        "isCurrent": item.curWeek           // 是否为当前周     
        }));
        const totalWeeks = finalWeeks.length;
        const startDate = finalWeeks[0].startTime;
        console.log(AppConfig.currentSemester, totalWeeks,startDate,cleanSections)
        
        return {
            currentSemester: AppConfig.currentSemester,
            totalWeeks,
            startDate,
            cleanSections  //每日课程时间  timeSlots!!!
        };
    
    }
    catch (error) {
        console.error('解析开学时间时出错:', error);
        AndroidBridge.showToast(`解析开学时间失败: ${error.message}`);
        return null;
    }

}//返回 学期时间 课程周数 开始时间 时间表
//      2025-2026-2 19 2026-03-09 Array

/**
 * 获取课表数据 返回的是原始数据
 */
async function getCourseData() {
    const courseRes = await api("https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduleDetail.do", {
        data: AppConfig.postData,
    })
    const rawCourses = courseRes?.datas?.getMyScheduleDetail?.arrangedList || [];
    // console.log("获取到课程数据:", rawCourses);
    return rawCourses;
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = [];
    // 1. 处理逗号分隔的多个区间
    const segments = weekStr.replace(/周/g, "").split(",");

    segments.forEach(seg => {
        // 处理单双周逻辑
        const isOnlyOdd = seg.includes("(单)");
        const isOnlyEven = seg.includes("(双)");
        const cleanSeg = seg.replace(/\(单\)|\(双\)/g, "");

        if (cleanSeg.includes("-")) {
            // 处理范围型：1-4
            const [start, end] = cleanSeg.split("-").map(Number);
            for (let i = start; i <= end; i++) {
                if (isOnlyOdd && i % 2 === 0) continue;
                if (isOnlyEven && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            // 处理单个数字
            const num = Number(cleanSeg);
            if (!isNaN(num)) weeks.push(num);
        }
    });

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 1. 展开周次函数：支持 1-3周(单), 7-17周(单) 等
 */
function expandWeeks(rawStr) {
    const weeks = [];
    if (!rawStr) return weeks;

    const cleanStr = rawStr.replace(/\s+/g, '').replace(/，/g, ',').replace(/周/g, '');
    const isOdd = cleanStr.includes('(单)');
    const isEven = cleanStr.includes('(双)');
    const rangePart = cleanStr.replace(/\([单双]\)/g, '');
    
    rangePart.split(',').forEach(segment => {
        if (segment.includes('-')) {
            const [start, end] = segment.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                if (isOdd && i % 2 === 0) continue;
                if (isEven && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            const num = parseInt(segment);
            if (!isNaN(num)) {
                if (isOdd && num % 2 === 0) return;
                if (isEven && num % 2 !== 0) return;
                weeks.push(num);
            }
        }
    });
    return weeks;
}

/**
 * 2. 单行解析函数：提取核心信息
 */
function parseDetailLine(line) {
    // 移除 HTML 标签
    const cleanLine = line.replace(/<[^>]+>/g, "").trim();
    const parts = cleanLine.split(/\s+/);

    // 假设格式为：[周次] [老师] [建筑/校区] [具体地点]
    const rawWeek = parts[0] || "";
    const teacher = parts[1] || "未知教师";
    const building = parts[2] || "";
    const location = parts[3] || "";

    let finalPosition = "";

    if (location.includes(building)) {
        finalPosition = location; 
    } else {
        finalPosition = building + " " + location;
    }

    finalPosition = finalPosition.trim();

    return {
        rawWeek,
        teacher,
        building,
        location,
        weeks: parseWeeks(rawWeek) 
    };
}

/**
 * 3. 智能汇总函数：处理地点变动逻辑
 */
function extractAndMergeCourse(titleDetail) {
    if (!titleDetail || titleDetail.length === 0) return null;

    const courseName = titleDetail[0];
    // 过滤掉第一行课程名，解析后面所有的详情行
    const rawSlots = titleDetail.slice(1).map(line => parseDetailLine(line));

    const mergedMap = new Map();

    rawSlots.forEach(slot => {
        // 连堂课如果地点老师一样，就合并周次；如果不一样（比如一半在教室一半在实验室），会拆分成两个 segment
        const identifier = `${slot.teacher}|${slot.building}|${slot.location}`;
        
        if (mergedMap.has(identifier)) {
            const existing = mergedMap.get(identifier);
            // 合并周次并去重排序
            existing.weeks = [...new Set([...existing.weeks, ...slot.weeks])].sort((a, b) => a - b);
            existing.rawWeeksDesc += `, ${slot.rawWeek}`;
        } else {
            mergedMap.set(identifier, {
                teacher: slot.teacher,
                building: slot.building,
                location: slot.location,
                weeks: slot.weeks,
                rawWeeksDesc: slot.rawWeek
            });
        }
    });

    const segments = Array.from(mergedMap.values());

    // --- 修复点：先计算，再打印和返回 ---
    const allActiveWeeks = [...new Set(segments.flatMap(s => s.weeks))].sort((a, b) => a - b);
    
    console.log("解析课程:", courseName, "总周次:", allActiveWeeks);

    return {
        courseName,
        allActiveWeeks,
        segments
    };
}


function fixSection(section) {
    let realSection = section;
    if (section > 5) realSection -= 1; // 减去中午那节课
    if (section > 10) realSection -= 1; // 减去晚餐那节课
    return realSection;
}

/**
 * 解析函数  Gemini所写  
 */
function parseAllCourses(rawArrangedList) {
    const finalCourses = [];
    if (!rawArrangedList || !Array.isArray(rawArrangedList)) return [];
    
    rawArrangedList.forEach(item => {
        if (item.titleDetail && item.titleDetail.length > 0) {
            const mergedResult = extractAndMergeCourse(item.titleDetail);
            if (!mergedResult) return;

            // 优先使用数据里的数字字段，因为 titleDetail 有时会被截断
            const sSection = parseInt(item.beginSection || item.startSection);
            const eSection = parseInt(item.endSection);
            const day = parseInt(item.dayOfWeek || item.day);

            mergedResult.segments.forEach(seg => {
                if (!isNaN(sSection) && !isNaN(eSection)) {
                    finalCourses.push({
                        name: mergedResult.courseName,
                        teacher: seg.teacher,
                        position: (seg.building + " " + seg.location).trim(),
                        day: day, 
                        startSection: sSection,
                        endSection: eSection,
                        weeks: seg.weeks,
                        startTime: seg.startTime, // 记录开始时间防止后续需要
                        endTime: seg.endTime
                    });
                }
            });
        }
    }); 

    return finalCourses;
}
/**
 * 获取所有课程信息
 */
async function fetchAllRawData() {
    try {
        // 获取基础环境信息 (学期、开学日期、时间表)
        const baseInfo = await extractCourseTime();
        if (!baseInfo) return null;

        const rawArrangedList = await getCourseData();
        
        if (!rawArrangedList || rawArrangedList.length === 0) {
            AndroidBridge.showToast("未检测到当前学期的课程数据");
            return null;
        }

        return { baseInfo, rawArrangedList };
    } catch (e) {
        console.error("抓取数据失败:", e);
        return null;
    }
}

/**
 * 保存
 */
   async function executeSaveSequence(finalCourses, baseInfo) {
    try {
        // 1. 保存基础配置 (开学日期、总周数)
        const configData = {
            semesterStartDate: baseInfo.startDate,
            semesterTotalWeeks: baseInfo.totalWeeks || 20,
        };

        const configSuccess = await AndroidBridge.saveCourseConfig(JSON.stringify(configData));
        
        if (!configSuccess) {
            AndroidBridge.showToast("学期保存失败");
            return false;
        }

        // 2. 保存时间段 (节次时间表
        const slotSuccess = await AndroidBridge.savePresetTimeSlots(JSON.stringify(baseInfo.cleanSections));
        if (!slotSuccess) return false;

        // 3. 保存课程数据
        const saveResult = await AndroidBridge.saveImportedCourses(JSON.stringify(finalCourses));
        
        return saveResult;

    } catch (e) {
        console.error("保存流程崩溃:", e);
        AndroidBridge.showToast("导入过程发生意外");
        return false;
    }
}


/**
 * 保存配置 (日期和周数)
 */
async function saveConfig(baseInfo) {
    const configData = {
        semesterStartDate: baseInfo.startDate,
        semesterTotalWeeks: baseInfo.totalWeeks || 20,

    };
    try {
        const configSuccess = await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(configData));
        if (configSuccess) {
            return true;
        }
        return false;
    } catch (error) {
        AndroidBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}


/**
 * 主导入流
 */
async function runImportFlow() {
    try {
        // 1. 前置确认
        const isReady = await promptUserToStart();
        if (!isReady) return;

        // 2. 抓取所有必要数据
        const dataBundle = await fetchAllRawData();
        if (!dataBundle) return;

        // 3. 解析原始数据
        const finalCourses = parseAllCourses(dataBundle.rawArrangedList);
        if (finalCourses.length === 0) {
            AndroidBridge.showToast("解析失败：未能提取到有效课程");
            return;
        }

        // 4. 保存配置数据 (存日期、周数)
        const configSaveResult = await saveConfig(dataBundle.baseInfo);
        if (!configSaveResult) return;

        //时间段保存
        try {
            const slotJson = JSON.stringify(dataBundle.baseInfo.cleanSections);
            console.log("写入时间段数据:", slotJson);
            await window.AndroidBridgePromise.savePresetTimeSlots(slotJson);
        } catch (e) {
            console.error("时间段写入失败:", e);
            // 这里可以选择跳过或报错
        }

        // 5. 课程数据保存
        const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        if (!saveResult) {
            AndroidBridge.showToast("课程数据保存失败");
            return;
        }

        // 6. 流程成功结束
        AndroidBridge.showToast("Hi ~  课表导入成功！");
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("主流程异常:", error);
        AndroidBridge.showToast("意外错误: " + error.message);
    }
}

// 启动导入流程
runImportFlow();