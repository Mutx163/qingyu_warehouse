/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 中国人民警察大学智慧教务（JE / Ext JS）。
// 字段、分页 API 根据保存的课表明细及其配套 e-all / je-core 脚本核对。
// 复用课表组件的只读查询，保留当前筛选条件；不会提交或修改教务数据。
// SKRQ 为具体上课日期，XQ 是校区而非星期，MC 为学期名称。
// JC 是大节代码：01→1–2节，02→3–4节，03→5–6节，04→7–8节，05→9–10节。
// 页面没有提供可靠的开学日期和节次时间，不硬编码学校作息。

function cppuDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00:00)?$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === match[0].slice(0, 10) ? date : null;
}

function cppuValidateStartDate(value) {
  const date = cppuDate(value);
  return date && date.getUTCDay() === 1 ? false : '请输入第一教学周的周一日期，格式 YYYY-MM-DD';
}

function cppuValidateWeeks(value) {
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 60
    ? false : '学期总周数应为 1–60 的整数';
}

function cppuFindStore() {
  const panel = document.querySelector('[id="V_JWBZK_PK_XSKBZHCX_jegridview"]');
  const grid = panel && window.Ext && window.Ext.getCmp(panel.id);
  const store = grid && grid.getStore();
  if (!store || typeof store.loadPage !== 'function' || typeof store.getTotalCount !== 'function') {
    throw new Error('请登录教务系统，进入“我的课程表 → 我的课表 → 课表明细”，等待列表加载完成后再导入');
  }
  if (store.isLoading && store.isLoading()) throw new Error('课表正在加载，请稍后重试');
  if (store.buffered) throw new Error('当前课表使用了不同的分页模式，请反馈适配维护者');
  return store;
}

