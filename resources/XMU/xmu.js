/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 厦门大学(jw.xmu.edu.cn) 轻屿课表适配脚本
// 教务平台：金智教育（Wisedu）教务服务平台 AMP + gsapp 微应用
// 数据来源：/gsapp/sys/wdkbapp 下的 JSON 接口（不是 HTML 表格，无需解析 DOM）
// 解析逻辑按 XMU 实测接口重写，非本校在校开发者适配，出现问题请提交 issue 或 PR

// ===== 基础常量 =====
const SCHOOL_BASE_URL = "https://jw.xmu.edu.cn";
const SCHOOL_IMPORT_URL = SCHOOL_BASE_URL + "/new/index.html";
// 用绝对地址：CAS 登录后页面可能停在 ids.xmu.edu.cn，
// 那时相对路径 /gsapp/... 会打到错误的域名。
const GSAPP = "https://jw.xmu.edu.cn/gsapp/sys/wdkbapp";
// 课表微应用入口。它有独立会话（GS_SESSIONID），只登录门户不够，
// 直接调接口会拿到 403，必须先访问一次这个入口让服务端完成 SSO。
const SCHOOL_APP_ENTRY = GSAPP + "/*default/index.do?EMAP_LANG=zh&THEME=cherry";

const SCHOOL_DEFAULT_TOTAL_WEEKS = 18; // 兜底总周数；实际以接口 zcList 为准
const SCHOOL_SECTION_MINUTES = 45;     // 厦大每小节 45 分钟
const SCHOOL_BREAK_MINUTES = 10;       // 课间约 10 分钟

// 兜底作息：接口 queryXsskjc.do 拿不到时用
const SCHOOL_FALLBACK_TIME_SLOTS = [
  { number: 1, startTime: "08:00", endTime: "08:45" },
  { number: 2, startTime: "08:55", endTime: "09:40" },
  { number: 3, startTime: "10:10", endTime: "10:55" },
  { number: 4, startTime: "11:05", endTime: "11:50" },
  { number: 5, startTime: "14:30", endTime: "15:15" },
  { number: 6, startTime: "15:25", endTime: "16:10" },
  { number: 7, startTime: "16:40", endTime: "17:25" },
  { number: 8, startTime: "17:35", endTime: "18:20" },
  { number: 9, startTime: "19:10", endTime: "19:55" },
  { number: 10, startTime: "20:05", endTime: "20:50" },
  { number: 11, startTime: "21:00", endTime: "21:45" },
  { number: 12, startTime: "12:00", endTime: "14:00" },
];

const XMU_XH_CACHE_KEY = "xmu_adapter_student_id";

// ===== 通用工具 =====
function xmuPad2(n) {
  return (n < 10 ? "0" : "") + n;
}

// Date -> "YYYY-MM-DD"（本地时区）
function xmuFormatDate(d) {
  return d.getFullYear() + "-" + xmuPad2(d.getMonth() + 1) + "-" + xmuPad2(d.getDate());
}

// HHMM 整数 -> "HH:mm"；800 -> "08:00"，1430 -> "14:30"
function xmuHHmm(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = parseInt(v, 10);
  if (isNaN(n)) return "";
  return xmuPad2(Math.floor(n / 100)) + ":" + xmuPad2(n % 100);
}

// 两种桥接对象名都兼容
function xmuBridge() {
  return window.shiguangBridge || window.AndroidBridge;
}
function xmuBridgePromise() {
  return window.shiguangBridgePromise || window.AndroidBridgePromise;
}

// ===== 接口调用（复用当前登录会话的 cookie）=====
function xmuEncodeForm(data) {
  return Object.keys(data)
    .filter(function (k) {
      return data[k] !== undefined && data[k] !== null;
    })
    .map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(data[k]);
    })
    .join("&");
}

