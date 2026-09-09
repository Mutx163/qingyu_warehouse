---
name: jiaowu-adapter
description: 轻屿/拾光课表 App 的教务课表导入适配工作流（qingyu_warehouse）。面向「为某所学校做一次课表导入适配」：识别教务平台、照抄仓库内同平台参考脚本骨架、在用户已登录页签中实测目标校真实接口、编写适配脚本、注入测试、本地校验、发布入库。全程只在已登录会话中复用 cookie，绝不索要、触碰、提交任何账号密码凭证。
---

# 教务课表导入适配 skill（qingyu_warehouse）

本 skill 固化的路径：**先查仓库里已有的同类学校脚本 → 照抄骨架 → 实测目标校真实接口 → 调整 → 注入测试 → 本地校验 → 发布**。
这条路径比通读 docs/QUICK_START.md 快得多；文档只作参考，本 skill 是执行路径。

本 skill 适用于两种执行环境：

- **模式 A**：agent 具备浏览器控制能力（可操作一个已登录教务页签）→ agent 直接注入探测/测试代码并读回结果。
- **模式 B**：agent 只有代码/文件能力 → agent 生成代码片段交给用户，由用户在**已登录教务系统的页签** F12 控制台粘贴运行，再把输出复制回给 agent。

---

## 0. 安全红线（先读，全程不得违反）

1. **绝不索要、接收、处理用户的账号、密码、验证码、Cookie、Token。**
   - 登录由用户自己在浏览器完成；agent 只在已登录页签内复用会话（同源 `fetch(url, { credentials: "include" })` 或读取该页签 DOM）。
   - 凭证相关内容不得出现在：生成的脚本、任何工作文件、git 提交、对话记录里。
   - 会话失效时：提示用户「请刷新页面重新登录教务系统」，绝不代登。
2. **探测/测试代码的结果只能输出到页面控制台或返回给调用方**，供用户复制回给 agent；**不得自动发送到任何远程地址**（不写外部上报、不传第三方服务器）。
3. **不提交临时产物**：`index/school_index.pb`（二进制由维护者经 `.github/workflows/build-index.yml` 生成）、抓包样本原始件、IDE 缓存、本地环境文件。实测拿到的课表数据若保留作参考，须去除个人标识（学号、姓名）后再放。
4. **`index/search_index.yaml` 是自动生成的，勿手改**：`adapters.yaml` / `root_index.yaml` 变动后运行 `python scripts/build_search_index.py` 重生并提交；CI 的 `--check` 会拦截不一致。
5. **每个脚本头部的 `qingyu-compat-shim v2` 块必须原样保留**（`AndroidBridge`→`shiguangBridge` 别名），勿删勿改。

---

## 1. 输入

开始前向用户确认（缺什么问什么，一次问全）：

| 输入 | 说明 |
|---|---|
| 学校名 + 教务入口 URL | 如「闽南科技学院，https://jwgl.mku.edu.cn/」 |
| 目标校代码 `SCHOOL_ID` | 通常取学校英文缩写（全大写），须与 `resources/` 目录名、`root_index.yaml` 的 id 一致；若仓库已有该校目录则复用 |
| 登录状态 | 用户须在浏览器中**已完成登录**，会话有效。分工见 §1.1：**agent 只负责把教务入口页面打开，登录动作一律由用户本人完成** |
| 仓库访问方式 | 克隆 `https://github.com/Mutx163/qingyu_warehouse`（App 读这个 fork）。国内网络直连失败时：优先用 GitCode 镜像 `https://gitcode.com/mutx/qingyu_warehouse`（main 更新后自动同步；只用于拉取，Issue/PR 仍走 GitHub），或用户认可的 GitHub 加速代理；克隆后改读本地文件继续 |

### 1.1 登录分工：**agent 开页面，用户接管登录**

全程铁律：**agent 不执行登录、不代填表单、不索要账号密码/验证码/ Cookie**。正确顺序：

