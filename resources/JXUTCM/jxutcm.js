/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 江西中医药大学教务（jiaowu.jxutcm.edu.cn）轻屿课表适配脚本
// 教务平台：乘方新教务（广州乘方科技 CFKJ，前端套件 ntss / entss / lulu；/new/ 路径 + easyui，页面以 .page 结尾）
// 数据来源：POST /new/student/xsgrkb/getCalendarWeekDatas（一次性返回整学期课程 JSON，按 xnxqdm 切换学期）
// 学期/作息：GET /new/xlxx/getDatesOfWeek?xnxqdm=&zc=（逐周返回 7 天日期，用于开学日期和总周数）
// 解析逻辑参考本仓库 resources/CMC/cmc_01.js（同平台），按本校实测字段重写，差异：
//   1. 星期字段 qsxq 是「周日=1、周一=2 … 周六=7」，与课表页 getDay() 的换行逻辑一致；
//      而校历接口 getDatesOfWeek 的 xqmc 是「周一=1」，两套编号不能混用（用错会整体错一天）
//   2. 节次作息实测为 40 分钟/节 + 课间 10 分钟，并按本次课表数据分上午/下午/晚间三段校准，
//      换校区导致的作息平移不必改脚本（校准结果不成立时退回兜底作息，逐条改按自定义时间导入）
//   3. 场地按 jxcdmc2 的「场地-周次」逐周拆分，一门课中途换教室不会被合并错
// 非该校在校开发者适配，出现问题请提交 issue 或 PR

