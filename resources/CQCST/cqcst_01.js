/**
 * 重庆城市科技学院 · 强智教务适配（API 版）
 *
 * 登录进入教务系统后，在任意页面执行即可：
 *   fetch /cqdxcskjxy_jsxsd/xskb/xskb_list.do
 * 无需先点开「学期理论课表」页面。
 *
 * 实机验证（2026-07）：
 * - 从学生个人中心可成功 GET 课表 HTML
 * - 默认自动使用当前学期（selected option），不弹学期选择/确认框\n * - 仅 URL 带 ?pickSemester=1 时才弹学期选择（调试用）
 * - 课表块结构：div.kbcontent + font[title=老师/上课地点] + 周次在班级 span 内
 */

const XSKB_LIST_PATH = '/cqdxcskjxy_jsxsd/xskb/xskb_list.do';

function ensureBrowserTestBridge() {
  if (typeof window.AndroidBridgePromise !== 'undefined') {
    return;
  }
  window.AndroidBridgePromise = {
    showAlert: async () => true,
    showSingleSelection: async (_title, _itemsJson, defaultIndex = 0) => {
      const index = Number(defaultIndex);
      return Number.isFinite(index) ? index : 0;
    },
    saveImportedCourses: async (json) => {
      const courses = JSON.parse(json);
      console.log('[CQCST] courses =', courses.length, courses);
      console.table(courses);
      return true;
    },
  };
  window.AndroidBridge = {
    showToast: (message) => console.log('[Toast]', message),
    notifyTaskCompletion: () => console.log('[Done]'),
  };
}

function parseWeeks(weeksStr, oddEvenHint) {
  const weeks = [];
  if (!weeksStr) {
    return weeks;
  }
  const pure = String(weeksStr).split('(')[0].trim();
  const oddEven = oddEvenHint || '';
  pure.split(',').forEach((segment) => {
    const part = segment.trim();
    if (!part) {
      return;
    }
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-');
      const start = parseInt(startRaw, 10);
      const end = parseInt(endRaw, 10);
      if (isNaN(start) || isNaN(end)) {
        return;
      }
      for (let week = start; week <= end; week++) {
        if (oddEven === '单' && week % 2 === 0) continue;
        if (oddEven === '双' && week % 2 !== 0) continue;
        weeks.push(week);
      }
      return;
    }
    const week = parseInt(part, 10);
    if (isNaN(week)) {
      return;
    }
    if (oddEven === '单' && week % 2 === 0) {
      return;
    }
    if (oddEven === '双' && week % 2 !== 0) {
      return;
    }
    weeks.push(week);
  });
  return [...new Set(weeks)].sort((left, right) => left - right);
}

/**
 * 解析强智周次节次文本，例如：
 *  14-15(全部)[01-02-03-04节]
 *  7(全部)[01-02节]
 *  1-8(单)[01-02节]
 */
function parseWeekAndSection(text) {
  const source = String(text || '').replace(/\u00a0/g, ' ');
  const match = source.match(
    /([\d,\-]+)\s*(?:\((单|双|全部|周)\))?\s*\[([\d\-]+)节\]/,
  );
  if (!match) {
    return null;
  }

  const weeksStr = match[1];
  const oddEven = match[2] === '单' || match[2] === '双' ? match[2] : '';
  const sectionRaw = match[3] || '';
  if (!sectionRaw) {
    return null;
  }

  const sectionParts = sectionRaw
    .split('-')
    .map((value) => parseInt(value, 10))
    .filter((value) => !isNaN(value));
  if (!sectionParts.length) {
    return null;
  }

  return {
    weeks: parseWeeks(weeksStr, oddEven),
    startSection: sectionParts[0],
    endSection: sectionParts[sectionParts.length - 1],
  };
}

function findFontByTitle(root, titles) {
  const fonts = root.querySelectorAll('font');
  for (const font of fonts) {
    const title = (font.getAttribute('title') || '').trim();
    if (titles.includes(title)) {
      return font;
    }
  }
  return null;
}

function pushCourse(courses, courseSet, course) {
  if (
    !course.name ||
    !course.day ||
    !course.startSection ||
    !course.weeks ||
    !course.weeks.length
  ) {
    return;
  }
  const uniqueKey = [
    course.name,
    course.day,
    course.startSection,
    course.endSection,
    course.weeks.join(','),
    course.teacher || '',
    course.position || '',
  ].join('|');
  if (courseSet.has(uniqueKey)) {
    return;
  }
  courseSet.add(uniqueKey);
  courses.push(course);
}

function extractCourseName(blockRoot) {
  for (const node of blockRoot.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      return node.textContent
        .trim()
        .replace(/\[[^\]]*\]/g, '')
        .trim();
    }
  }
  const firstLine = (blockRoot.innerText || '').split('\n')[0] || '';
  return firstLine.replace(/\[[^\]]*\]/g, '').trim();
}

