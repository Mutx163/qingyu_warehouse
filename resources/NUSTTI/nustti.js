/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 南京理工大学泰州科技学院(nustti.edu.cn) 轻屿课表适配脚本
// 教务平台：湖南强智科技教务系统（老版，路径 /jsxsd/，CAS 统一身份认证）
// 数据来源：学期理论课表 GET /jsxsd/xskb/xskb_list.do（服务端直出整学期 HTML，默认当前学期；
//          实测该校仅当前学期保留课表数据，历史学期为空表，故不提供学期选择）
// 学期元数据来源：教务主页 /jsxsd/framework/xsMain_new.jsp（"第N周</span>/M周" 与当前日期，
//          用于推导总周数与开学周一；取不到时回退默认值）
// 解析逻辑参考本仓库 HYNU（强智老版）与 MKU（作息推导），按 NUSTTI 实测 DOM 重写：
//   教师字段 title 为「老师」，周次(节次)形如 "3-18(周)[01-02节]"，一节课最多 3 连节
//   （[09-10-11节]），同一格子多条课程用 "-----" 分隔线连在同一 div 内
// 非该校在校开发者适配，出现问题请提交 issue 或 PR

// ===== 基础常量 =====
const NUSTTI_BASE_URL = "https://jwgl.nustti.edu.cn";
const NUSTTI_TIMETABLE_URL = NUSTTI_BASE_URL + "/jsxsd/xskb/xskb_list.do";
const NUSTTI_MAINPAGE_URL = NUSTTI_BASE_URL + "/jsxsd/framework/xsMain_new.jsp";
const NUSTTI_DEFAULT_TOTAL_WEEKS = 20;       // 总周数取不到时的兜底
const NUSTTI_SECTION_MINUTES = 45;           // 每小节课时长（分钟），按大节时间反推验证
const NUSTTI_BREAK_MINUTES = 10;             // 课间时长（分钟），按大节时间反推验证
const NUSTTI_FALLBACK_TIME_SLOTS = [         // 2026-2027-1 实测作息兜底：由课表页大节时间推导
  { number: 1, startTime: "08:00", endTime: "08:45" },
  { number: 2, startTime: "08:55", endTime: "09:40" },
  { number: 3, startTime: "09:55", endTime: "10:40" },
  { number: 4, startTime: "10:50", endTime: "11:35" },
  { number: 5, startTime: "14:00", endTime: "14:45" },
  { number: 6, startTime: "14:55", endTime: "15:40" },
  { number: 7, startTime: "15:55", endTime: "16:40" },
  { number: 8, startTime: "16:50", endTime: "17:35" },
  { number: 9, startTime: "19:00", endTime: "19:45" },
  { number: 10, startTime: "19:55", endTime: "20:40" },
  { number: 11, startTime: "20:50", endTime: "21:35" }
];

// ===== 周次与节次解析 =====

// 周次片段展开："1,3,5" / "1-16" / "2-3,5-13" → 去重排序数字数组；
// 括注含「单周/双周」时对展开结果按奇偶过滤（本校实测未见，防御性保留）。
function nusttiExpandWeeks(weekPart, parenNote) {
  const weeks = [];
  if (!weekPart) return weeks;
  weekPart.split(",").forEach(seg => {
    seg = seg.trim();
    if (!seg) return;
    if (seg.includes("-")) {
      const parts = seg.split("-");
      const s = parseInt(parts[0], 10);
      const e = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(s) && !isNaN(e)) {
        for (let i = s; i <= e; i++) weeks.push(i);
      }
    } else {
      const w = parseInt(seg, 10);
      if (!isNaN(w)) weeks.push(w);
    }
  });
  let result = [...new Set(weeks)].sort((a, b) => a - b);
  if (parenNote && parenNote.includes("单")) result = result.filter(w => w % 2 === 1);
  if (parenNote && parenNote.includes("双")) result = result.filter(w => w % 2 === 0);
  return result;
}

