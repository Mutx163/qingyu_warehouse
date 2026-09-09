/* qingyu-compat-shim v2:auto-generated, do not edit */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.shiguangBridge && window.AndroidBridge) window.shiguangBridge = window.AndroidBridge;
  if (!window.shiguangBridgePromise && window.AndroidBridgePromise) window.shiguangBridgePromise = window.AndroidBridgePromise;
})();

// 绵阳师范学院正方教务系统课表适配脚本
// 页面为 frameset 结构，课表主体在 iframe[name="Frame1"] 的 #kbtable 中。

function showToast(message) {
  try {
    const bridge = window.shiguangBridge || window.AndroidBridge;
    if (bridge && typeof bridge.showToast === 'function') {
      bridge.showToast(message);
    }
  } catch (error) {
    console.error('[MYSY] showToast failed:', error);
  }
}

function getScheduleDocument() {
  if (document.querySelector && document.querySelector('#kbtable')) {
    return document;
  }

  const frames = [
    document.querySelector('iframe[name="Frame1"]'),
    document.querySelector('frame[name="Frame1"]')
  ];

  for (const frame of frames) {
    if (!frame) continue;
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      if (doc && doc.querySelector('#kbtable')) return doc;
    } catch (error) {
      console.warn('[MYSY] Unable to access Frame1 document:', error);
    }
  }

  try {
    const namedFrame = window.frames && window.frames['Frame1'];
    if (namedFrame && namedFrame.document && namedFrame.document.querySelector('#kbtable')) {
      return namedFrame.document;
    }
  } catch (error) {
    console.warn('[MYSY] Unable to access named Frame1:', error);
  }

  return null;
}