1. **agent 把教务入口打开**（拿到 URL 后第一件事）
   - **模式 A**（agent 有浏览器控制能力）：用浏览器工具打开用户给的教务入口 URL，**然后停在这里**，回复用户「页面已打开，请你在里面完成登录；登录好后告诉我，我再继续」；
   - **模式 B**（agent 无浏览器能力）：提示用户在本机浏览器打开该 URL 并登录，登录完成后再继续。
2. **用户接管登录**：用户本人在该页面完成账号密码 / 验证码 / 统一身份认证。agent 只等待，不介入。
3. **确认会话已建立**：登录完成后先跑一次 §4 探测做连通性确认；若 HTTP 200 但 body 是登录跳转脚本，说明会话没建立成功 → 提示用户重新登录，不要继续解析（见 §4 认知错误 2）。

> 模式 A 下，后续所有探测与注入测试都在**这个已登录页签**内执行，会话天然复用，用户不需要提供任何凭证。
> 若 agent 的浏览器环境无法访问校园网/教务站点（很多教务只对内网或特定网络开放），退回模式 B：由用户在自己的浏览器里登录并粘贴运行代码片段。

---

## 2. 快速路径总览

```text
Step 0  打开教务入口 URL → 用户接管登录 → 确认会话有效（§1.1，agent 不碰凭证）
Step 1  识别平台（URL/页面特征 + 仓库内同平台学校 grep）
Step 2  读同平台参考脚本（§3 平台表），只当骨架
Step 3  探测目标校真实接口（§4）：课表接口 URL/参数/返回形态
Step 4  写 resources/<SCHOOL_ID>/<s>.js（§5 骨架模板 + 桥接 API）
Step 5  注入测试（§6 mock 模板）+ 逐条比对教务真实课表
Step 6  本地校验（§7）
Step 7  发布入库（§8）+ 交付报告（§9）
```

**铁律：参考脚本只当骨架。URL、学期参数、解析选择器、周次/节次文案一律以目标校实测为准。**

---

## 3. 平台识别 → 抄谁（已核对本仓库 main 真实存在）

先看教务入口 URL 与页面 HTML，再在仓库里 grep 同平台学校脚本：

```bash
# 强智特征
grep -rlE "jsxsd|xskb_list\.do|kbcontent" resources/ --include='*.js'
# 正方特征
grep -rlE "xskbcx|kbgrid_table_0|__VIEWSTATE|xs_main" resources/ --include='*.js'
# 青果 / URP / 超星：直接看通用模板目录
```

| 平台 | 识别特征 | 首选参考（main 真实存在） |
|---|---|---|
| **强智·新版 layui** | 课表格 `td[name="kbDataTd"]`；课程条目 `li > .qz-hasCourse-title`（课名）/`.qz-hasCourse-abbrinfo`（老师/时间/地点串）；课表接口带 `?viweType=0`（注意：参数名就是 **viweType**，原样拼写，勿"纠正"成 viewType） | **`resources/MKU/mku.js`（同构最佳参考）**；周次接口 `/jsxsd/xskb/jxzlzc_xnxq_ajax` 返回 `[{"qszc":1,"jszc":20}]` |
| **强智·老版** | 路径 `/jsxsd/`、页面 `.htmlx`；课表 `POST /jsxsd/xskb/xskb_list.do` 返回 `<div class="kbcontent">`，字段藏在 `<font title="教师/周次/教室">` 的 title 里 | `resources/HYNU/hynu_01.js`（最简）、`resources/BUPT/bupt_01.js`、`resources/BTBU/btbu.js`（含 WebVPN 前缀自动推导）、HHTC/HNUST/HUSE/JSNU/QAU/XAUT 等（grep jsxsd 可见 20+ 所） |
| **正方** | `.aspx`、`xs_main.aspx`/`xskbcx`、`#kbgrid_table_0`、`__VIEWSTATE`，页面依赖 jQuery（模板里 `window.jQuery`） | `resources/zhengfang_jiaowu/zhengfang_01.js`（通用模板，约 44 所学校在用） |
| **青果** | CAS `login.action` / authserver 登录；通用模板用「倒数 7 列」逻辑解析课表表格 | `resources/qingguo_jiaowu/qingguo_01.js`（通用模板，约 9 所） |
| **URP** | 周次文案形如 `"1-8,10-17周"`、带单/双周标记；DOM 解析 | `resources/urp_jiaowu/urp_01.js`（通用模板） |
| **超星** | 部分字段内嵌 HTML 标签（取 `<a>` 文本）；教师名带括号要清洗 | `resources/chaoxing_jiaowu/chaoxing.js`（通用模板） |
| **不确定** | 拿目标校页面特征 grep 上表关键词 | 命中谁就抄谁；都命中不了就按 §5 骨架从零写，并用 §4 实测定接口 |