// 判断当前是否已经站在课表微应用页面上。
// 页面能打开就说明微应用会话（GS_SESSIONID）已经建立，此时完全不需要预热。
function xmuOnAppPage() {
  try {
    return String(window.location.href).indexOf("/gsapp/") >= 0;
  } catch (e) {
    return false;
  }
}

// 课表微应用有独立会话。若当前还在门户页，就先访问一次入口页触发 SSO 下发 GS_SESSIONID。
//
// 两个必须注意的点（都是真机实测踩出来的）：
//
// 1) **一定要加超时。** 这个 fetch 在部分 WebView 里既不 resolve 也不 reject，
//    会把整个导入流程挂死，最后被 App 的 30 秒超时判为「脚本注入失败」。
//    所以用 AbortController 兜住，超时就放弃——反正会话可能已经建立，
//    真有问题后面的接口调用会给出准确错误。
//
// 2) **用 no-cors。** CAS 的跳转链会跨域到 ids.xmu.edu.cn，
//    默认的 cors 模式会在那一跳被浏览器拦下，后面的 Set-Cookie 就拿不到了。
//    no-cors 不检查跨域、照常跟随重定向并写 cookie，响应内容我们也不需要读。
const XMU_WARMUP_TIMEOUT_MS = 6000;

async function xmuWarmUpAppSession() {
  if (xmuOnAppPage()) return true; // 已经在课表页，会话现成的

  let signal = null;
  let abort = null;
  try {
    if (typeof AbortController !== "undefined") {
      const ctl = new AbortController();
      signal = ctl.signal;
      abort = function () {
        try {
          ctl.abort();
        } catch (e) {
          /* 忽略 */
        }
      };
    }
  } catch (e) {
    signal = null;
  }

  let req;
  try {
    req = fetch(SCHOOL_APP_ENTRY, {
      credentials: "include",
      mode: "no-cors",
      redirect: "follow",
      signal: signal || undefined,
    });
  } catch (e) {
    return false;
  }

  // 用 Promise.race 兜底，而不是只靠 AbortController：
  // 实测这个 fetch 在 WebView 里可能既不 resolve 也不 reject，
  // 而 AbortController 未必可用。预热只是锦上添花，绝不能把整个导入流程挂死。
  const timer = new Promise(function (resolve) {
    setTimeout(resolve, XMU_WARMUP_TIMEOUT_MS);
  });
  await Promise.race([
    Promise.resolve(req).then(
      function () {
        return true;
      },
      function () {
        return false;
      }
    ),
    timer,
  ]);
  if (abort) abort(); // 超时的话顺手取消掉悬挂的请求
  return true;
}

const XMU_SESSION_HINT =
  "课表微应用的会话还没建立。\n" +
  "厦大教务分两层：只登录门户不够，还要打开一次课表页才会下发微应用会话。\n\n" +
  "请把调试记录的「网址」改成下面这个课表页地址（注意是 https），\n" +
  "重新登录后再执行导入：\n" +
  SCHOOL_APP_ENTRY;

async function xmuPost(path, data) {
  const resp = await fetch(GSAPP + path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: xmuEncodeForm(data || {}),
  });
  if (resp.status === 401 || resp.status === 403) throw new Error(XMU_SESSION_HINT);
  if (!resp.ok) throw new Error("接口 " + path + " 返回 HTTP " + resp.status);
  const text = await resp.text();
  // 会话失效时返回的是登录页 HTML，而不是 JSON
  if (/^\s*</.test(text)) {
    throw new Error("教务会话已失效，请在页面里重新登录后再执行导入");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("接口 " + path + " 返回的不是 JSON，教务可能已改版");
  }
}