function waitForScheduleTable(timeoutMs) {
  const timeout = timeoutMs || 15000;
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const doc = getScheduleDocument();
      if (doc && doc.querySelector('#kbtable')) {
        resolve(doc);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(getScheduleDocument());
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

function parseWeeks(weekStr) {
  if (!weekStr) return [];

  const cleaned = String(weekStr)
    .replace(/\[[^\]]*节[^\]]*\]/g, '')
    .replace(/\s+/g, '');

  const weeks = [];
  const parts = cleaned.split(/[,，]/).filter(Boolean);

  for (const part of parts) {
    const parityMatch = part.match(/[（(](单|双)[）)]/);
    const parity = parityMatch ? parityMatch[1] : null;
    const numeric = part
      .replace(/[（(](单|双)[）)]/g, '')
      .replace(/[（(]周[）)]/g, '')
      .replace(/周/g, '');
    const match = numeric.match(/^(\d+)(?:[-~到](\d+))?$/);

    if (!match) continue;

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    for (let week = start; week <= end; week++) {
      if (parity === '单' && week % 2 === 0) continue;
      if (parity === '双' && week % 2 === 1) continue;
      weeks.push(week);
    }
  }

  return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

function parseSectionRange(text) {
  const match = String(text || '').match(/\[(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?节\]/);
  if (!match) return null;

  return {
    start: Number(match[1]),
    end: Number(match[2] || match[1])
  };
}

function getDirectText(element) {
  const parts = [];

  for (const node of element.childNodes) {
    if (node.nodeType !== 3) continue;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }

  return parts.join(' ').trim();
}

function getTitledText(element, title) {
  const target = element.querySelector(`font[title="${title}"]`);
  if (!target) return '';
  return (target.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseCourseDiv(div) {
  const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const idParts = (div.getAttribute('id') || '').split('_');
  const day = Number(idParts[1]) || 0;
  const name = getDirectText(div);
  const teacher = getTitledText(div, '老师') || '待定';
  const position = getTitledText(div, '教室') || '待定';
  const timeText = getTitledText(div, '周次(节次)');
  const weeks = parseWeeks(timeText);

  if (!name || weeks.length === 0 || day < 1 || day > 7) return null;

  const section = parseSectionRange(timeText);
  const course = {
    name: name,
    teacher: teacher,
    position: position,
    day: day,
    startSection: section ? section.start : 0,
    endSection: section ? section.end : 0,
    weeks: weeks
  };

  return course;
}

function extractCourses(doc) {
  const table = doc.querySelector('#kbtable');
  if (!table) return [];

  const courses = [];
  const seen = new Set();

  table.querySelectorAll('div.kbcontent').forEach((div) => {
    const course = parseCourseDiv(div);
    if (!course) return;

    const key = JSON.stringify(course);
    if (seen.has(key)) return;
    seen.add(key);
    courses.push(course);
  });

  courses.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    if (a.startSection !== b.startSection) return a.startSection - b.startSection;
    return a.name.localeCompare(b.name);
  });

  return courses;
}

function toMinutes(hhmm) {
  const parts = String(hhmm).split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function toHHMM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// 教务系统口径兜底时间表：13 小节（与 #kbtable 的 th[rowspan] 大节拆分结果一致）
// 仅当页面存在 #kbtable 但读不到时间块时使用，保证「教务系统时间表」选项始终是教务口径
const JWC_FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:50', endTime: '09:35' },
    { number: 3, startTime: '09:55', endTime: '10:40' },
    { number: 4, startTime: '10:45', endTime: '11:30' },
    { number: 5, startTime: '11:35', endTime: '12:20' },
    { number: 6, startTime: '14:00', endTime: '14:45' },
    { number: 7, startTime: '14:50', endTime: '15:35' },
    { number: 8, startTime: '15:55', endTime: '16:40' },
    { number: 9, startTime: '16:45', endTime: '17:30' },
    { number: 10, startTime: '17:35', endTime: '18:20' },
    { number: 11, startTime: '19:00', endTime: '19:45' },
    { number: 12, startTime: '19:50', endTime: '20:35' },
    { number: 13, startTime: '20:40', endTime: '21:25' }
];

// 实际上课时间（学校实际作息）：11 节，每节 45 分钟
// 绵阳师范学院实际作息与教务系统课表时间不一致：
//   · 教务课表按 13 小节编号，实际上午只上 4 节（教务第 5 节 11:35-12:20 无课）
//   · 上午第 1 节实际 08:15 开始（教务为 08:00）
//   · 教务第 13 节（20:40-21:25）不在实际作息内
// 选用本表时脚本会把课程节次由教务口径换算为实际作息口径（见 JWC_TO_ACTUAL_SECTION）
const ACTUAL_TIME_SLOTS = [
    { number: 1, startTime: '08:15', endTime: '09:00' },
    { number: 2, startTime: '09:05', endTime: '09:50' },
    { number: 3, startTime: '10:20', endTime: '11:05' },
    { number: 4, startTime: '11:10', endTime: '11:55' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:50', endTime: '15:35' },
    { number: 7, startTime: '16:05', endTime: '16:50' },
    { number: 8, startTime: '16:55', endTime: '17:40' },
    { number: 9, startTime: '17:45', endTime: '18:30' },
    { number: 10, startTime: '19:00', endTime: '19:45' },
    { number: 11, startTime: '19:50', endTime: '20:35' }
];

// 教务课表节次 → 实际上课时间节次
// （教务第 5 节 11:35-12:20 实际无课；教务第 13 节 20:40-21:25 不在实际作息内）
const JWC_TO_ACTUAL_SECTION = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  11: 10,
  12: 11
};

// 选用「实际上课时间」时，把课程节次从教务口径换算为实际作息口径；
// 位于教务第 5/13 节（实际作息无对应节次）的课程保留原节次并提示。
function remapCoursesToActualSections(courses) {
  let unmapped = 0;

  const remapped = courses.map((course) => {
    const start = JWC_TO_ACTUAL_SECTION[course.startSection];
    const end = JWC_TO_ACTUAL_SECTION[course.endSection];

    if (start === undefined || end === undefined) {
      unmapped += 1;
      return course;
    }

    return Object.assign({}, course, { startSection: start, endSection: end });
  });

  if (unmapped > 0) {
    console.warn(`[MYSY] ${unmapped} 门课程位于教务第 5/13 节，实际作息无对应节次，已保留教务节次`);
    showToast(`${unmapped} 门课程位于实际作息之外的节次，已保留教务节次`);
  }

  return remapped;
}

function generateTimeSlots(doc) {
  const fallback = JWC_FALLBACK_TIME_SLOTS;

  const table = doc.querySelector('#kbtable');
  if (!table) return fallback;

  const blocks = [];
  table.querySelectorAll('tr th[rowspan]').forEach((th) => {
    const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
    if (!match) return;

    const rowspan = Number(th.getAttribute('rowspan')) || 1;
    blocks.push({
      rowspan: rowspan,
      start: `${match[1]}:${match[2]}`,
      end: `${match[3]}:${match[4]}`
    });
  });

  if (blocks.length === 0) return fallback;

  const slots = [];
  let number = 1;
  const classDuration = 45;
  const breakDuration = 5;

  for (const block of blocks) {
    const count = Math.max(1, block.rowspan);
    let cursor = toMinutes(block.start);

    for (let i = 0; i < count; i++) {
      const start = cursor;
      const end = start + classDuration;
      slots.push({
        number: number,
        startTime: toHHMM(start),
        endTime: toHHMM(end)
      });
      number++;
      cursor = end + (i < count - 1 ? breakDuration : 0);
    }
  }

  return slots.length > 0 ? slots : fallback;
}

// 桥接层回传的选项序号可能是 number / 字符串 / null，统一归一化（-1 = 取消）
function normalizeSelectionIndex(raw, optionCount) {
  if (raw === null || raw === undefined || raw === '') return -1;
  const index = Number(raw);
  if (!Number.isFinite(index) || index < 0 || index >= optionCount) return -1;
  return index;
}

// 让用户在「教务系统课表时间」和「实际上课时间」之间二选一
async function chooseTimeSlots(pageSlots) {
  const options = [
    `教务系统课表时间（${pageSlots.length} 节）`,
    `实际上课时间（${ACTUAL_TIME_SLOTS.length} 节，上午 4 节）`
  ];

  try {
    const bridge = window.shiguangBridgePromise || window.AndroidBridgePromise;
    if (!bridge || typeof bridge.showSingleSelection !== 'function') {
      return { useActual: false, slots: pageSlots };
    }

    const raw = await bridge.showSingleSelection(
      '选择课表使用的时间表',
      JSON.stringify(options),
      0
    );
    const index = normalizeSelectionIndex(raw, options.length);

    if (index === 1) {
      showToast('已使用实际上课时间');
      return { useActual: true, slots: ACTUAL_TIME_SLOTS };
    }
    if (index < 0) showToast('未选择，已使用教务系统课表时间');
    return { useActual: false, slots: pageSlots };
  } catch (error) {
    console.warn('[MYSY] 时间表选择弹窗不可用，改用教务系统课表时间:', error);
    return { useActual: false, slots: pageSlots };
  }
}

async function saveCourses(courses) {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.saveImportedCourses !== 'function') {
      throw new Error('saveImportedCourses bridge not found');
    }
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    return true;
  } catch (error) {
    console.error('[MYSY] save courses failed:', error);
    showToast(`课表保存失败: ${error.message}`);
    return false;
  }
}