**WebVPN 变体**：部分强智校把教务挂在 WebVPN 后（URL 形如 `https://vpn.xxx.edu.cn/{https|https-443}/<站点哈希>/jsxsd/...`）。参考 `resources/BTBU/btbu.js`：从 `location.pathname` 中 `/jsxsd/` 的位置推导前缀，直连与 WebVPN 通用。
---

## 4. 实测目标校真实接口

**前提：已完成 §1.1 的登录，当前页面/页签处于已登录状态。** 还没登录就先回去走 Step 0，别急着探测。

目标：拿到「完整学期课表」的数据源 + 学期/周次/时间参数。**两个高频认知错误先记住：**

1. **首页仪表盘 ≠ 全量数据**：教务首页常只渲染「当前周」视图；完整学期课表必须走专门的课表接口（如强智 `xskb_list.do` 服务端直出整学期 HTML）。
2. **会话失效 ≠ HTTP 报错**：请求返回 **HTTP 200** 但 body 是登录跳转脚本（形如 `window.location.href = 'https://.../cas/login'` 的整页 JS 重定向）→ 判为未登录，提示用户刷新重登，不要继续解析。

### 探测片段（模式 A：agent 在已登录页签直接注入执行；模式 B：用户粘贴到已登录页签 F12 控制台运行，结果复制回给 agent）

```js
// 把 TIMETABLE_URL 换成 §3 推断的课表接口候选（绝对或同源相对路径均可）
(async () => {
  const out = { url: location.href, fetched: "TIMETABLE_URL" };
  const resp = await fetch("TIMETABLE_URL", { credentials: "include" });
  out.status = resp.status;
  const text = await resp.text();
  out.bodyHead = text.slice(0, 4000);
  // 会话失效特征：200 但内容是登录跳转脚本
  out.loginRedirect = /location\.href\s*=\s*['"][^'"]*(login|cas\/)/i.test(text.slice(0, 2000));
  // JSON 尝试解析（接口是 JSON 的直接给出结构摘要）
  try {
    const j = JSON.parse(text);
    out.jsonType = Array.isArray(j) ? "array(" + j.length + ")" : typeof j;
    out.jsonHead = JSON.stringify(j).slice(0, 2000);
  } catch {}
  // HTML 时提取关键选择器证据
  const doc = new DOMParser().parseFromString(text, "text/html");
  out.hint = {
    kbDataTd: !!doc.querySelector('td[name="kbDataTd"]'),
    kbcontent: doc.querySelectorAll("div.kbcontent, div.kbcontent1").length,
    kbgrid: !!doc.querySelector("#kbgrid_table_0"),
    semesterSelect: !!doc.querySelector("#xnxq01id") || !!doc.querySelector("select")
  };
  return JSON.stringify(out);
})();
```

把输出回传后，agent 判断：接口形态（HTML 课表页 / JSON / 登录跳转）→ 选定解析策略 → 需要参数（学期 id、`viweType`、`__VIEWSTATE` 等）时再补一轮定向探测（如「取学期下拉的 options」「POST 表单字段清单」）。

### 先确认 GET 还是 POST（别用 GET 硬撞 POST 接口）

上面那段探测是 **GET**。**强智老版、部分正方/URP 的课表接口是 POST**（如强智老版 `POST /jsxsd/xskb/xskb_list.do`），用 GET 去撞只会拿到 405 或空页，容易被误判成「接口不存在」。判断依据按优先级：

1. **同平台参考脚本里已有的请求方式**——最快，直接抄；
2. 浏览器 DevTools → Network → 找到课表请求 → 看 `Method` 列与 `Payload / 表单数据`；
3. 教务页面源码里课表表单的 `method` 属性。