function parseKbcontentBlock(htmlBlock, day, courses, courseSet) {
  if (!htmlBlock || !htmlBlock.trim() || htmlBlock.trim() === '&nbsp;') {
    return;
  }
  const temp = document.createElement('div');
  temp.innerHTML = htmlBlock;

  const name = extractCourseName(temp);
  const teacherFont = findFontByTitle(temp, ['老师', '教师']);
  const positionFont = findFontByTitle(temp, ['上课地点', '教室']);
  const classFont = findFontByTitle(temp, ['班级']);
  const weekFont = findFontByTitle(temp, ['周次(节次)']);

  const teacher = teacherFont ? teacherFont.innerText.trim() : '未知';
  const position = positionFont ? positionFont.innerText.trim() : '待定';

  // 重庆城市科技：周次/节次通常嵌在「班级」font 的 span 文本中
  let timeText = '';
  if (weekFont) {
    timeText = weekFont.innerText || '';
  } else if (classFont) {
    timeText = classFont.innerText || '';
  } else {
    timeText = temp.innerText || '';
  }

  const parsedTime = parseWeekAndSection(timeText);
  if (!parsedTime) {
    return;
  }

  pushCourse(courses, courseSet, {
    name,
    teacher,
    position,
    day,
    startSection: parsedTime.startSection,
    endSection: parsedTime.endSection,
    weeks: parsedTime.weeks,
  });
}

function parseTextCell(cell, day, courses, courseSet) {
  const rawText = (cell.innerText || '').replace(/\u00a0/g, ' ').trim();
  if (!rawText || !rawText.includes('节')) {
    return;
  }
  rawText.split(/-{5,}/).forEach((block) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }
    const name = lines[0].replace(/\[[^\]]*\]/g, '').trim();
    const parsedTime = parseWeekAndSection(lines.join('\n'));
    if (!parsedTime) {
      return;
    }
    let teacher = '未知';
    let position = '待定';
    const timeLineIndex = lines.findIndex((line) => line.includes('节'));
    if (timeLineIndex > 0) {
      for (let index = 1; index < timeLineIndex; index++) {
        const line = lines[index];
        if (/^\[[^\]]+\]$/.test(line)) {
          continue;
        }
        if (line.includes('班') || line.includes('选课人数')) {
          continue;
        }
        teacher = line;
      }
    }
    if (timeLineIndex >= 0 && timeLineIndex + 1 < lines.length) {
      const maybePosition = lines[timeLineIndex + 1];
      if (maybePosition && !maybePosition.includes('节')) {
        position = maybePosition;
      }
    }
    pushCourse(courses, courseSet, {
      name,
      teacher,
      position,
      day,
      startSection: parsedTime.startSection,
      endSection: parsedTime.endSection,
      weeks: parsedTime.weeks,
    });
  });
}

function extractCoursesFromDoc(doc) {
  const table =
    doc.getElementById('kbtable') ||
    doc.getElementById('timetable') ||
    doc.querySelector('table.table_border') ||
    doc.querySelector('.table_border') ||
    Array.from(doc.querySelectorAll('table')).find((item) =>
      /星期|周一/.test(item.innerText || ''),
    );

  if (!table) {
    throw new Error('接口返回中未找到课表表格，请确认已登录教务系统');
  }

  const courses = [];
  const courseSet = new Set();
  const rows = table.querySelectorAll('tr');

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex].querySelectorAll('td, th');
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      // 倒数第 7 列=周一 ... 倒数第 1 列=周日（兼容左侧节次列）
      const day = 7 - (cells.length - 1 - cellIndex);
      if (day < 1 || day > 7) {
        continue;
      }

      const cell = cells[cellIndex];
      const kbBlocks = cell.querySelectorAll('div.kbcontent');
      const beforeCount = courses.length;

      if (kbBlocks.length) {
        kbBlocks.forEach((div) => {
          const rawHtml = (div.innerHTML || '').trim();
          rawHtml.split(/-{5,}/).forEach((block) => {
            parseKbcontentBlock(block, day, courses, courseSet);
          });
        });
      }

      if (courses.length === beforeCount) {
        parseTextCell(cell, day, courses, courseSet);
      }
    }
  }

  return courses;
}

async function fetchTimetableDoc(semesterValue) {
  let response;
  if (semesterValue) {
    const body = new URLSearchParams({
      xnxq01id: semesterValue,
      zc: '',
      demo: '',
      jx0404id: '',
      cj0701id: '',
    });
    response = await fetch(XSKB_LIST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'include',
    });
  } else {
    response = await fetch(XSKB_LIST_PATH, {
      method: 'GET',
      credentials: 'include',
    });
  }

  if (!response.ok) {
    throw new Error('课表请求失败 HTTP ' + response.status);
  }

  const html = await response.text();
  if (
    html.includes('用户登录') &&
    !html.includes('kbtable') &&
    !html.includes('星期')
  ) {
    throw new Error('登录已失效，请重新登录教务后再导入');
  }
  return new DOMParser().parseFromString(html, 'text/html');
}

