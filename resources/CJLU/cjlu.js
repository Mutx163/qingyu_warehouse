// 基于 HTML 页面抓取的拾光课表正方适配脚本
// 中国计量大学(cjlu.edu.cn)

/**
 * 解析表格
 */
function parserTbale() {
    const regexName = /[●★○]/g;
    const courseInfoList = [];
    const $ = window.jQuery;
    if (!$) return courseInfoList;

    $('#kbgrid_table_0 td').each((i, td) => {
        if ($(td).hasClass('td_wrap') && $(td).text().trim() !== '') {
            const day = parseInt($(td).attr('id').split('-')[0]);

            $(td).find('.timetable_con.text-left').each((i, course) => {
                const name = $(course).find('.title font').text().replace(regexName, '').trim();

                const infoStr = $(course).find('p').eq(0).find('font').eq(1).text().trim();

                const position = $(course).find('p').eq(1).find('font').text().trim();
                const teacher = $(course).find('p').eq(2).find('font').text().trim();

                if (infoStr && infoStr.match(/\((\d+-\d+节)\)/) && infoStr.split('节)')[1]) {
                    const [sections, weeks] = parserInfo(infoStr);

                    if (name && position && teacher && sections.length && weeks.length) {
                        const startSection = sections[0];
                        const endSection = sections[sections.length - 1];

                        const finalPosition = position.split(/\s+/).pop();

                        const data = { name, day, weeks, teacher, position: finalPosition, startSection, endSection };
                        courseInfoList.push(data);
                    }
                }
            });
        }
    });
    return courseInfoList;
}

/**
 * 解析列表
 */
function parserList() {
    const regexName = /[●★○]/g;
    const regexWeekNum = /周数：|周/g;
    const regexPosition = /上课地点：/g;
    const regexTeacher = /教师 ：/g;

    const $ = window.jQuery;
    if (!$) return [];

    let courseInfoList = [];
    $('#kblist_table tbody').each((day, tbody) => {
        if (day > 0 && day < 8) {
            let sections;
            $(tbody).find('tr:not(:first-child)').each((trIndex, tr) => {
                let name, font;

                if ($(tr).find('td').length > 1) {
                    sections = parserSections($(tr).find('td:first-child').text());
                    name = $(tr).find('td:nth-child(2)').find('.title').text().replace(regexName, '').trim();
                    font = $(tr).find('td:nth-child(2)').find('p font');
                } else {
                    name = $(tr).find('td').find('.title').text().replace(regexName, '').trim();
                    font = $(tr).find('td').find('p font');
                }

                const weekStr = $(font[0]).text().replace(regexWeekNum, '').trim();
                const weeks = parserWeeks(weekStr);

                const positionRaw = $(font[1]).text().replace(regexPosition, '').trim();
                const finalPosition = positionRaw.split(/\s+/).pop();

                const teacher = $(font[2]).text().replace(regexTeacher, '').trim();

                if (name && sections && weeks.length && teacher && finalPosition) {
                    const startSection = sections[0];
                    const endSection = sections[sections.length - 1];

                    const data = {
                        name,
                        day,
                        weeks,
                        teacher,
                        position: finalPosition,
                        startSection,
                        endSection
                    };
                    courseInfoList.push(data);
                }
            });
        }
    });
    return courseInfoList;
}

/**
 * 解析课程信息
 */
function parserInfo(str) {
    const sections = parserSections(str.match(/\((\d+-\d+节)\)/)[1].replace(/节/g, ''));
    const weekStrWithMarker = str.split('节)')[1];
    const weeks = parserWeeks(weekStrWithMarker.replace(/周/g, '').trim());
    return [sections, weeks];
}

/**
 * 解析节次
 */