确认是 POST 后改用这段（把 `FORM_BODY` 换成 DevTools Payload 里看到的真实字段；强智常见 `xnxq01id`（学期）、`viweType`、`kbjcmsid`）：

```js
(async () => {
  const out = { url: location.href, fetched: "TIMETABLE_URL", method: "POST" };
  const resp = await fetch("TIMETABLE_URL", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "FORM_BODY"          // 例："xnxq01id=2025-2026-1&viweType=0"
  });
  out.status = resp.status;
  const text = await resp.text();
  out.bodyHead = text.slice(0, 4000);
  out.loginRedirect = /location\.href\s*=\s*['"][^'"]*(login|cas\/)/i.test(text.slice(0, 2000));
  const doc = new DOMParser().parseFromString(text, "text/html");
  out.hint = {
    kbcontent: doc.querySelectorAll("div.kbcontent, div.kbcontent1").length,
    kbgrid: !!doc.querySelector("#kbgrid_table_0"),
    kbDataTd: !!doc.querySelector('td[name="kbDataTd"]')
  };
  return JSON.stringify(out);
})();
```

表单字段拿不准时，先跑一轮「取表单字段清单」的定向探测（在课表页执行）：

```js
[...new Set([...document.querySelectorAll("form input[name], form select[name]")].map(e => e.name))].join("\n")
```

---

## 5. 编写适配脚本（骨架模板）

输出 `resources/<SCHOOL_ID>/<s>.js`（文件名小写，参考 MKU 的 `mku.js`）。脚本头部**必须**原样带 shim，其后是主体。

> ⚠️ **下面是伪代码骨架，不是可直接运行的代码。** 凡带 `<...>` 尖括号占位、`/* ... */` 注释占位的行（典型：`url += "&<学期参数>="`、`const doc = /* ... */;`、`semesterTotalWeeks: /* ... */,`）**必须逐处替换成真实内容**，否则 `node --check` 必然失败。
>
> **必须替换的占位清单**：`SCHOOL_BASE_URL`、`SCHOOL_TIMETABLE_URL`、`<课表接口路径>`、`<参数>`、`<学期参数>`、`<目标课表特征选择器>`、`<学校名>`、`<domain>`、`<平台名>`、`<REF_SCHOOL>`、`<SCHOOL_ID>`；5 个 `school*` 函数体（对照参考脚本补全）；`const doc = ...`；`config` 里的 `semesterTotalWeeks`。
>
> **替换完先跑 `node --check` 通过，再进入 §6 注入测试。**

骨架（按 MKU 结构泛化；注释中的占位实现请对照参考脚本抄写补全）：