function readSemesterSelect(doc) {
  const selectElem =
    doc.getElementById('xnxq01id') ||
    doc.querySelector('select[name="xnxq01id"]');
  if (!selectElem) {
    return null;
  }

  const labels = [];
  const values = [];
  const options = Array.from(selectElem.querySelectorAll('option'));
  options.forEach((option) => {
    labels.push((option.innerText || option.textContent || '').trim());
    values.push((option.value || '').trim());
  });
  if (!labels.length) {
    return null;
  }

  let defaultIndex = 0;
  const byAttribute = options.findIndex(
    (option) => option.hasAttribute('selected') || option.selected === true,
  );
  const bySelectedIndex =
    typeof selectElem.selectedIndex === 'number' && selectElem.selectedIndex >= 0
      ? selectElem.selectedIndex
      : -1;
  const currentValue = (selectElem.value || '').trim();
  const byValue = currentValue
    ? values.findIndex((value) => value === currentValue)
    : -1;

  if (byAttribute >= 0) {
    defaultIndex = byAttribute;
  } else if (bySelectedIndex >= 0) {
    defaultIndex = bySelectedIndex;
  } else if (byValue >= 0) {
    defaultIndex = byValue;
  }

  return { labels, values, defaultIndex };
}

/**
 * 快捷导入场景默认使用当前学期，不弹窗。
 * 仅当 URL 带 ?pickSemester=1 时才让用户选择（手动调试用）。
 */
async function maybeSelectSemester(doc) {
  const semesterInfo = readSemesterSelect(doc);
  if (!semesterInfo) {
    return { doc, changed: false };
  }

  const { labels, values, defaultIndex } = semesterInfo;
  const allowPick =
    typeof location !== 'undefined' &&
    /(?:^|[?&])pickSemester=1(?:&|$)/.test(location.search || '');

  if (
    !allowPick ||
    typeof window.AndroidBridgePromise?.showSingleSelection !== 'function'
  ) {
    return {
      doc,
      changed: false,
      semesterLabel: labels[defaultIndex],
    };
  }

  const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
    '请选择要导入的学期',
    JSON.stringify(labels),
    defaultIndex,
  );

  // Bridge 可能返回 index 或选项文本
  let resolvedIndex = defaultIndex;
  if (typeof selectedIndex === 'number' && selectedIndex >= 0) {
    resolvedIndex = selectedIndex;
  } else if (typeof selectedIndex === 'string') {
    const byValue = values.indexOf(selectedIndex);
    const byLabel = labels.indexOf(selectedIndex);
    if (byValue >= 0) resolvedIndex = byValue;
    else if (byLabel >= 0) resolvedIndex = byLabel;
  }

  if (resolvedIndex === defaultIndex) {
    return {
      doc,
      changed: false,
      semesterLabel: labels[resolvedIndex],
    };
  }

  AndroidBridge.showToast('正在获取 [' + labels[resolvedIndex] + '] 课表...');
  const nextDoc = await fetchTimetableDoc(values[resolvedIndex]);
  return {
    doc: nextDoc,
    changed: true,
    semesterLabel: labels[resolvedIndex],
  };
}

async function runImportFlow() {
  ensureBrowserTestBridge();

  try {
    AndroidBridge.showToast('正在通过接口获取课表...');

    let doc = await fetchTimetableDoc();
    const semesterResult = await maybeSelectSemester(doc);
    if (semesterResult.cancelled) {
      AndroidBridge.showToast('已取消导入');
      return;
    }
    doc = semesterResult.doc;

    const courses = extractCoursesFromDoc(doc);
    if (!courses.length) {
      AndroidBridge.showToast('未解析到课程，请换学期试试或确认本学期有课');
      return;
    }

    // 快捷导入 / 宏回放：不要再弹确认框。
    // App 在 macro 模式下若没有录制过 confirm 响应，会把 showAlert 解析成 false，
    // 导致脚本提前退出且不调用 saveImportedCourses，最终超时「未返回课程数据」。
    if (semesterResult.semesterLabel) {
      AndroidBridge.showToast(
        '正在导入 ' +
          semesterResult.semesterLabel +
          ' 共 ' +
          courses.length +
          ' 条课程...',
      );
    } else {
      AndroidBridge.showToast('正在导入 ' + courses.length + ' 条课程...');
    }

    const saved = await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(courses),
    );
    if (!saved) {
      AndroidBridge.showToast('保存课程失败');
      return;
    }

    AndroidBridge.showToast('成功导入 ' + courses.length + ' 条课程');
    AndroidBridge.notifyTaskCompletion();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    AndroidBridge.showToast('导入失败: ' + message);
    console.error(error);
  }
}

runImportFlow();