function parserSections(str) {
    const [start, end] = str.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * 解析周次
 */
function parserWeeks(str) {
    const segments = str.split(',');
    let weeks = [];
    const segmentRegex = /(\d+)(?:-(\d+))?\s*(\([单双]\))?/g;

    for (const segment of segments) {
        const cleanSegment = segment.replace(/周/g, '').trim();

        segmentRegex.lastIndex = 0;

        let match;
        while ((match = segmentRegex.exec(cleanSegment)) !== null) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || '';

            let flag = 0;
            if (flagStr.includes('单')) {
                flag = 1;
            } else if (flagStr.includes('双')) {
                flag = 2;
            }

            for (let i = start; i <= end; i++) {
                if (flag === 1 && i % 2 !== 1) continue;
                if (flag === 2 && i % 2 !== 0) continue;

                if (!weeks.includes(i)) {
                    weeks.push(i);
                }
            }
        }
    }

    return weeks.sort((a, b) => a - b);
}

/**
 * 构建课表配置，从课程数据中推断最大周次
 */
function buildCourseConfig(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }
    return {
        semesterTotalWeeks: maxWeek || 20,
        firstDayOfWeek: 1
    };
}

/**
 * 抓取和解析课程数据
 */
async function scrapeAndParseCourses() {
    AndroidBridge.showToast("正在检查页面并抓取课程数据...");
    const ts = `1.登陆教务系统\n2.导航到学生课表查询页面\n3.等待课表信息加载，选择对应学年、学期，确认无误后点击【查询】\n4.确保页面上显示了课程表\n5.点击下方【一键导入】`;

    try {
        const response = await fetch(window.location.href);
        const text = await response.text();
        if (!text.includes("课表查询")) {
            await window.AndroidBridgePromise.showAlert("导入失败", "当前页面似乎不是学生课表查询页面。请检查：\n" + ts, "确定");
            return null;
        }
        const typeElement = document.querySelector('#shcPDF');
        if (!typeElement) {
            await window.AndroidBridgePromise.showAlert("导入失败", "未能识别课表视图类型，请确认您已点击查询且课表已加载完毕。", "确定");
            return null;
        }
        const type = typeElement.dataset['type'];
        const tableElement = document.querySelector(type === 'list' ? '#kblist_table' : '#kbgrid_table_0');
        if (!tableElement) {
            await window.AndroidBridgePromise.showAlert("导入失败", `未能找到课表主体 (${type} 视图)，请确认您已点击查询且课表已加载完毕。`, "确定");
            return null;
        }
        let result = [];
        if (type === 'list') {
            result = parserList();
        } else {
            result = parserTbale();
        }
        if (result.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }
        console.log(`JS: 课程数据解析成功，共找到 ${result.length} 门课程。`);
        const config = buildCourseConfig(result);
        return { courses: result, config: config };
    } catch (error) {
        AndroidBridge.showToast(`抓取或解析失败: ${error.message}`);
        console.error('JS: Scrape/Parse Error:', error);
        await window.AndroidBridgePromise.showAlert("抓取或解析失败", `发生错误：${error.message}。请重试或联系开发者。`, "确定");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    AndroidBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 中国计量大学作息时间表
const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:15", endTime: "16:00" },
    { number: 9, startTime: "16:05", endTime: "16:50" },
    { number: 10, startTime: "18:00", endTime: "18:45" },
    { number: 11, startTime: "18:50", endTime: "19:35" },
    { number: 12, startTime: "19:40", endTime: "20:25" }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        AndroidBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            AndroidBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.AndroidBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录中国计量大学教务系统，\n并处于课表查询页面且已点击查询。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        return;
    }

    if (typeof window.jQuery === 'undefined' && typeof $ === 'undefined') {
        const errorMsg = "当前教务系统页面似乎没有加载 jQuery 库。本脚本依赖 jQuery 进行 DOM 解析。";
        AndroidBridge.showToast(errorMsg);
        await window.AndroidBridgePromise.showAlert("导入失败", errorMsg + "\n请尝试刷新页面或使用其他导入方式。", "确定");
        console.error("JS: 缺少 jQuery 依赖，流程终止。");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (result === null) {
        return;
    }
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    try {
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        AndroidBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        AndroidBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }

    await importPresetTimeSlots(TimeSlots);

    AndroidBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();