```js
/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// <学校名>(<domain>) 轻屿课表适配脚本
// 教务平台：<平台名>
// 数据来源：<课表接口/页面>（默认渲染当前学期，可用 <学期参数> 切换）
// 解析逻辑参考本仓库 <REF_SCHOOL> 的适配，按 <SCHOOL_ID> 实测 DOM/接口重写
// 非该校在校开发者适配，出现问题请提交 issue 或 PR

// ===== 基础常量 =====
const SCHOOL_BASE_URL = "https://jwgl.<domain>";
const SCHOOL_TIMETABLE_URL = SCHOOL_BASE_URL + "/<课表接口路径>";
const SCHOOL_DEFAULT_TOTAL_WEEKS = 20;        // 兜底总周数，能取接口值就取接口值
const SCHOOL_SECTION_MINUTES = 45;           // 每小节课时长（分钟），实测确认
const SCHOOL_BREAK_MINUTES = 10;             // 课间时长（分钟），实测确认
const SCHOOL_FALLBACK_TIME_SLOTS = [         // 兜底作息：{number, startTime:"HH:mm", endTime:"HH:mm"}
  { number: 1, startTime: "08:00", endTime: "08:45" },
  /* 按课表页大节时间标注推导全部节次；推导失败时用此兜底 */
];

// ===== 周次与节次解析 =====
// 周次片段展开："1,3,5" / "1-16" / "1-8,10-16" → 去重排序数字数组；
// 注意兼容「单周/双周」标注（对展开结果再按奇偶过滤）。
function schoolExpandWeeks(weekPart) { /* 实现同 MKU 的 mkuExpandWeeks */ }

// 解析课程「时间」字段，如 "1,3,5,7周[1-2节]" → { weeks, startSection, endSection }
function schoolParseTimeText(timeText) { /* 实现同 MKU 的 mkuParseTimeText */ }

// ===== 课表解析（HTML 表格时）=====
// 表格展开为 grid[row][col]，正确处理 rowspan/colspan（连堂！）
function schoolBuildGrid(table) { /* 实现同 MKU 的 mkuBuildGrid */ }

// 解析行标签：大节范围 "1-2" + 时间 "08:00~09:40" → 每行 {startSection, endSection, blockStart, blockEnd}
function schoolParseRowInfos(table) { /* 实现同 MKU 的 mkuParseRowInfos */ }

// 解析课程条目（强智新版：li 内 .qz-hasCourse-title 取课名；
// .qz-hasCourse-abbrinfo 是 "老师:xx;时间:..;地点:yy" 标签串，按标签切分）
function schoolParseCourses(doc) {
  // 同一单元格可能含多条课程，逐条解析；
  // 周次缺失的课程要跳过（避免导入错误数据）；
  // 完全重复条目（同名/同师/同地/同天/同节次/同周次）去重。
  return { courses, rowInfos };
}

// 由课表页大节时间推导小节作息；推导失败回退 SCHOOL_FALLBACK_TIME_SLOTS
function schoolBuildTimeSlots(rowInfos) { /* 实现同 MKU 的 mkuBuildTimeSlots */ }

// ===== 教务数据获取 =====
// 拉取课表页面/接口（不传学期参数则渲染教务当前学期）
async function schoolFetchTimetableDoc(semesterId) {
  let url = SCHOOL_TIMETABLE_URL + "?<参数>";
  if (semesterId) url += "&<学期参数>=" + encodeURIComponent(semesterId);
  const resp = await fetch(url, { credentials: "include" });   // ← 复用浏览器会话
  if (!resp.ok) throw new Error("获取课表失败：HTTP " + resp.status);
  const text = await resp.text();
  // 会话失效识别：200 但 body 是登录跳转脚本
  if (/location\.href\s*=\s*['"][^'"]*(login|cas\/)/i.test(text.slice(0, 2000))) {
    throw new Error("教务会话已失效，请刷新页面重新登录后再运行");
  }
  const doc = new DOMParser().parseFromString(text, "text/html");
  if (!doc.querySelector("<目标课表特征选择器>")) {
    throw new Error("未获取到课表数据，请确认已登录且该学期有课");
  }
  return doc;
}

// 学期下拉选项 / 学期总周数 / 开学日期：能取接口就取，取不到用兜底或省略

// ===== 主流程 =====
async function schoolRunImportFlow() {
  const bridge = window.shiguangBridge;
  const bridgePromise = window.shiguangBridgePromise;

  const confirmed = await bridgePromise.showAlert(
    "导入说明",
    '将读取<学校名>教务系统"个人课表"数据并导入轻屿课表。\n请确保已在当前浏览器登录教务系统。\n是否继续？',
    "确认已登录"
  );
  if (!confirmed) { bridge.showToast("导入已取消"); return; }

  bridge.showToast("正在读取课表...");
  const firstDoc = await schoolFetchTimetableDoc();
  // （可选）学期选择：读学期下拉 → bridgePromise.showSingleSelection("选择要导入的学期", JSON.stringify(labels), defaultIndex)

  const doc = /* 所选学期对应的文档（默认学期直接复用 firstDoc） */;
  const { courses, rowInfos } = schoolParseCourses(doc);
  if (courses.length === 0) { bridge.showToast("未解析到课程，请确认所选学期有课且已登录"); return; }

  const timeSlots = schoolBuildTimeSlots(rowInfos);
  const config = {
    semesterTotalWeeks: /* 接口值或默认 20 */,
    firstDayOfWeek: 1,
    defaultClassDuration: SCHOOL_SECTION_MINUTES,
    defaultBreakDuration: SCHOOL_BREAK_MINUTES,
    /* semesterStartDate 仅当前学期能可靠推算时才填；历史学期留给 App 端 */
  };

  await bridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
  await bridgePromise.saveCourseConfig(JSON.stringify(config));
  await bridgePromise.saveImportedCourses(JSON.stringify(courses));

  bridge.showToast("导入成功：共 " + courses.length + " 条课程");
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
    } catch {}
  }
})();
```