async function xmuGet(path, params) {
  const qs = xmuEncodeForm(params || {});
  const resp = await fetch(GSAPP + path + (qs ? "?" + qs : ""), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json, text/javascript, */*; q=0.01" },
  });
  if (resp.status === 401 || resp.status === 403) return null;
  if (!resp.ok) throw new Error("接口 " + path + " 返回 HTTP " + resp.status);
  const text = await resp.text();
  if (/^\s*</.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// 开放学期列表（按开课时间倒序，第一个即当前学期）
async function xmuFetchTerms() {
  const j = await xmuPost("/modules/xskcb/kfdxnxqcx.do", {});
  const rows = (j && j.datas && j.datas.kfdxnxqcx && j.datas.kfdxnxqcx.rows) || [];
  return rows.map(function (r) {
    return {
      code: String(r.XNXQDM),
      name: r.XNXQDM_DISPLAY || String(r.XNXQDM),
    };
  });
}

// 当前周 + 学期周次表
async function xmuFetchWeekInfo(xnxqdm) {
  const j = await xmuPost("/wdkcb/getZcxx.do", { XNXQDM: xnxqdm });
  const weeks = ((j && j.zcList) || [])
    .map(function (z) {
      return parseInt(z.ZC, 10);
    })
    .filter(function (n) {
      return !isNaN(n);
    });
  return { current: parseInt(j && j.currentZc, 10) || 0, weeks: weeks };
}

// 节次表：DM=节次代码，KSSJ/JSSJ=起止时间（HHMM 整数）
async function xmuFetchPeriods(xnxqdm, xh) {
  const j = await xmuPost("/wdkcb/queryXsskjc.do", { XNXQDM: xnxqdm, XH: xh });
  return (j && j.data) || [];
}

// 整学期排课结果：不传 ZC，用 ZCBH 周次掩码自行过滤
async function xmuFetchSchedule(xnxqdm, xh) {
  const j = await xmuPost("/wdkcb/queryXspkjg.do", { XNXQDM: xnxqdm, XH: xh });
  return (j && j.pkjgList) || [];
}

// ===== 学号（接口必填 XH）=====
function xmuValidateStudentId(input) {
  const v = (input || "").trim();
  if (!v) return "请输入学号";
  if (!/^\d{6,20}$/.test(v)) return "学号应为纯数字";
  return false;
}
window.xmuValidateStudentId = xmuValidateStudentId;

function xmuReadCachedStudentId() {
  // 1) 上次问过就记住
  try {
    const v = window.localStorage.getItem(XMU_XH_CACHE_KEY);
    if (v && /^\d{6,20}$/.test(String(v).trim())) return String(v).trim();
  } catch (e) {
    /* localStorage 被禁用时继续往下试 */
  }
  // 2) 厦大门户会把登录身份写进 localStorage 的 ampUserId。
  //    实测该键存在；只有长得像学号才采用，否则退回问用户。
  try {
    const amp = window.localStorage.getItem("ampUserId");
    if (amp && /^\d{6,20}$/.test(String(amp).trim())) {
      const xh = String(amp).trim();
      xmuCacheStudentId(xh);
      return xh;
    }
  } catch (e) {
    /* 继续往下试 */
  }
  return "";
}

function xmuCacheStudentId(xh) {
  try {
    window.localStorage.setItem(XMU_XH_CACHE_KEY, xh);
  } catch (e) {
    /* WebView 禁用 localStorage 时忽略，只是下次还要再问一次 */
  }
}

// 依次尝试：缓存 -> 服务端会话身份 -> 页面里的学号 -> 问用户
async function xmuResolveStudentId() {
  const bridge = xmuBridge();
  const bridgePromise = xmuBridgePromise();

  const cached = xmuReadCachedStudentId();
  if (cached) return cached;

  // initXsxx 是「初始化学生信息」，部分部署不传 XH 也能返回当前登录学生
  try {
    const j = await xmuGet("/wdkcb/initXsxx.do", {});
    const row = j && j.data && j.data[0];
    const guess = row && (row.XH || row.xh);
    if (guess && /^\d{6,20}$/.test(String(guess))) {
      xmuCacheStudentId(String(guess));
      return String(guess);
    }
  } catch (e) {
    /* 继续往下试 */
  }

  // 页面上如果直接带着学号（门户首页有时会渲染）
  try {
    const m = String(document.body ? document.body.innerText : "").match(/\b(\d{10,16})\b/);
    if (m) {
      xmuCacheStudentId(m[1]);
      return m[1];
    }
  } catch (e) {
    /* 继续往下试 */
  }

  bridge.showToast("需要输入一次学号");
  const input = await bridgePromise.showPrompt(
    "输入学号",
    "厦门大学教务接口需要学号才能查询个人课表。\n只需输入一次，之后会记住。",
    "",
    "xmuValidateStudentId"
  );
  const xh = (input || "").trim();
  if (!xh) return "";
  xmuCacheStudentId(xh);
  return xh;
}