(function () {
  "use strict";

  var SCHOOL_NAME = "江西中医药大学";
  var WEEK_PAGE_URL = "/new/student/xsgrkb/week.page";
  var TIMETABLE_API = "/new/student/xsgrkb/getCalendarWeekDatas";
  var WEEK_DATES_API = "/new/xlxx/getDatesOfWeek";

  var DEFAULT_TOTAL_WEEKS = 19; // 兜底总周数：2026-2027-1 校历 2026-08-31 ~ 2027-01-10 共 19 周
  var MAX_TOTAL_WEEKS = 30; // 校历探测上限，防止死循环
  var SECTION_MINUTES = 40; // 实测 01-02 节 08:00-09:30
  var BREAK_MINUTES = 10;

  // 兜底作息（本校当前校区实测反推：上午 08:00 起，下午 14:30 起，晚间 18:30 起）
  var FALLBACK_SLOT_TIMES = [
    ["08:00", "08:40"], ["08:50", "09:30"], ["09:40", "10:20"], ["10:30", "11:10"], ["11:20", "12:00"],
    ["14:30", "15:10"], ["15:20", "16:00"], ["16:10", "16:50"], ["17:00", "17:40"],
    ["18:30", "19:10"], ["19:20", "20:00"], ["20:10", "20:50"], ["21:00", "21:40"], ["21:50", "22:30"]
  ];
  // 上午 1-5 节、下午 6-9 节、晚间 10-14 节之间有大段休息，作息按这三段分别校准
  var SLOT_BLOCKS = [[1, 5], [6, 9], [10, 14]];

  // ===== 时间工具 =====
  function toMinutes(hhmm) {
    var parts = String(hhmm || "").split(":");
    var hour = parseInt(parts[0], 10);
    var minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute)) return null;
    return hour * 60 + minute;
  }

  function toHHMM(minutes) {
    var hour = Math.floor(minutes / 60);
    var minute = minutes % 60;
    return (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") + minute;
  }

  // ===== 周次解析 =====
  // "6,3,2" / "1-16" / "1-8,10-16" / "1-16单周" → 去重升序周次数组
  function expandWeeks(text) {
    var weeks = [];
    String(text || "").split(/[,，;；\s]+/).forEach(function (raw) {
      var part = raw.trim();
      if (!part) return;
      var oddOnly = part.indexOf("单") >= 0;
      var evenOnly = part.indexOf("双") >= 0;
      var digits = part.replace(/[^\d-]/g, "");
      if (!digits) return;
      var bounds = digits.split("-").filter(function (item) { return item !== ""; });
      if (bounds.length === 1) {
        var single = parseInt(bounds[0], 10);
        if (single > 0 && weeks.indexOf(single) < 0) weeks.push(single);
        return;
      }
      var start = parseInt(bounds[0], 10);
      var end = parseInt(bounds[1], 10);
      if (isNaN(start) || isNaN(end)) return;
      if (start > end) {
        var swap = start;
        start = end;
        end = swap;
      }
      for (var week = start; week <= end; week += 1) {
        if (oddOnly && week % 2 === 0) continue;
        if (evenOnly && week % 2 === 1) continue;
        if (weeks.indexOf(week) < 0) weeks.push(week);
      }
    });
    return weeks.sort(function (a, b) { return a - b; });
  }

  // ===== 场地解析 =====
  // jxcdmc2 形如 "阳明楼0303-6,阳明楼0101-3"：场地名本身可能带 "-"（如 "致远楼3407-3408-7"），
  // 所以只从末尾的 "-周次" 处切分，返回 场地 → 周次数组
  function parseVenueWeeks(text) {
    var map = {};
    var order = [];
    String(text || "").split(/[,，]/).forEach(function (raw) {
      var part = raw.trim();
      var matched = part.match(/^(.*)-(\d+)$/);
      if (!matched) return;
      var position = matched[1].trim();
      var week = parseInt(matched[2], 10);
      if (!position || !week || week < 1) return;
      if (!map[position]) {
        map[position] = [];
        order.push(position);
      }
      if (map[position].indexOf(week) < 0) map[position].push(week);
    });
    return order.map(function (position) {
      return { position: position, weeks: map[position] };
    });
  }

  // ===== 星期解析 =====
  // 课表页以 var firstDay = "1"/"0" 决定一周从周一还是周日排起（getDay 内部用 switch 换列），
  // qsxq 本身固定是「周日=1 … 周六=7」，这里按站点同一套规则换算成 App 的「周一=1 … 周日=7」
  function parseFirstDay(htmlText) {
    var matched = String(htmlText || "").match(/var\s+firstDay\s*=\s*["']?([01])["']?/);
    return matched ? matched[1] : "1";
  }

  function resolveDay(qsxq, firstDay) {
    var weekday = parseInt(qsxq, 10);
    if (isNaN(weekday) || weekday < 1 || weekday > 7) return NaN;
    // 周一打头时 qsxq 1..7 对应的列序号是 6,0,1,2,3,4,5；周日打头时是 0..6
    var offset = firstDay === "0" ? weekday - 1 : (weekday + 5) % 7;
    if (firstDay === "0") return offset === 0 ? 7 : offset;
    return offset + 1;
  }

  // 教师字段带 "[主讲]" 一类标记，且会重复出现同一位老师，清标记并去重
  function cleanTeacher(raw) {    var seen = [];
    String(raw || "").split(/[,，、]/).forEach(function (item) {
      var name = item.replace(/\[[^\]]*\]/g, "").trim();
      if (name && seen.indexOf(name) < 0) seen.push(name);
    });
    return seen.join(",") || "未知";
  }

  // jxcdmc2 缺失时的场地兜底：取 jxcdmc 第一项，bapjxcd=1 表示不用场地
  function primaryPosition(item) {
    var first = String(item.jxcdmc || "").split(/[,，]/)[0].trim();
    if (first) return first;
    if (String(item.bapjxcd || "") === "1") return "不用场地";
    return "待定";
  }

  // ===== 作息 =====
  // 用本次课表的真实上下课时间校准兜底作息：每段取「课表起始时间 - 兜底起始时间」的众数做整体平移，
  // 平移不足该段半数数据则不采用，避免个别调课把整段作息带跑偏
  function deriveTimeSlots(rows) {
    var slots = FALLBACK_SLOT_TIMES.map(function (times, index) {
      return { number: index + 1, start: toMinutes(times[0]), end: toMinutes(times[1]) };
    });
    var slotByNumber = {};
    slots.forEach(function (slot) { slotByNumber[slot.number] = slot; });

    SLOT_BLOCKS.forEach(function (block) {
      var counter = {};
      var total = 0;
      rows.forEach(function (item) {
        var number = parseInt(item.ps, 10);
        if (isNaN(number) || number < block[0] || number > block[1]) return;
        var slot = slotByNumber[number];
        var actual = toMinutes(String(item.qssj || "").slice(0, 5));
        if (!slot || actual === null) return;
        var delta = actual - slot.start;
        if (Math.abs(delta) > 180) return; // 明显异常的时间不参与校准
        counter[delta] = (counter[delta] || 0) + 1;
        total += 1;
      });
      if (!total) return;
      var bestDelta = 0;
      var bestCount = 0;
      Object.keys(counter).forEach(function (key) {
        var count = counter[key];
        if (count > bestCount) {
          bestCount = count;
          bestDelta = parseInt(key, 10);
        }
      });
      if (!bestDelta || bestCount * 2 < total) return;
      for (var number = block[0]; number <= block[1]; number += 1) {
        slotByNumber[number].start += bestDelta;
        slotByNumber[number].end += bestDelta;
      }
    });

    return slots.map(function (slot) {
      return { number: slot.number, startTime: toHHMM(slot.start), endTime: toHHMM(slot.end) };
    });
  }

  // ===== 课程解析 =====
  function parseCourses(rows, timeSlots, firstDay) {
    var slotByNumber = {};
    timeSlots.forEach(function (slot) { slotByNumber[slot.number] = slot; });

    var courses = [];
    var seen = {};

    rows.forEach(function (item) {
      var name = String(item.kcmc || "").trim();
      var day = resolveDay(item.qsxq, firstDay); // qsxq 周日=1，需按 firstDay 换算成周一=1
      var startSection = parseInt(item.ps, 10);
      var endSection = parseInt(item.pe, 10);
      var allWeeks = expandWeeks(item.zc);
      if (!name || !allWeeks.length) return;
      if (isNaN(day) || day < 1 || day > 7) return;
      if (isNaN(startSection) || isNaN(endSection) || startSection < 1 || endSection < startSection) return;

      var teacher = cleanTeacher(item.teaxms || item.pkr);
      var startTime = String(item.qssj || "").slice(0, 5);
      var endTime = String(item.jssj || "").slice(0, 5);
      var startSlot = slotByNumber[startSection];
      var endSlot = slotByNumber[endSection];
      var gridMatched = !!(startSlot && endSlot && startSlot.startTime === startTime && endSlot.endTime === endTime);

      // 场地按周拆：jxcdmc2 覆盖到的周次用对应场地，没覆盖到的周次兜底给主场地，避免漏周
      var venues = parseVenueWeeks(item.jxcdmc2);
      var entries = [];
      var covered = [];
      venues.forEach(function (venue) {
        var weeks = venue.weeks.filter(function (week) { return allWeeks.indexOf(week) >= 0; });
        if (!weeks.length) return;
        weeks.forEach(function (week) { covered.push(week); });
        entries.push({ position: venue.position, weeks: weeks.sort(function (a, b) { return a - b; }) });
      });
      var leftover = allWeeks.filter(function (week) { return covered.indexOf(week) < 0; });
      if (leftover.length) entries.push({ position: primaryPosition(item), weeks: leftover });
      if (!entries.length) entries.push({ position: primaryPosition(item), weeks: allWeeks });

      entries.forEach(function (entry) {
        var course = {
          name: name,
          teacher: teacher,
          position: entry.position,
          day: day,
          weeks: entry.weeks
        };
        if (gridMatched) {
          course.startSection = startSection;
          course.endSection = endSection;
        } else if (startTime && endTime) {
          course.isCustomTime = true;
          course.customStartTime = startTime;
          course.customEndTime = endTime;
        } else {
          course.startSection = startSection;
          course.endSection = endSection;
        }

        var key = [
          course.name, course.teacher, course.position, course.day,
          course.isCustomTime ? "T" : course.startSection + "-" + course.endSection,
          course.isCustomTime ? course.customStartTime + "-" + course.customEndTime : "",
          entry.weeks.join(",")
        ].join("|");
        if (seen[key]) return;
        seen[key] = true;
        courses.push(course);
      });
    });

    return courses.sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      var aSection = a.startSection || 0;
      var bSection = b.startSection || 0;
      if (aSection !== bSection) return aSection - bSection;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  // ===== 网络请求（复用当前已登录会话）=====
  async function requestText(url, options) {
    var resp = await fetch(url, Object.assign({ credentials: "include" }, options || {}));
    if (!resp.ok) throw new Error("请求失败（HTTP " + resp.status + "）：" + url);
    var text = await resp.text();
    // 会话失效时教务会返回 200 + 跳登录页的脚本
    if (/location\.href\s*=\s*['"][^'"]*(login|cas)/i.test(text.slice(0, 2000))) {
      throw new Error("教务会话已失效，请刷新页面重新登录后再导入");
    }
    return text;
  }

  function postForm(url, params) {
    return requestText(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams(params).toString()
    });
  }

  // ===== 学期列表 =====
  function extractSemesters(htmlText) {
    var doc = new DOMParser().parseFromString(htmlText, "text/html");
    var select = doc.getElementById("xnxqdm");
    if (!select) return null;

    var labels = [];
    var values = [];
    var selectedIndex = 0;
    Array.from(select.options).forEach(function (option) {
      var value = String(option.value || "").trim();
      if (!/^\d{5,6}$/.test(value)) return; // 同页还有周次下拉，value 是动态拼接的
      if (option.selected || option.hasAttribute("selected")) selectedIndex = labels.length;
      labels.push(String(option.textContent || "").trim());
      values.push(value);
    });
    if (!labels.length) return null;

    // 学期下拉按学年倒序排列、默认选中当前学期：往前多给几个上一学期，往后留少量下一学期
    var start = Math.max(0, selectedIndex - 3);
    var end = Math.min(labels.length, selectedIndex + 9);
    return {
      labels: labels.slice(start, end),
      values: values.slice(start, end),
      defaultIndex: selectedIndex - start
    };
  }

  async function pickSemester(semesters) {
    var bridgePromise = window.shiguangBridgePromise;
    var fallback = {
      label: semesters.labels[semesters.defaultIndex],
      value: semesters.values[semesters.defaultIndex]
    };
    if (semesters.labels.length <= 1 || !bridgePromise || typeof bridgePromise.showSingleSelection !== "function") {
      return fallback;
    }
    var choice = await bridgePromise.showSingleSelection(
      "选择要导入的学期",
      JSON.stringify(semesters.labels),
      semesters.defaultIndex
    );
    if (choice === null || choice === undefined || choice < 0 || choice >= semesters.labels.length) return null;
    return { label: semesters.labels[choice], value: semesters.values[choice] };
  }

  // ===== 课表数据 =====
  // d1/d2 覆盖整个学年（秋 8 月到次年 8 月），换学期只改 xnxqdm，春季学期同样能取到
  async function fetchCourseRows(xnxqdm) {
    var year = parseInt(String(xnxqdm).slice(0, 4), 10) || new Date().getFullYear();
    var text = await postForm(TIMETABLE_API, {
      d1: year + "-08-01 00:00:00",
      d2: (year + 1) + "-08-31 23:59:59",
      zc: "",
      szxqdm: "",
      xnxqdm: String(xnxqdm),
      yxdm: ""
    });
    var json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error("课表接口返回格式异常，请刷新页面重新登录后再试");
    }
    if (!json || json.code !== 0) {
      throw new Error((json && json.message) || "未知原因");
    }
    return Array.isArray(json.data) ? json.data : [];
  }

  async function fetchWeekDates(xnxqdm, zc) {
    var text = await requestText(
      WEEK_DATES_API + "?xnxqdm=" + encodeURIComponent(xnxqdm) + "&zc=" + encodeURIComponent(zc),
      { headers: { "X-Requested-With": "XMLHttpRequest" } }
    );
    try {
      var dates = JSON.parse(text);
      return Array.isArray(dates) ? dates : [];
    } catch (error) {
      return [];
    }
  }

  // 校历接口逐周返回日期：第 1 周取开学日期，周次按二分找上限（超出学期返回空数组）
  async function detectSemesterCalendar(xnxqdm) {
    var calendar = { startDate: null, totalWeeks: 0 };
    var low = 1;
    var high = MAX_TOTAL_WEEKS;
    while (low <= high) {
      var mid = (low + high) >> 1;
      var weekDates = [];
      try {
        weekDates = await fetchWeekDates(xnxqdm, mid);
      } catch (error) {
        weekDates = [];
      }
      if (weekDates.length) {
        calendar.totalWeeks = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    try {
      var firstWeek = await fetchWeekDates(xnxqdm, 1);
      var monday = null;
      firstWeek.forEach(function (item) {
        if (!monday && String(item.xqmc) === "1") monday = item;
      });
      if (!monday) monday = firstWeek[0];
      if (monday && /^\d{4}-\d{2}-\d{2}$/.test(String(monday.rq))) {
        calendar.startDate = String(monday.rq);
      }
    } catch (error) {
      // 拿不到就交给 App 端的课表设置
    }
    return calendar;
  }

  // ===== 主流程 =====
  async function runImportFlow() {
    var bridge = window.shiguangBridge;
    var bridgePromise = window.shiguangBridgePromise;
    if (!bridge || !bridgePromise) throw new Error("请在轻屿课表 App 内运行本导入脚本");

    var confirmed = await bridgePromise.showAlert(
      SCHOOL_NAME + "教务导入",
      "将读取教务系统「我的课表」整学期数据并导入轻屿课表。\n" +
        "请确认已在当前窗口登录教务系统。\n\n" +
        "导入内容：课程安排 + 节次作息模板 + 学期配置（开学日期、总周数）。",
      "确认已登录"
    );
    if (!confirmed) {
      bridge.showToast("导入已取消");
      return;
    }

    bridge.showToast("正在读取学期列表...");
    var weekPageHtml = await requestText(WEEK_PAGE_URL, { headers: { "X-Requested-With": "XMLHttpRequest" } });
    var semesters = extractSemesters(weekPageHtml);
    if (!semesters) throw new Error("未找到学期列表，请确认已登录教务系统");
    var firstDay = parseFirstDay(weekPageHtml);

    var semester = await pickSemester(semesters);
    if (!semester) {
      bridge.showToast("已取消导入");
      return;
    }

    bridge.showToast("正在获取 " + semester.label + " 课表...");
    var rows;
    try {
      rows = await fetchCourseRows(semester.value);
    } catch (error) {
      throw new Error("读取「" + semester.label + "」课表失败：" + ((error && error.message) || "未知原因"));
    }
    if (!rows.length) {
      await bridgePromise.showAlert(
        "未获取到课程",
        "教务系统在「" + semester.label + "」没有返回课程数据。\n请确认该学期有课、且登录状态仍有效。",
        "知道了"
      );
      return;
    }

    var timeSlots = deriveTimeSlots(rows);
    var courses = parseCourses(rows, timeSlots, firstDay);
    if (!courses.length) {
      await bridgePromise.showAlert("未解析到课程", "课表数据解析结果为空，请把本页控制台输出反馈给适配作者。", "知道了");
      return;
    }

    var calendar = await detectSemesterCalendar(semester.value);
    var totalWeeks = calendar.totalWeeks || DEFAULT_TOTAL_WEEKS;
    var maxWeek = courses.reduce(function (max, course) {
      var courseMax = course.weeks[course.weeks.length - 1] || 0;
      return courseMax > max ? courseMax : max;
    }, 0);
    var summary = [
      "学期：" + semester.label,
      "课程：" + courses.length + " 条（覆盖第 1 ~ " + maxWeek + " 周，学期共 " + totalWeeks + " 周）",
      "作息：" + timeSlots.length + " 节，每节 " + SECTION_MINUTES + " 分钟、课间 " + BREAK_MINUTES + " 分钟",
      calendar.startDate ? "开学日期：" + calendar.startDate : "开学日期：未取到，导入后请在课表设置里确认"
    ].join("\n");
    var accepted = await bridgePromise.showAlert("导入确认", summary + "\n\n将写入并覆盖当前课表配置，是否继续？", "确认导入");
    if (!accepted) {
      bridge.showToast("已取消导入");
      return;
    }

    bridge.showToast("正在写入课程...");
    await bridgePromise.saveImportedCourses(JSON.stringify(courses));

    try {
      var slotsSaved = await bridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
      if (slotsSaved === false) bridge.showToast("课程已导入，但节次作息模板写入失败");
    } catch (error) {
      bridge.showToast("课程已导入，但节次作息模板写入失败：" + error.message);
    }

    var config = {
      semesterTotalWeeks: totalWeeks,
      firstDayOfWeek: parseInt(firstDay, 10),
      defaultClassDuration: SECTION_MINUTES,
      defaultBreakDuration: BREAK_MINUTES
    };
    if (calendar.startDate) config.semesterStartDate = calendar.startDate;
    try {
      var configSaved = await bridgePromise.saveCourseConfig(JSON.stringify(config));
      if (configSaved === false) bridge.showToast("课程已导入，但学期配置写入失败");
    } catch (error) {
      bridge.showToast("课程已导入，但学期配置写入失败：" + error.message);
    }

    bridge.showToast("导入成功：共 " + courses.length + " 条课程");
    bridge.notifyTaskCompletion();
  }

  runImportFlow().catch(function (error) {
    var message = (error && error.message) || String(error);
    if (window.shiguangBridgePromise) {
      window.shiguangBridgePromise.showAlert("导入未完成", message, "知道了").catch(function () {});
    }
    if (window.shiguangBridge) window.shiguangBridge.showToast("导入失败：" + message);
    else console.error("[JXUTCM] 导入失败", error);
  });
})();