### 桥接 API 速查（权威定义见仓库 docs/SCRIPT_API.md）

| 对象 | 方法 | 说明 |
|---|---|---|
| `window.AndroidBridge`（同步） | `showToast(msg)` | 轻提示 |
| | `notifyTaskCompletion()` | 任务完成通知；**必须是流程最后一步** |
| `window.AndroidBridgePromise`（异步） | `showAlert(title, content, confirmText)` → `bool` | 确认弹窗；`false` 表示用户取消 |
| | `showPrompt(title, content, defaultValue, validatorFnName)` → `string` | 输入框，可绑定脚本内校验函数名 |
| | `showSingleSelection(title, itemsJson, selectedIndex)` → `index` | 单选列表；取消返回 `null`/负数要判 |
| | `saveImportedCourses(coursesJson)` | 保存课程数组（传 **JSON 字符串**） |
| | `savePresetTimeSlots(timeSlotsJson)` | 保存节次时间模板 |
| | `saveCourseConfig(configJson)` | 保存学期配置 |

### 数据结构（save 入参全部是 `JSON.stringify(...)` 后的字符串）

- **课程**：`{ name, teacher, position, day(1-7), startSection, endSection, weeks[] }`；
  自定义时间课程加 `isCustomTime: true, customStartTime: "HH:mm", customEndTime: "HH:mm"`。
- **时间模板**：`[{ number, startTime, endTime }]`（HH:mm）。
- **学期配置**：`{ semesterStartDate("YYYY-MM-DD",可省), semesterTotalWeeks, firstDayOfWeek, defaultClassDuration, defaultBreakDuration }`。

**推荐执行顺序**：识别登录态 → 抓原始数据 → 转 courses →（需要时）timeSlots/config → save 三连 → `notifyTaskCompletion()`。

---

## 6. 注入测试（替代 F12 手工点按）

在已登录页签按顺序粘贴三段（模式 A 则由 agent 直接注入执行）：

### ① 安装 mock 桥接（必须先于脚本运行）

```js
(() => {
  const state = { courses: null, timeSlots: null, config: null, notified: false, toasts: [] };
  window.AndroidBridge = {
    showToast: (m) => { state.toasts.push(m); console.log("[toast]", m); },
    notifyTaskCompletion: () => { state.notified = true; console.log("[done] notifyTaskCompletion"); },
    showAlert: () => true,
  };
  window.AndroidBridgePromise = {
    showAlert: async () => true,                                  // 默认点「确认」
    showPrompt: async (t, c, d) => d || "",
    showSingleSelection: async () => 0,                           // 默认选第一项（通常=当前学期）
    saveImportedCourses: async (j) => { state.courses = JSON.parse(j); console.log("[save] courses:", state.courses.length); },
    savePresetTimeSlots: async (j) => { state.timeSlots = JSON.parse(j); },
    saveCourseConfig: async (j) => { state.config = JSON.parse(j); },
  };
  window.__TEST_STATE = state;
  console.log("[mock] 桥接已就绪：粘贴完整脚本运行；结束后读 __TEST_STATE");
  return "mock ready";
})();
```

### ② 粘贴完整适配脚本运行

### ③ 读回结果并交还给 agent

```js
JSON.stringify({
  notified: window.__TEST_STATE.notified,
  toasts: window.__TEST_STATE.toasts,
  courses: window.__TEST_STATE.courses,
  timeSlots: window.__TEST_STATE.timeSlots,
  config: window.__TEST_STATE.config,
});
```

### 比对清单（对照用户在教务系统里看到的真实课表，逐条过）