// ===== 周次 =====
// ZCBH 是 0/1 周次掩码，第 i 位为 '1' 表示第 i 周有课
function xmuWeeksFromMask(zcbh, totalWeeks) {
  const mask = String(zcbh === null || zcbh === undefined ? "" : zcbh);
  const out = [];
  const n = Math.min(mask.length, totalWeeks);
  for (let i = 0; i < n; i++) {
    if (mask.charAt(i) === "1") out.push(i + 1);
  }
  return out;
}

// 学期总周数：以接口周次表为准，只有确有课程排在更后面才向上扩展。
// ZCBH 掩码是定长的（厦大 30 位），直接取长度会多出十几个空周。
function xmuEffectiveTotalWeeks(schedule, weekInfo) {
  let total = 0;
  for (let i = 0; i < (weekInfo.weeks || []).length; i++) {
    const w = weekInfo.weeks[i];
    if (typeof w === "number" && w > total) total = w;
  }
  for (let i = 0; i < schedule.length; i++) {
    const mask = String(schedule[i].ZCBH === null || schedule[i].ZCBH === undefined ? "" : schedule[i].ZCBH);
    const last = mask.lastIndexOf("1");
    if (last + 1 > total) total = last + 1;
  }
  if (!total) total = SCHOOL_DEFAULT_TOTAL_WEEKS; // 两边都没给信息时才用兜底值
  return Math.max(total, 1);
}

// 用「服务器认定的当前周」反推第 1 周周一（仅对当前学期可靠）
function xmuInferStartDate(weekInfo) {
  const cur = parseInt(weekInfo.current, 10);
  if (!cur || cur < 1) return null;
  const now = new Date();
  const dowFromMonday = (now.getDay() + 6) % 7; // 周一=0 … 周日=6
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dowFromMonday);
  monday.setDate(monday.getDate() - (cur - 1) * 7);
  return xmuFormatDate(monday);
}

// ===== 连堂课合并 =====
// 厦大接口对一门排在第 2~4 节的课会返回 3 条记录，每条只标自己占的那一节
// （KSJCDM == JSJCDM）。必须先按课程身份分组，再把「节次连续」的记录并成一块，
// 否则课表上会显示成 3 个独立小块，而不是一整块连堂。
// 只合并相邻节次：同一门课上午一节、下午一节不会被误并成跨半天的大块。
function xmuMergeBlocks(schedule, dmToNumber) {
  const groups = new Map();
  for (let i = 0; i < schedule.length; i++) {
    const c = schedule[i];
    const a = xmuSectionNo(c.KSJCDM, dmToNumber);
    const b = xmuSectionNo(c.JSJCDM, dmToNumber);
    if (!a || !b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = [c.KCDM, c.KCMC, c.XQ, c.JSXM, c.JASMC, String(c.ZCBH)].join("\u0001");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ lo: lo, hi: hi, record: c });
  }

  const blocks = [];
  groups.forEach(function (items) {
    items.sort(function (x, y) {
      return x.lo - y.lo;
    });
    let lo = items[0].lo;
    let hi = items[0].hi;
    let bucket = [items[0].record];
    for (let i = 1; i < items.length; i++) {
      if (items[i].lo <= hi + 1) {
        if (items[i].hi > hi) hi = items[i].hi;
        bucket.push(items[i].record);
      } else {
        blocks.push({ startSection: lo, endSection: hi, records: bucket });
        lo = items[i].lo;
        hi = items[i].hi;
        bucket = [items[i].record];
      }
    }
    blocks.push({ startSection: lo, endSection: hi, records: bucket });
  });
  return blocks;
}