async function saveTimeSlots(slots) {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.savePresetTimeSlots !== 'function') {
      throw new Error('savePresetTimeSlots bridge not found');
    }
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    return true;
  } catch (error) {
    console.error('[MYSY] save time slots failed:', error);
    showToast(`时间模板保存失败: ${error.message}`);
    return false;
  }
}

async function saveCourseConfig() {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.saveCourseConfig !== 'function') {
      return;
    }
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks: 20,
      defaultClassDuration: 45,
      defaultBreakDuration: 5,
      firstDayOfWeek: 1
    }));
  } catch (error) {
    console.warn('[MYSY] save course config failed:', error);
  }
}

async function runImportFlow() {
  console.log('[MYSY] 开始导入绵阳师范学院课表...');
  showToast('正在检查课表页面...');

  const doc = await waitForScheduleTable(15000);
  if (!doc || !doc.querySelector('#kbtable')) {
    showToast('未找到课表，请先打开“学期理论课表”并确认已加载');
    return;
  }

  const courses = extractCourses(doc);
  if (courses.length === 0) {
    showToast('未找到已安排上课时间的课程');
    return;
  }

  try {
    const confirmed = await window.shiguangBridgePromise.showAlert(
      '教务系统课表导入',
      `检测到 ${courses.length} 门课程，是否导入？`,
      '确认导入'
    );
    if (!confirmed) {
      showToast('已取消导入');
      return;
    }
  } catch (error) {
    console.warn('[MYSY] confirmation dialog unavailable:', error);
  }

  const timeChoice = await chooseTimeSlots(generateTimeSlots(doc));
  const coursesToSave = timeChoice.useActual
    ? remapCoursesToActualSections(courses)
    : courses;

  if (!(await saveCourses(coursesToSave))) return;

  if (!(await saveTimeSlots(timeChoice.slots))) return;

  await saveCourseConfig();

  showToast(`课表导入成功，共导入 ${courses.length} 门课程`);
  console.log(`[MYSY] 成功导入 ${courses.length} 门课程`);

  try {
    if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
      window.shiguangBridge.notifyTaskCompletion();
    }
  } catch (error) {
    console.warn('[MYSY] notifyTaskCompletion failed:', error);
  }
}

if (/mtc\.edu\.cn$/i.test(window.location.hostname)) {
  setTimeout(runImportFlow, 800);
} else {
  showToast('请先在绵阳师范学院教务系统打开课表页面');
}
