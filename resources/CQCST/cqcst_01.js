async function runImportFlow() {
    // 兼容电脑端测试：如果在电脑浏览器里跑，模拟手机软件的弹窗和保存功能
    if (typeof window.AndroidBridgePromise === 'undefined') {
        window.AndroidBridgePromise = {
            showAlert: async () => true,
            saveImportedCourses: async (json) => {
                console.log("===============================");
                console.log("🎉 【解析成功】以下是整理好的课表数据：");
                console.table(JSON.parse(json)); 
                console.log("===============================");
                alert("抓取成功！请在 F12 控制台查看具体的课程数据格式。");
                return true;
            }
        };
        window.AndroidBridge = {
            showToast: (msg) => console.log("[系统提示] " + msg),
            notifyTaskCompletion: () => console.log("[流程结束] 任务已完成并通知APP")
        };
    }

    AndroidBridge.showToast("开始提取课表数据...");

    // 1. 定位课表所在的表格 (强智系统常见的表格ID是 kbtable)
    const table = document.getElementById('kbtable') || document.querySelector('.table_border') || document.querySelector('table');
    if (!table || !table.innerText.includes('星期')) {
        AndroidBridge.showToast("没找到课表！请确保您当前在“学期理论课表”页面。");
        return;
    }

    // 2. 弹窗与用户确认
    const alertConfirmed = await window.AndroidBridgePromise.showAlert(
        "强智教务解析",
        "已检测到课表页面，是否提取数据并导入？",
        "确认导入"
    );
    if (!alertConfirmed) return;

    try {
        let courses = [];
        let courseSet = new Set(); // 用来防止课程重复添加
        let rows = table.querySelectorAll('tr');
        
        // 匹配表头，确定每一列对应星期几
        let headerRow = rows[0];
        let dayMapping = {};
        let ths = headerRow.querySelectorAll('th, td');
        for (let i = 0; i < ths.length; i++) {
            let text = ths[i].innerText;
            if (text.includes('一')) dayMapping[i] = 1;
            else if (text.includes('二')) dayMapping[i] = 2;
            else if (text.includes('三')) dayMapping[i] = 3;
            else if (text.includes('四')) dayMapping[i] = 4;
            else if (text.includes('五')) dayMapping[i] = 5;
            else if (text.includes('六')) dayMapping[i] = 6;
            else if (text.includes('日')) dayMapping[i] = 7;
        }

        // 遍历课表每一行（跳过第一行的表头）
        for (let i = 1; i < rows.length; i++) {
            let cells = rows[i].querySelectorAll('td');
            for (let j = 0; j < cells.length; j++) {
                let cell = cells[j];
                let day = dayMapping[j];
                if (!day) continue; // 如果这列不是星期几（比如是左侧的“第一节”栏），就跳过

                // 提取单元格内的文字块（处理同一时间有两门课的情况）
                let blocks = [];
                let kbNodes = cell.querySelectorAll('.kbcontent');
                if (kbNodes.length > 0) {
                    kbNodes.forEach(n => {
                        if(n.innerText.trim()) blocks.push(n.innerText.trim());
                    });
                } else {
                    // 如果没有 class 为 kbcontent 的块，就靠 "-------" 分割线来切分
                    blocks = cell.innerText.split(/-{5,}/).map(t => t.trim()).filter(t => t);
                }

                for (let block of blocks) {
                    if (!block || block === ' ') continue;
                    
                    // 将一门课的文字按行打散（课程名、老师、周次、地点通常是换行或空格隔开的）
                    let lines = block.split(/\n/).map(l => l.trim()).filter(l => l);
                    if(lines.length < 4) {
                        lines = block.split(/\s+/).map(l => l.trim()).filter(l => l);
                    }
                    if (lines.length < 3) continue;

                    // 1. 提取课程名 (去掉后面的 [32][必修] 等字眼)
                    let name = lines[0].replace(/\[.*?\]/g, '').trim();
                    
                    // 2. 提取老师
                    let teacher = lines[1] || "未知";

                    // 3. 找时间规则行，例如 "14-15(全部)[01-02-03-04节]"
                    let timeRegex = /([\d\-,]+)(?:\((单|双|.*?)\))?.*?\[([\d\-]+)节\]/;
                    let timeLineIdx = lines.findIndex(l => timeRegex.test(l));
                    if (timeLineIdx === -1) continue;

                    let match = lines[timeLineIdx].match(timeRegex);
                    let weeksStr = match[1]; // 提取周数部分：14-15
                    let oddEven = match[2];  // 提取单双周：单 / 双
                    let sectionsStr = match[3]; // 提取节次部分：01-02-03-04

                    // 4. 提取上课地点 (通常在时间行的下一行)
                    let position = (timeLineIdx + 1 < lines.length) ? lines[timeLineIdx + 1] : "未知地点";

                    // 将 "1-4,6" 转换成具体的 [1,2,3,4,6] 数组
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

                    // 将 "01-02-03-04" 转换成开始和结束节次
                    let secParts = sectionsStr.split('-');
                    let startSection = parseInt(secParts[0]);
                    let endSection = parseInt(secParts[secParts.length - 1]);

                    // 去重：强智系统一节大课会占据好几行，生成唯一ID防止重复添加同一门课
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
            AndroidBridge.showToast("没有抓取到数据，可能当前表格为空。");
            return;
        }

        AndroidBridge.showToast(`提取成功，共发现 ${courses.length} 门课程，正在保存...`);
        
        // 3. 将数据提交给轻屿课表APP
        const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (saveResult) {
            AndroidBridge.showToast("导入大功告成！");
            AndroidBridge.notifyTaskCompletion(); // 通知APP关掉网页
        }

    } catch (error) {
        console.error("解析过程中发生错误:", error);
        AndroidBridge.showToast("解析出错啦: " + error.message);
    }
}

// 执行上面的全套流程
runImportFlow();