// 取一块里所有记录的最早开始 / 最晚结束时间
function xmuBlockTime(records) {
  let start = null;
  let end = null;
  for (let i = 0; i < records.length; i++) {
    const s = records[i].KSSJ;
    const e = records[i].JSSJ;
    if (s !== null && s !== undefined && s !== "" && (start === null || parseInt(s, 10) < start)) start = parseInt(s, 10);
    if (e !== null && e !== undefined && e !== "" && (end === null || parseInt(e, 10) > end)) end = parseInt(e, 10);
  }
  return { start: start, end: end };
}

// ===== 节次 =====
// 节次代码 -> 连续序号。
//   有节次表：查不到就返回 null（数据不一致，这条记录该跳过）
//   整张表缺失：退化成「直接把 KSJCDM 当节号」，否则所有课程都会被过滤掉
function xmuSectionNo(dmCode, dmToNumber) {
  const mapped = dmToNumber[String(dmCode)];
  if (mapped) return mapped;
  if (Object.keys(dmToNumber).length) return null;
  const s = String(dmCode === null || dmCode === undefined ? "" : dmCode);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

// 节次表按 DM 排序，number 重排为 1..N，并建立 DM -> number 映射
function xmuBuildPeriodMap(periods) {
  const dmToNumber = {};
  const slots = [];
  const ordered = (periods || []).slice().sort(function (a, b) {
    return (parseInt(a.DM, 10) || 0) - (parseInt(b.DM, 10) || 0);
  });
  for (let i = 0; i < ordered.length; i++) {
    dmToNumber[String(ordered[i].DM)] = i + 1;
    slots.push({
      number: i + 1,
      startTime: xmuHHmm(ordered[i].KSSJ),
      endTime: xmuHHmm(ordered[i].JSSJ),
    });
  }
  if (!slots.length) {
    return { slots: SCHOOL_FALLBACK_TIME_SLOTS.slice(), dmToNumber: {} };
  }
  return { slots: slots, dmToNumber: dmToNumber };
}

// 没被任何课占用的尾部节次是纯噪音（厦大第 12 节是 12:00-14:00 的特殊时段）。
// 只砍尾部，保证「第几节」仍然是学校的第几节。
function xmuTruncateSlots(slots, maxUsedSection) {
  if (maxUsedSection && maxUsedSection < slots.length) return slots.slice(0, maxUsedSection);
  return slots;
}

function xmuBuildCourses(schedule, dmToNumber, totalWeeks) {
  const blocks = xmuMergeBlocks(schedule, dmToNumber);
  const courses = [];
  let maxUsed = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const c = b.records[0];
    const weeks = xmuWeeksFromMask(c.ZCBH, totalWeeks);
    const name = String(c.KCMC || "").trim();
    const day = parseInt(c.XQ, 10) || 0;
    if (!weeks.length || !name || day < 1 || day > 7) continue;
    if (b.endSection > maxUsed) maxUsed = b.endSection;
    courses.push({
      name: name,
      teacher: String(c.JSXM || "").trim(),
      position: String(c.JASMC || "").trim(),
      day: day,
      startSection: b.startSection,
      endSection: b.endSection,
      weeks: weeks,
    });
  }
  return { courses: courses, maxUsed: maxUsed };
}

