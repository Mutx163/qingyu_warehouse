/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 湖北理工学院（jwglnew.hbpu.edu.cn）轻屿课表适配脚本
// 教务平台：正方教务 V9（前端 zftal-ui-v5-1.0.2），根路径部署
// 数据来源：
//   POST /kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508      课程数据（kbList）
//   POST /kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154  校历（开学日期 / 总周数）
//   POST /kbcx/xskbcx_cxRjc.html?gnmkdm=N2151           节次作息
// 解析逻辑参考本仓库 SCNU（华南师范大学）适配，按 HBPU 实测字段重写
// 非该校在校开发者适配，出现问题请提交 issue 或 PR
(async function () {
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    if (!bridge || !native) throw new Error('请通过轻屿课表或适配测试器运行此脚本。');
    if (window.__hbpuImportRunning) {
        native.showToast('湖北理工课表正在导入，请勿重复点击。');
        return;
    }
    window.__hbpuImportRunning = true;
    let saving = false;

    // 本脚本只使用原生安全的写法：用 replace 实现 trim，不用 filter/some/every 做数组过滤。
    const text = value => String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');

    // 整段匹配，遇到未知格式就停止，避免部分解析造成漏课或多排课。
    function parseNumbers(value, unit, limit, allowParity) {
        const normalized = text(value).replace(/\s/g, '').replace(/，|、/g, ',')
            .replace(/（/g, '(').replace(/）/g, ')');
        const numbers = new Set();
        for (const part of normalized.split(',')) {
            // 教务可能返回「第8周」这种带前缀的写法（调课/补课单独成条），统一去掉「第」再匹配。
            const match = part.replace(/^第/, '')
                .match(/^(\d+)(?:-(\d+))?(?:周|节)?(?:\(([单双])(?:周)?\))?$/);
            if (!match || (match[3] && !allowParity) || (unit === '周' ? part.includes('节') : part.includes('周'))) {
                throw new Error(`无法识别${unit}次：${value}`);
            }
            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);
            if (start < 1 || end < start || end > limit) throw new Error(`${unit}次范围无效：${value}`);
            for (let n = start; n <= end; n++) {
                if (match[3] === '单' && n % 2 === 0) continue;
                if (match[3] === '双' && n % 2 !== 0) continue;
                numbers.add(n);
            }
        }
        if (!numbers.size) throw new Error(`${unit}次为空：${value}`);
        return [...numbers].sort((a, b) => a - b);
    }

    function parseCourses(rows) {
        const entries = [];
        for (const raw of rows) {
            const name = text(raw.kcmc);
            try {
                const day = Number(raw.xqj);
                if (!name || !Number.isInteger(day) || day < 1 || day > 7) throw new Error('缺少课程名称或有效星期');
                const campusId = text(raw.xqh_id) || '1';
                const weeks = parseNumbers(raw.zcd, '周', 100, true);
                const sections = parseNumbers(raw.jcs, '节', 30, false);
                // 教务返回的修读类型已是中文（理论/实验/实践），非理论课时补进课程名，
                // 因为当前 App 的此导入路径不保存 remark。
                const type = text(raw.xslxbj);
                const courseName = type && type !== '理论' && !name.includes(type) ? `${name}（${type}）` : name;
                for (let i = 0; i < sections.length; i++) {
                    const startSection = sections[i];
                    while (i + 1 < sections.length && sections[i + 1] === sections[i] + 1) i++;
                    entries.push({
                        campusId,
                        campusName: text(raw.xqmc) || campusId,
                        course: {
                            name: courseName,
                            teacher: text(raw.xm),
                            position: text(raw.cdmc),
                            day, startSection, endSection: sections[i], weeks
                        }
                    });
                }
            } catch (error) {
                throw new Error(`${name || '未命名课程'}：${error.message}`);
            }
        }
        return entries;
    }

    function parseTimeSlots(rows) {
        if (!Array.isArray(rows) || !rows.length) throw new Error('没有取得节次作息时间');
        const slots = rows.map(row => ({
            number: Number(row.jcmc), startTime: text(row.qssj), endTime: text(row.jssj)
        })).sort((a, b) => a.number - b.number);
        let previousEnd = '';
        slots.forEach((slot, index) => {
            const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
            if (slot.number !== index + 1 || !validTime(slot.startTime) || !validTime(slot.endTime)
                || slot.startTime >= slot.endTime || slot.startTime < previousEnd) {
                throw new Error('节次作息时间格式无效、节次不连续或时间重叠');
            }
            previousEnd = slot.endTime;
        });
        return slots;
    }

    // 校历接口返回每周的起止日期，可推导开学日期、总周数与每周起始日。
    function parseWeekCalendar(rows) {
        if (!Array.isArray(rows) || !rows.length) throw new Error('没有取得学期周次校历');
        const weeks = rows.map(row => {
            const number = Number(row.zs);
            const start = text(row.rq).split('/')[0];
            if (!Number.isInteger(number) || number < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
                throw new Error('学期周次校历格式无效');
            }
            const date = new Date(`${start}T00:00:00Z`);
            if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start) {
                throw new Error(`学期周次校历包含无效日期：${start}`);
            }
            return { number, start };
        }).sort((a, b) => a.number - b.number);
        weeks.forEach((week, index) => {
            if (week.number !== index + 1) throw new Error('学期周次校历的周次不连续');
        });
        // App 的 firstDayOfWeek 约定为 ISO 星期（1=周一 … 7=周日），由开学日当天推算。
        const firstDayOfWeek = (new Date(`${weeks[0].start}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
        return { startDate: weeks[0].start, totalWeeks: weeks.length, firstDayOfWeek };
    }

    function toMinutes(value) {
        const [hours, minutes] = value.split(':').map(Number);
        return hours * 60 + minutes;
    }

    // 同一课程可能被教务拆成多条记录（如 1-8周 与 9-16周、1-2节 与 3-4节），做两阶段合并：
    // 先并相接/重复的节次，再并同节次的周次，减少课表里的重复卡片。
    // 判等键包含自定义时间，作息不同的记录不会被错误合并。
    function mergeCourses(courses) {
        if (courses.length <= 1) return courses;
        const keyOf = c => [c.name, c.teacher, c.position, c.day,
            c.isCustomTime ? `${c.customStartTime}-${c.customEndTime}` : ''].join('\u0001');
        const compareKey = (a, b) => {
            const ka = keyOf(a), kb = keyOf(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        };
        const compareText = (x, y) => x < y ? -1 : x > y ? 1 : 0;
        const byStart = [...courses].sort((a, b) => compareKey(a, b)
            || compareText(a.weeks.join(','), b.weeks.join(','))
            || a.startSection - b.startSection);
        const step1 = [];
        for (const c of byStart) {
            const prev = step1[step1.length - 1];
            if (prev && compareKey(prev, c) === 0 && prev.weeks.join(',') === c.weeks.join(',')
                && c.startSection <= prev.endSection + 1) {
                if (c.endSection > prev.endSection) prev.endSection = c.endSection;
                continue;
            }
            step1.push({ ...c, weeks: [...c.weeks] });
        }
        step1.sort((a, b) => compareKey(a, b) || a.startSection - b.startSection || a.endSection - b.endSection);
        const step2 = [];
        for (const c of step1) {
            const prev = step2[step2.length - 1];
            if (prev && compareKey(prev, c) === 0
                && prev.startSection === c.startSection && prev.endSection === c.endSection) {
                prev.weeks = [...new Set([...prev.weeks, ...c.weeks])].sort((a, b) => a - b);
                continue;
            }
            step2.push(c);
        }
        return step2;
    }

    // 学年学期选项由前端脚本渲染，服务端返回的 HTML 里没有这两个下拉框，
    // 因此直接从当前页面的 DOM 读取，读不到时按当前日期推算。
    function readDomOptions(selector) {
        const select = document.querySelector(selector);
        if (!select) return [];
        const options = [];
        for (const option of select.options) {
            if (!option.value) continue;
            options.push({
                value: option.value, label: text(option.textContent),
                selected: option.selected || option.hasAttribute('selected')
            });
        }
        return options;
    }

    function guessTerm() {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        // 正方学期代码：3=第一学期，12=第二学期，16=第三学期
        if (month >= 8) return { xnm: String(year), xqm: '3', xnmText: `${year}-${year + 1}`, xqmText: '1' };
        if (month === 1) return { xnm: String(year - 1), xqm: '3', xnmText: `${year - 1}-${year}`, xqmText: '1' };
        return { xnm: String(year - 1), xqm: '12', xnmText: `${year - 1}-${year}`, xqmText: '2' };
    }

    async function selectYearSemester() {
        const years = readDomOptions('#xnm');
        const semesters = readDomOptions('#xqm');
        if (!years.length || !semesters.length) {
            const guess = guessTerm();
            const proceed = await bridge.showAlert('确认导入学期',
                `未读取到学年学期选项，将按当前时间导入 ${guess.xnmText} 学年第 ${guess.xqmText} 学期。\n如需导入其他学期，请先打开教务系统的课表查询页再运行本脚本。`,
                '继续导入');
            return proceed ? guess : null;
        }
        const selectedYear = years.findIndex(o => o.selected);
        // 学年选项跨度通常很大，以当前学年为中心截取前后各两年，默认选中原学年。
        const start = Math.max(0, (selectedYear === -1 ? 0 : selectedYear) - 2);
        const yearChoices = years.slice(start, start + 5);
        const pickedYear = await bridge.showSingleSelection('选择学年', JSON.stringify(yearChoices.map(o => o.label)), selectedYear === -1 ? 0 : selectedYear - start);
        if (pickedYear === null || pickedYear === -1) return null;
        if (!Number.isInteger(pickedYear) || !yearChoices[pickedYear]) throw new Error('学年选择无效');
        const selectedSemester = semesters.findIndex(o => o.selected);
        const pickedSemester = await bridge.showSingleSelection('选择学期', JSON.stringify(semesters.map(o => `第 ${o.label} 学期`)), selectedSemester === -1 ? 0 : selectedSemester);
        if (pickedSemester === null || pickedSemester === -1) return null;
        if (!Number.isInteger(pickedSemester) || !semesters[pickedSemester]) throw new Error('学期选择无效');
        return {
            xnm: yearChoices[pickedYear].value, xnmText: yearChoices[pickedYear].label,
            xqm: semesters[pickedSemester].value, xqmText: semesters[pickedSemester].label
        };
    }

    async function requestJson(path, params, gnmkdm) {
        const url = path + (gnmkdm ? `?gnmkdm=${gnmkdm}` : '');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(url, {
                method: 'POST', credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: new URLSearchParams(params).toString(), signal: controller.signal
            });
            if (!response.ok) throw new Error(`教务请求失败（HTTP ${response.status}）`);
            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error('教务系统没有返回 JSON，请确认登录未过期后重试');
            }
            if (!data || typeof data !== 'object') throw new Error('教务系统未返回有效数据，请检查登录状态及查询权限');
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('教务请求超时，请稍后重试');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async function save(method, value) {
        const result = await bridge[method](JSON.stringify(value));
        if (result !== true) throw new Error(`${method} 未确认保存成功`);
    }

    try {
        if (!/(^|\.)hbpu\.edu\.cn$/i.test(window.location.hostname)) {
            throw new Error('请先登录湖北理工学院教务系统（jwglnew.hbpu.edu.cn），停留在教务系统内任意页面后再导入');
        }
        const selection = await selectYearSemester();
        if (!selection) return;
        const { xnm, xnmText, xqm, xqmText } = selection;
        if (!/^\d{4}$/.test(xnm) || !xqm) throw new Error('学年学期选项无效');
        native.showToast('正在获取湖北理工课表、节次作息与学期校历…');
        const data = await requestJson('/kbcx/xskbcx_cxXsgrkb.html', {
            xnm, xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
        }, 'N253508');
        if (!Array.isArray(data.kbList)) throw new Error('响应缺少课表数据，请确认登录未过期');
        if (data.sjkList != null && !Array.isArray(data.sjkList)) throw new Error('未排课数据格式异常');
        const other = (data.sjkList || []).map(c => text(`${text(c.kcmc) || '未命名课程'} ${text(c.qsjsz)}`));
        if (!data.kbList.length) {
            await bridge.showAlert('没有已排课程', ['所选学期没有可导入的已排课程，原课表未改动。', ...other].join('\n'), '确定');
            return;
        }
        const entries = parseCourses(data.kbList);
        const campuses = [...new Map(entries.map(e => [e.campusId, e.campusName])).entries()];
        // 节次作息与学期周次校历互不依赖，并行获取。
        const schedules = new Map();
        const fetchSchedule = async (id, name) => {
            try {
                schedules.set(id, parseTimeSlots(await requestJson('/kbcx/xskbcx_cxRjc.html', { xnm, xqm, xqh_id: id }, 'N2151')));
            } catch (error) {
                throw new Error(`${name}校区：${error.message}`);
            }
        };
        const fetchCalendar = async () => {
            try {
                return parseWeekCalendar(await requestJson('/kbcx/xskbcxZccx_cxZcByXnxq.html', { xnm, xqm }, 'N2154'));
            } catch (error) {
                throw new Error(`学期周次校历：${error.message}`);
            }
        };
        const [calendar] = await Promise.all([fetchCalendar(), ...campuses.map(([id, name]) => fetchSchedule(id, name))]);
        let presetIndex = 0;
        if (campuses.length > 1) {
            presetIndex = await bridge.showSingleSelection('默认作息校区', JSON.stringify(campuses.map(c => c[1])), 0);
            if (presetIndex === null || presetIndex === -1) return;
            if (!Number.isInteger(presetIndex) || !campuses[presetIndex]) throw new Error('校区选择无效');
        }
        const [presetCampus, presetName] = campuses[presetIndex];
        const timeSlots = schedules.get(presetCampus);
        const multiCampus = campuses.length > 1;
        const courses = entries.map(({ course, campusId, campusName }) => {
            const slots = schedules.get(campusId);
            const first = slots[course.startSection - 1];
            const last = slots[course.endSection - 1];
            if (!first || !last) throw new Error(`${course.name} 的节次超出作息范围`);
            const base = multiCampus ? { ...course, position: text(`${campusName} ${course.position}`) } : course;
            if (campusId !== presetCampus && JSON.stringify(slots) !== JSON.stringify(timeSlots)) {
                return { ...base, isCustomTime: true, customStartTime: first.startTime, customEndTime: last.endTime };
            }
            return base;
        });
        const merged = mergeCourses(courses);
        const config = {
            semesterStartDate: calendar.startDate,
            semesterTotalWeeks: calendar.totalWeeks,
            defaultClassDuration: toMinutes(timeSlots[0].endTime) - toMinutes(timeSlots[0].startTime),
            defaultBreakDuration: timeSlots.length > 1 ? toMinutes(timeSlots[1].startTime) - toMinutes(timeSlots[0].endTime) : 10,
            firstDayOfWeek: calendar.firstDayOfWeek
        };
        const summary = [
            `${xnmText} 学年第 ${xqmText} 学期`,
            `${merged.length} 条排课记录；作息：${presetName}（共 ${timeSlots.length} 节）。`,
            `开学日期：${calendar.startDate}，共 ${calendar.totalWeeks} 周。`,
            '将覆盖所选目标课表的课程、作息与学期配置'
        ];
        if (other.length) summary.push(`以下 ${other.length} 门课程未提供星期和节次，不会导入，请按实际安排手动添加：`, ...other);
        if (!await bridge.showAlert('确认导入湖北理工课表', summary.join('\n\n'), '确认导入')) return;

        // 三个 Bridge 保存操作彼此独立，失败后不能宣称已全部完成或已回滚。
        saving = true;
        await save('saveImportedCourses', merged);
        await save('savePresetTimeSlots', timeSlots);
        await save('saveCourseConfig', config);
        await bridge.showAlert('湖北理工课表导入完成', [
            `已导入 ${merged.length} 条排课记录及节次作息。`,
            `开学日期 ${calendar.startDate}，共 ${calendar.totalWeeks} 周，已写入课表配置。`,
            '课程周次已按教务系统返回的数据导入。'
        ].join('\n\n'), '确定');
        native.notifyTaskCompletion();
    } catch (error) {
        const suffix = saving ? '\n保存已经开始，目标课表可能已部分更新。请检查后重新导入。' : '\n尚未写入目标课表。';
        await bridge.showAlert('湖北理工课表导入失败', `${error.message}${suffix}`, '确定');
    } finally {
        delete window.__hbpuImportRunning;
    }
})();