function cppuLoadPage(store, page) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('读取课表超时，请检查网络或重新登录')), 20000);
    try {
      store.loadPage(page, {
        callback: function (records, operation, success) {
          clearTimeout(timer);
          if (!success) return reject(new Error('读取课表失败，请刷新页面重新登录后再试'));
          // 只提取导入所需字段，不保留学号、班级等个人标识。
          resolve(records.map((record) => {
            const row = {};
            ['KCMC', 'JS', 'DDMC', 'SKRQ', 'JC', 'MC'].forEach((field) => {
              row[field] = String(record.get(field) || '').trim();
            });
            return row;
          }));
        }
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function cppuReadAllRows(store) {
  const originalPage = store.currentPage || 1;
  const size = Number(store.pageSize);
  if (!Number.isInteger(size) || size < 1) throw new Error('无法识别课表分页大小');
  const rows = [];
  const seenPages = new Set();
  try {
    const first = await cppuLoadPage(store, 1);
    const total = Number(store.getTotalCount());
    if (!Number.isInteger(total) || total < 1) throw new Error('当前筛选条件下没有课程，请检查学期和搜索条件');
    const pages = Math.ceil(total / size);
    for (let page = 1; page <= pages; page++) {
      window.shiguangBridge.showToast('正在读取课表：第 ' + page + '/' + pages + ' 页');
      const batch = page === 1 ? first : await cppuLoadPage(store, page);
      if (Number(store.getTotalCount()) !== total || Number(store.pageSize) !== size) {
        throw new Error('课表列表发生变化，请保持筛选条件不变后重试');
      }
      if (batch.length !== Math.min(size, total - rows.length)) {
        throw new Error('课表分页数据不完整，已停止导入，请重新加载课表后重试');
      }
      const signature = JSON.stringify(batch);
      if (seenPages.has(signature)) throw new Error('课表重复返回同一页，已停止导入以避免漏课');
      seenPages.add(signature);
      rows.push(...batch);
    }
    return rows;
  } finally {
    if (store.currentPage !== originalPage) {
      try {
        await cppuLoadPage(store, originalPage);
      } catch (error) {
        // 已完整取回的数据仍可导入，提示用户手动恢复列表即可。
        window.shiguangBridge.showToast('未能恢复原列表页，请稍后手动刷新课表');
      }
    }
  }
}

function cppuSections(value) {
  // 代码与显示节次的关系已由真实课表页面逐项核对。
  const code = String(value).trim();
  if (/^0\d$/.test(code)) {
    const block = Number(code);
    if (block < 1 || block > 5) throw new Error('未知大节代码：' + code + '，请反馈适配维护者');
    return [[block * 2 - 1, block * 2]];
  }
  const text = String(value).replace(/\s|第|节/g, '').replace(/[—–~～至]/g, '-').replace(/[，、]/g, ',');
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text)) throw new Error('无法识别节次：' + value);
  const sections = new Set();
  text.split(',').forEach((part) => {
    const ends = part.split('-').map(Number);
    const start = ends[0], end = ends.length === 2 ? ends[1] : start;
    if (start < 1 || end < start || end > 30) throw new Error('节次范围异常：' + value);
    for (let n = start; n <= end; n++) sections.add(n);
  });
  const groups = [];
  Array.from(sections).sort((a, b) => a - b).forEach((section) => {
    const last = groups[groups.length - 1];
    if (last && section === last[1] + 1) last[1] = section;
    else groups.push([section, section]);
  });
  return groups;
}

function cppuParseCourses(rows, startDate) {
  const start = cppuDate(startDate);
  if (!start || start.getUTCDay() !== 1) throw new Error('第一教学周起始日期必须是周一');
  const merged = new Map();
  rows.forEach((row, index) => {
    const date = cppuDate(row.SKRQ);
    if (!date || !row.KCMC) throw new Error('第 ' + (index + 1) + ' 条课程缺少有效的名称或上课日期');
    const week = Math.floor((date - start) / 604800000) + 1;
    if (week < 1 || week > 60) throw new Error('课程日期与开学日期不符，请检查所选学期和第一周周一日期');
    cppuSections(row.JC).forEach(([startSection, endSection]) => {
      const course = {
        name: row.KCMC, teacher: row.JS || '', position: row.DDMC || '',
        day: date.getUTCDay() || 7, startSection, endSection
      };
      const key = JSON.stringify(course);
      if (!merged.has(key)) merged.set(key, { ...course, weeks: [] });
      const weeks = merged.get(key).weeks;
      if (!weeks.includes(week)) weeks.push(week);
    });
  });
  return Array.from(merged.values()).map((course) => ({ ...course, weeks: course.weeks.sort((a, b) => a - b) }));
}

async function cppuRunImportFlow() {
  const bridge = window.shiguangBridge;
  const bridgePromise = window.shiguangBridgePromise;
  const store = cppuFindStore();
  const confirmed = await bridgePromise.showAlert(
    '中国人民警察大学课表导入',
    '请先清除课表明细中的搜索条件，并筛选所需学期。将读取当前列表的全部分页，请勿在读取时操作列表。\n需要填写该学期第一教学周的周一日期；节次作息请在 App 内设置。',
    '开始读取'
  );
  if (!confirmed) return bridge.showToast('导入已取消');
  let rows = await cppuReadAllRows(store);
  const semesters = Array.from(new Set(rows.map((row) => row.MC)));
  if (semesters.some((semester) => !semester)) throw new Error('课表缺少学期名称，请先在教务系统筛选单个学期');
  if (semesters.length > 1) {
    const selected = await bridgePromise.showSingleSelection('选择导入学期', JSON.stringify(semesters), 0);
    if (selected == null || selected < 0 || selected >= semesters.length) return bridge.showToast('导入已取消');
    rows = rows.filter((row) => row.MC === semesters[selected]);
  }
  const startDate = await bridgePromise.showPrompt(
    '第一教学周周一日期',
    rows[0].MC + '：请输入第一教学周的周一日期（YYYY-MM-DD），不是第一节课的日期。',
    '', 'cppuValidateStartDate'
  );
  if (startDate == null) return bridge.showToast('导入已取消');
  const courses = cppuParseCourses(rows, String(startDate).trim());
  const maxWeek = Math.max(...courses.flatMap((course) => course.weeks));
  const weeks = await bridgePromise.showPrompt(
    '学期总周数', '课程最晚排到第 ' + maxWeek + ' 周，请确认学期总周数。',
    String(Math.max(20, maxWeek)), 'cppuValidateWeeks'
  );
  if (weeks == null) return bridge.showToast('导入已取消');
  if (cppuValidateWeeks(weeks) || Number(weeks) < maxWeek) throw new Error('学期总周数不能小于课程的最后一周');
  await bridgePromise.saveCourseConfig(JSON.stringify({
    semesterStartDate: String(startDate).trim(), semesterTotalWeeks: Number(weeks), firstDayOfWeek: 1
  }));
  await bridgePromise.saveImportedCourses(JSON.stringify(courses));
  bridge.showToast('导入成功：' + rows.length + ' 条上课记录，合并为 ' + courses.length + ' 条课程；请核对作息时间');
  bridge.notifyTaskCompletion();
}

(async () => {
  try {
    await cppuRunImportFlow();
  } catch (error) {
    console.error('中国人民警察大学课表导入失败：', error.message);
    window.shiguangBridge.showToast('导入失败：' + error.message);
  }
})();