// 解析「周次(节次)」字段："3-18(周)[01-02节]" → { weeks, startSection, endSection }；
// 节次兼容 2 连节 [01-02节] 与 3 连节 [09-10-11节]。
function nusttiParseTimeText(timeText) {
  if (!timeText) return null;
  const out = { weeks: null, startSection: 0, endSection: 0 };
  const secMatch = timeText.match(/\[([0-9]+(?:[-，、][0-9]+)*)节\]/);
  if (secMatch) {
    const nums = secMatch[1].split(/[-，、]/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    if (nums.length) {
      out.startSection = nums[0];
      out.endSection = nums[nums.length - 1];
    }
  }
  const weekMatch = timeText.match(/^([^[(（]+)?\s*(?:[(（]([^)）]*)[)）])?/);
  if (weekMatch) {
    out.weeks = nusttiExpandWeeks(weekMatch[1] || "", weekMatch[2] || "");
  }
  if (!out.startSection) return null;
  return out;
}

// ===== 课表解析（HTML 表格） =====

// 解析行标签："1,2节 08:00-09:40" → { startSection, endSection, blockStart, blockEnd }；
// 只接受含「节」字样与起止时间的行，自动跳过表头与「备注」行。
function nusttiParseRowLabel(labelText) {
  if (!labelText) return null;
  const secMatch = labelText.match(/(\d+(?:\s*[,，]\s*\d+)*)\s*节/);
  const timeMatch = labelText.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
  if (!secMatch || !timeMatch) return null;
  const nums = secMatch[1].split(/[,，]/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
  if (!nums.length) return null;
  return {
    startSection: nums[0],
    endSection: nums[nums.length - 1],
    blockStart: nusttiTimeToMinutes(timeMatch[1]),
    blockEnd: nusttiTimeToMinutes(timeMatch[2])
  };
}

function nusttiTimeToMinutes(text) {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function nusttiMinutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? "0" + h : "" + h) + ":" + (m < 10 ? "0" + m : "" + m);
}

// 解析单个课程 div（同一 div 内多条课程用 "-----" 分隔线相连），返回课程条目数组
function nusttiParseCourseDiv(div) {
  const courses = [];
  const blocks = div.innerHTML.split(/-{5,}/);
  blocks.forEach(blockHtml => {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = blockHtml;
    if (tempDiv.innerHTML.replace(/&nbsp;|<br\s*\/?>/gi, "").trim() === "") return;

    // 课程名：第一个非空文本节点（跳过 <span><font color="red">P</font></span> 之类的标记）
    let name = "";
    for (let node of tempDiv.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim() !== "") {
        name = node.textContent.trim();
        break;
      }
      if (node.nodeType === 3) name += node.textContent.trim();
      else if (node.tagName === "BR" && name !== "") break;
    }

    const teacherEl = tempDiv.querySelector('font[title="老师"], font[title="教师"]');
    const teacher = teacherEl ? teacherEl.textContent.trim() : "未知教师";
    const weekEl = tempDiv.querySelector('font[title="周次(节次)"]');
    const positionEl = tempDiv.querySelector('font[title="教室"]');
    const position = positionEl ? positionEl.textContent.trim() : "未知地点";

    const timeInfo = nusttiParseTimeText(weekEl ? weekEl.textContent.trim() : "");
    // 周次或节次缺失则跳过，避免导入错误数据
    if (!name || !timeInfo || !timeInfo.weeks || !timeInfo.weeks.length) return;

    courses.push({
      name: name,
      teacher: teacher,
      position: position,
      weeks: timeInfo.weeks,
      startSection: timeInfo.startSection,
      endSection: timeInfo.endSection
    });
  });
  return courses;
}

// 解析课表文档：遍历 #kbtable 的行标签，从周一到周日的格子里取隐藏的完整版 div.kbcontent
function nusttiParseCourses(doc) {
  const table = doc.querySelector("#kbtable");
  const courses = [];
  const rowInfos = new Map();
  if (!table) return { courses, rowInfos };

  Array.from(table.rows).forEach(tr => {
    if (!tr.cells || tr.cells.length < 2) return;
    const rowInfo = nusttiParseRowLabel(tr.cells[0].textContent);
    if (!rowInfo) return;
    rowInfos.set(rowInfo.startSection, rowInfo);

    for (let day = 1; day <= 7; day++) {
      const cell = tr.cells[day];
      if (!cell) continue;
      Array.from(cell.querySelectorAll("div.kbcontent")).forEach(div => {
        nusttiParseCourseDiv(div).forEach(course => {
          // 教务直出的节次以课程自身标注为准，异常时回退行标签的大节范围
          if (!course.startSection) {
            course.startSection = rowInfo.startSection;
            course.endSection = rowInfo.endSection;
          }
          courses.push({ day: day, ...course });
        });
      });
    }
  });

  // 完全重复条目去重（同名/同师/同地/同天/同节次/同周次）
  const seen = new Set();
  const deduped = [];
  courses.forEach(c => {
    const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection, c.weeks.join(",")].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(c);
  });
  return { courses: deduped, rowInfos };
}

// 由课表页大节时间推导小节作息；大节时长与「45 分钟课 + 10 分钟课间」不符时回退实测兜底
function nusttiBuildTimeSlots(rowInfos) {
  const slots = [];
  const rows = [...rowInfos.values()].sort((a, b) => a.startSection - b.startSection);
  for (const info of rows) {
    if (info.blockStart == null || info.blockEnd == null) return NUSTTI_FALLBACK_TIME_SLOTS;
    const count = info.endSection - info.startSection + 1;
    const span = info.blockEnd - info.blockStart;
    if (span !== NUSTTI_SECTION_MINUTES * count + NUSTTI_BREAK_MINUTES * (count - 1)) {
      return NUSTTI_FALLBACK_TIME_SLOTS;
    }
    for (let i = 0; i < count; i++) {
      const start = info.blockStart + i * (NUSTTI_SECTION_MINUTES + NUSTTI_BREAK_MINUTES);
      slots.push({
        number: info.startSection + i,
        startTime: nusttiMinutesToTime(start),
        endTime: nusttiMinutesToTime(start + NUSTTI_SECTION_MINUTES)
      });
    }
  }
  return slots.length ? slots : NUSTTI_FALLBACK_TIME_SLOTS;
}