- [ ] 课程名 / 教师 / 地点无串位
- [ ] 星期（day）正确
- [ ] 起止节次正确；**连堂课未被拆分、未被错误合并**
- [ ] 周次正确：**单双周没反**、跳周/自定义周没遗漏
- [ ] 时间模板节次编号与起止时间，与课表页大节标注一致
- [ ] 学期配置（总周数/节时长/课间）合理
- [ ] `notified === true` 且 toasts 结尾是「导入成功」
- [ ] 抽一个非当前周（如第 1 周、最后一周）在教务页翻页核对

任一项不符 → 回 §4 补探测 / 修解析，重跑 ②③。全绿才进 §7。

---

## 7. 本地校验（全部通过才可提交）

在仓库根目录：

```bash
node --check resources/<SCHOOL_ID>/<s>.js          # 语法
python tests/test_warehouse_upstream_compat.py -v   # 上游兼容（CI 同款）
python scripts/build_search_index.py               # 仅当新增/改动 adapters.yaml、root_index.yaml 时：重生 index/search_index.yaml
python scripts/build_search_index.py --check       # 必须通过（CI 校验）
```

**提交卫生**：不提交 `school_index.pb`、抓包样本原始件、`.omx/`、编辑器缓存、任何凭证。

---

## 8. 发布入库

### 8.1 元数据文件

**新学校**需新增 `resources/<SCHOOL_ID>/adapters.yaml`（目录已存在则追加条目），字段参照 MKU 实例：

```yaml
# resources/MKU/adapters.yaml
adapters:
  - adapter_id: "MKU_01"
    adapter_name: "闽南科技学院教务系统"
    category: "BACHELOR_AND_ASSOCIATE"   # 枚举：BACHELOR_AND_ASSOCIATE / POSTGRADUATE / GENERAL_TOOL
    asset_js_path: "mku.js"
    import_url: "https://jwgl.mku.edu.cn/"
    maintainer: "<GitHub 用户名>"
    description: "适配<学校名><平台名>教务系统。登录教务系统后运行，<可选功能，如学期导入>，自动附带节次时间模板与学期配置。"
```

**新学校**还要在 `index/root_index.yaml` 登记（按 id 字母序插入）：

```yaml
  - id: "MKU"
    name: "闽南科技学院"
    initial: "M"
    resource_folder: "MKU"
```

### 8.2 提交与推送

```bash
python scripts/build_search_index.py            # 重生全局搜索索引（若 §8.1 动了 yaml）
git add resources/<SCHOOL_ID>/ index/root_index.yaml index/search_index.yaml
git commit -m "feat(适配): 新增 <学校名>(<SCHOOL_ID>) <平台> 教务课表导入适配"
```

- **fork 用户**：推到自己的 fork，向 `Mutx163/qingyu_warehouse` 开 PR（App 读这个 fork 的 main）。
- **维护者**：`git push origin HEAD:main`。网络 SSL handshake 偶发失败就重试。
- 合并后二进制发布（`school_index.pb` → `index-pb-release` 分支）由维护者手动触发 `.github/workflows/build-index.yml`，提交人无需操心。
- 可选：如需同步上游 `XingHeYuZhuan/shiguang_warehouse`，另行走上游贡献流程，不与本次适配混在同一提交。

---

## 9. 交付报告（发给用户）

```text
[学校] <名称>（<SCHOOL_ID>）
[平台] <平台名>（识别依据：<URL/特征>）
[参考] 抄自 <resources/REF/...>，差异：<改了什么>
[接口] 课表：<接口 URL + 参数>；周次/学期：<...>
[结果] 课程 N 条 / 时间模板 M 节 / 配置 {总周数, 节时长, 课间}
[测试] 注入测试通过，比对项：<逐条结果>；未覆盖项：<如历史学期开学日期留给 App>
[文件] resources/<SCHOOL_ID>/<s>.js、adapters.yaml（、root_index.yaml）
[提交] <commit>；<PR 链接 或 已推 main>
[下一步] 用户用轻屿开发版/自定义仓库做一次真实导入验证；发现问题回 issue/PR
```

再次强调红线：报告中不得包含任何账号、密码、Cookie、Token。