// ===== 主流程 =====
async function schoolRunImportFlow() {
  const bridge = xmuBridge();
  const bridgePromise = xmuBridgePromise();

  const confirmed = await bridgePromise.showAlert(
    "导入说明",
    "将读取厦门大学教务服务平台的「我的课表」并导入轻屿课表。\n" +
      "请确保已在当前页面登录教务系统（统一身份认证）。\n" +
      "注意：教务接口限制，首次运行需要输入一次学号。\n" +
      "是否继续？",
    "确认已登录"
  );
  if (!confirmed) {
    bridge.showToast("导入已取消");
    return;
  }

  // 页面必须停在教务域；停在 CAS 域时接口会跨域失败，提前给出可操作的提示
  try {
    if (window.location && window.location.host && window.location.host.indexOf("jw.xmu.edu.cn") < 0) {
      await bridgePromise.showAlert(
        "请先回到教务首页",
        "当前页面在 " + window.location.host + "，不是教务域名。\n" +
          "请先打开 " + SCHOOL_IMPORT_URL + " 并确认已登录，再回来执行导入。",
        "知道了"
      );
      return;
    }
  } catch (e) {
    /* 拿不到 location 就不拦截，交给接口报错 */
  }

  bridge.showToast("正在连接课表服务...");
  await xmuWarmUpAppSession();

  bridge.showToast("正在读取学期列表...");
  const terms = await xmuFetchTerms();
  if (!terms.length) {
    bridge.showToast("教务未返回任何学期，可能当前未开放课表查询");
    return;
  }

  // 选学期：默认当前学期（列表第一个）
  let termIndex = 0;
  if (terms.length > 1) {
    const labels = terms.map(function (t) {
      return t.name;
    });
    const picked = await bridgePromise.showSingleSelection("选择要导入的学期", JSON.stringify(labels), 0);
    if (picked === null || picked === undefined || picked < 0) {
      bridge.showToast("导入已取消");
      return;
    }
    termIndex = picked;
  }
  const term = terms[termIndex];
  const isCurrentTerm = termIndex === 0;

  bridge.showToast("读取 " + term.name + " 的课表...");
  const xh = await xmuResolveStudentId();
  if (!xh) {
    bridge.showToast("未提供学号，已取消导入");
    return;
  }

  const periods = await xmuFetchPeriods(term.code, xh);
  const weekInfo = await xmuFetchWeekInfo(term.code);
  const schedule = await xmuFetchSchedule(term.code, xh);

  if (!schedule.length) {
    bridge.showToast("该学期没有排课记录，请确认学期是否正确");
    return;
  }

  const totalWeeks = xmuEffectiveTotalWeeks(schedule, weekInfo);
  const periodMap = xmuBuildPeriodMap(periods);
  const built = xmuBuildCourses(schedule, periodMap.dmToNumber, totalWeeks);

  if (!built.courses.length) {
    bridge.showToast("未解析到有效课程，请确认教务页面显示正常后重试");
    return;
  }

  const timeSlots = xmuTruncateSlots(periodMap.slots, built.maxUsed);
  const courses = built.courses;

  const config = {
    semesterTotalWeeks: totalWeeks,
    firstDayOfWeek: 1,
    defaultClassDuration: SCHOOL_SECTION_MINUTES,
    defaultBreakDuration: SCHOOL_BREAK_MINUTES,
  };
  // 只有当前学期才能用「服务器当前周」可靠反推开学日期；历史学期留给 App 端
  if (isCurrentTerm) {
    const startDate = xmuInferStartDate(weekInfo);
    if (startDate) config.semesterStartDate = startDate;
  }

  await bridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
  await bridgePromise.saveCourseConfig(JSON.stringify(config));
  await bridgePromise.saveImportedCourses(JSON.stringify(courses));

  bridge.showToast("导入成功：共 " + courses.length + " 门课程");
  bridge.notifyTaskCompletion();
}

(async () => {
  try {
    await schoolRunImportFlow();
  } catch (error) {
    console.error("课表导入失败：", error);
    try {
      window.shiguangBridge.showToast("课表导入失败：" + (error && error.message ? error.message : error));
      await window.shiguangBridgePromise.showAlert("导入失败", String(error), "知道了");
    } catch (e) {
      /* 桥接不可用时不掩盖原始错误 */
    }
  }
})();