// ===== 教务数据获取 =====

// 拉取学期理论课表页面（GET 默认渲染当前学期）
async function nusttiFetchTimetableDoc() {
  const resp = await fetch(NUSTTI_TIMETABLE_URL, { credentials: "include" });
  if (!resp.ok) throw new Error("获取课表失败：HTTP " + resp.status);
  const text = await resp.text();
  // 会话失效识别：200 但 body 是登录跳转脚本
  if (/location\.(href|replace)\s*[=(]\s*['"][^'"]*(login|cas\/)/i.test(text.slice(0, 2000))) {
    throw new Error("教务会话已失效，请刷新页面重新登录后再试");
  }
  const doc = new DOMParser().parseFromString(text, "text/html");
  if (!doc.querySelector("#kbtable")) {
    throw new Error("未获取到课表数据，请确认已登录且当前学期有课");
  }
  return doc;
}

// 从教务主页提取学期元数据：总周数（"第N周</span>/M周"）与开学周一（当前日期所在周回推 N-1 周）
// 任一项拿不到就不阻塞导入，回退默认值/留空
async function nusttiFetchSemesterMeta() {
  const meta = { totalWeeks: null, semesterStartDate: null };
  try {
    const resp = await fetch(NUSTTI_MAINPAGE_URL, { credentials: "include" });
    if (!resp.ok) return meta;
    const text = await resp.text();
    const weekMatch = text.match(/第\s*\d+\s*周\s*<\/span>\s*\/\s*(\d+)\s*周/);
    if (weekMatch) meta.totalWeeks = parseInt(weekMatch[1], 10);
    const dateMatch = text.match(/id="rq"[^>]*value="(\d{4})-(\d{2})-(\d{2})"/);
    const weekNumMatch = text.match(/第\s*(\d+)\s*周\s*<\/span>/);
    if (dateMatch && weekNumMatch) {
      const y = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10);
      const d = parseInt(dateMatch[3], 10);
      const currentWeek = parseInt(weekNumMatch[1], 10);
      if (currentWeek >= 1) {
        const ms = Date.UTC(y, m - 1, d);
        const dayOffset = (new Date(ms).getUTCDay() + 6) % 7;   // 周一=0 … 周日=6
        const mondayOfThisWeek = ms - dayOffset * 86400000;
        const semesterStart = mondayOfThisWeek - (currentWeek - 1) * 7 * 86400000;
        const dt = new Date(semesterStart);
        meta.semesterStartDate = dt.getUTCFullYear() + "-" +
          String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" +
          String(dt.getUTCDate()).padStart(2, "0");
      }
    }
  } catch (e) { /* 元数据缺失不阻塞导入 */ }
  return meta;
}

// ===== 主流程 =====

async function nusttiRunImportFlow() {
  const bridge = window.shiguangBridge;
  const bridgePromise = window.shiguangBridgePromise;

  const confirmed = await bridgePromise.showAlert(
    "导入说明",
    '将读取南京理工大学泰州科技学院教务系统"学期理论课表"数据并导入轻屿课表。\n' +
    "请确保已在当前浏览器登录教务系统。\n是否继续？",
    "确认已登录"
  );
  if (!confirmed) { bridge.showToast("导入已取消"); return; }

  bridge.showToast("正在读取课表...");
  const doc = await nusttiFetchTimetableDoc();
  const meta = await nusttiFetchSemesterMeta();

  const { courses, rowInfos } = nusttiParseCourses(doc);
  if (courses.length === 0) {
    bridge.showToast("未解析到课程，请确认已登录且当前学期有课");
    return;
  }

  const timeSlots = nusttiBuildTimeSlots(rowInfos);
  const config = {
    semesterTotalWeeks: meta.totalWeeks || NUSTTI_DEFAULT_TOTAL_WEEKS,
    firstDayOfWeek: 1,
    defaultClassDuration: NUSTTI_SECTION_MINUTES,
    defaultBreakDuration: NUSTTI_BREAK_MINUTES
  };
  // semesterStartDate 仅当前学期能可靠推算时才填
  if (meta.semesterStartDate) config.semesterStartDate = meta.semesterStartDate;

  bridge.showToast("正在保存配置...");
  await bridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
  await bridgePromise.saveCourseConfig(JSON.stringify(config));
  await bridgePromise.saveImportedCourses(JSON.stringify(courses));

  bridge.showToast("导入成功：共 " + courses.length + " 条课程");
  bridge.notifyTaskCompletion();
}

(async () => {
  try {
    await nusttiRunImportFlow();
  } catch (error) {
    console.error("课表导入失败：", error);
    try {
      window.shiguangBridge.showToast("课表导入失败：" + (error && error.message ? error.message : error));
      await window.shiguangBridgePromise.showAlert("导入失败", String(error), "知道了");
    } catch {}
  }
})();
