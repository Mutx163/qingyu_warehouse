/**
 * 重庆城市科技学院 · 强智教务适配（API 版）
 *
 * 登录进入教务系统后，在任意页面执行即可：
 *   fetch /cqdxcskjxy_jsxsd/xskb/xskb_list.do
 * 无需先点开「学期理论课表」页面。
 *
 * 实机验证（2026-07）：
 * - 从学生个人中心可成功 GET 课表 HTML
 * - 默认自动使用当前学期（selected option），不弹学期选择/确认框
 * - 仅 URL 带 ?pickSemester=1 时才弹学期选择（调试用）
 * - 课表块结构：div.kbcontent + font[title=老师/上课地点] + 周次在班级 span 内
 *
 * 注意：fetch + DOMParser 得到的是离线 DOM，innerText 往往不按 <br> 换行。
 * 课名/字段解析必须优先用 textContent + 按 <br> 分行，不能依赖 innerText 首行。
 */

/**
 * 若当前页已经是「学期理论课表」且表格有课，直接用当前 document 解析。
 * 这与页面旧版成功路径一致，可避免 fetch 默认学期拿回空表。
 */
function tryExtractCoursesFromLivePage() {
  try {
    if (typeof document === 'undefined') {
      return [];
    }
    const table =
      document.getElementById('kbtable') ||
      document.getElementById('timetable') ||
      document.querySelector('table.table_border') ||
      document.querySelector('.table_border');
    if (!table) {
      return [];
    }
    const tableText = table.innerText || table.textContent || '';
    if (!/星期|周一/.test(tableText)) {
      return [];
    }
    // 有「节」字才像真有课；空课表页不走 live 路径
    if (!tableText.includes('节')) {
      return [];
    }
    return extractCoursesFromDoc(document);
  } catch (error) {
    console.warn('[CQCST] live page parse failed', error);
    return [];
  }
}

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
  // 与页面旧版一致：中间允许任意杂质（班级名、空格等）
  // 例如：1-16(全部)[01-02节] / 2-17(周)[05-06节] / 1-8(单)xxx[01-02节]
  const match =
    source.match(
      /([\d,\-]+)\s*(?:\((单|双|全部|周|.*?)\))?\s*.*?\[([\d\-]+)节\]/,
    ) ||
    source.match(/([\d,\-]+)\s*(?:\((单|双)\))?\s*\[([\d\-]+)节\]/);
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
  const cleanCandidate = (raw) =>
    String(raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const looksContaminated = (candidate) => {
    if (!candidate) return true;
    // 混入节次/班级/选课等元数据，或异常过长
    if (/\[.*节\]/.test(candidate) || candidate.includes('选课人数')) {
      return true;
    }
    if (candidate.includes('班') && candidate.length > 12) {
      return true;
    }
    if (candidate.length > 40) {
      return true;
    }
    return false;
  };

  // 1) 直接文本节点（正常强智结构：课名在第一个 text node）
  for (const node of blockRoot.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const fromTextNode = cleanCandidate(node.textContent);
      if (fromTextNode && !looksContaminated(fromTextNode)) {
        return fromTextNode;
      }
      break;
    }
  }

  // 2) 按 <br> 取第一行（离线 DOM 下 innerText 不可靠）
  const html = blockRoot.innerHTML || '';
  const firstHtmlLine = cleanCandidate(
    html.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, ' '),
  );
  if (firstHtmlLine && !looksContaminated(firstHtmlLine)) {
    return firstHtmlLine;
  }

  // 3) 最后兜底：整段 textContent 截到时间串之前
  const fullText = cleanCandidate(blockRoot.textContent || blockRoot.innerText || '');
  const timeMatch = fullText.match(
    /([\d,\-]+)\s*(?:\((单|双|全部|周)\))?\s*\[([\d\-]+)节\]/,
  );
  if (timeMatch && typeof timeMatch.index === 'number' && timeMatch.index > 0) {
    return cleanCandidate(fullText.slice(0, timeMatch.index));
  }
  return firstHtmlLine || fullText;
}

function parseKbcontentBlock(htmlBlock, day, courses, courseSet) {
  if (!htmlBlock || !htmlBlock.trim() || htmlBlock.trim() === '&nbsp;') {
    return;
  }
  const temp = document.createElement('div');
  temp.innerHTML = htmlBlock;

  const name = extractCourseName(temp);
  const teacherFont = findFontByTitle(temp, ['老师', '教师']);
  const positionFont = findFontByTitle(temp, ['上课地点', '教室', '教学楼']);
  const classFont = findFontByTitle(temp, ['班级']);
  const weekFont = findFontByTitle(temp, ['周次(节次)']);

  // 离线 DOM 用 textContent，避免 innerText 在未布局文档中异常
  const teacher = teacherFont
    ? (teacherFont.textContent || teacherFont.innerText || '').trim()
    : '未知';
  const position = positionFont
    ? (positionFont.textContent || positionFont.innerText || '').trim()
    : '待定';

  // 重庆城市科技：周次/节次通常嵌在「班级」font 的 span 文本中
  let timeText = '';
  if (weekFont) {
    timeText = weekFont.textContent || weekFont.innerText || '';
  } else if (classFont) {
    timeText = classFont.textContent || classFont.innerText || '';
  } else {
    timeText = temp.textContent || temp.innerText || '';
  }

  const parsedTime = parseWeekAndSection(timeText);
  if (!parsedTime) {
    // font 取时间失败：按 <br> 文本行回退（旧版 innerText 路径）
    const fallbackLines = String(htmlBlock || '')
      .split(/<br\s*\/?>/i)
      .map((line) =>
        line
          .replace(/<[^>]+>/g, ' ')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean);
    if (fallbackLines.length) {
      // 复用 parseTextCell 的块逻辑：构造伪 cell 太重，直接内联最小回退
      const joined = fallbackLines.join('\n');
      const timeParsed = parseWeekAndSection(joined);
      if (timeParsed && timeParsed.weeks.length) {
        let fallbackName = (fallbackLines[0] || '')
          .replace(/\[[^\]]*\]/g, '')
          .trim();
        if (fallbackLines.length === 1) {
          const timeMatch = fallbackLines[0].match(
            /([\d,\-]+)\s*(?:\((单|双|全部|周)\))?\s*\[([\d\-]+)节\]/,
          );
          if (timeMatch && typeof timeMatch.index === 'number') {
            fallbackName = fallbackLines[0]
              .slice(0, timeMatch.index)
              .replace(/\[[^\]]*\]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
        }
        let fallbackTeacher = '未知';
        let fallbackPosition = '待定';
        const timeLineIndex = fallbackLines.findIndex((line) =>
          line.includes('节'),
        );
        if (timeLineIndex > 0) {
          for (let index = 1; index < timeLineIndex; index++) {
            const line = fallbackLines[index];
            if (/^\[[^\]]+\]$/.test(line)) continue;
            if (line.includes('班') || line.includes('选课人数')) continue;
            if (line.includes('节')) continue;
            fallbackTeacher = line;
          }
        }
        if (timeLineIndex >= 0 && timeLineIndex + 1 < fallbackLines.length) {
          const maybePosition = fallbackLines[timeLineIndex + 1];
          if (
            maybePosition &&
            !maybePosition.includes('节') &&
            !maybePosition.includes('班')
          ) {
            fallbackPosition = maybePosition;
          }
        }
        if (fallbackName) {
          pushCourse(courses, courseSet, {
            name: fallbackName,
            teacher: fallbackTeacher,
            position: fallbackPosition,
            day,
            startSection: timeParsed.startSection,
            endSection: timeParsed.endSection,
            weeks: timeParsed.weeks,
          });
        }
      }
    }
    return;
  }

  // 若课名仍混入老师/地点（无 <br> 粘连时），剥离已识别字段
  let cleanName = (name || '').trim();
  // 课名异常：含节次/过长 → 强制按 <br> 第一行重取
  if (
    !cleanName ||
    cleanName.includes('节') ||
    cleanName.includes('选课人数') ||
    cleanName.length > 40
  ) {
    const firstLine = String(htmlBlock || '')
      .split(/<br\s*\/?>/i)[0]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .trim();
    if (firstLine && firstLine.length < cleanName.length) {
      cleanName = firstLine;
    }
  }
  // 剥离已识别的老师/地点（可在中间或末尾）
  if (teacher && teacher !== '未知' && cleanName.includes(teacher)) {
    cleanName = cleanName.split(teacher)[0].trim();
  }
  if (position && position !== '待定' && cleanName.includes(position)) {
    cleanName = cleanName.split(position)[0].trim();
  }
  // 剥离时间串及之后内容
  cleanName = cleanName
    .replace(/[\d,\-]+\s*(?:\((?:单|双|全部|周)\))?\s*\[[\d\-]+节\].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 剥离「计科2301班 / xxx班 选课人数」一类尾巴
  const classMetaIndex = cleanName.search(
    /[\u4e00-\u9fa5A-Za-z0-9]*\d{2,}[\u4e00-\u9fa5A-Za-z0-9]*班/,
  );
  if (classMetaIndex > 0) {
    cleanName = cleanName.slice(0, classMetaIndex).trim();
  } else if (cleanName.includes('选课人数')) {
    cleanName = cleanName.split('选课人数')[0].trim();
  }
  if (!cleanName) {
    return;
  }

  pushCourse(courses, courseSet, {
    name: cleanName,
    teacher,
    position,
    day,
    startSection: parsedTime.startSection,
    endSection: parsedTime.endSection,
    weeks: parsedTime.weeks,
  });
}

function parseTextCell(cell, day, courses, courseSet) {
  // 优先用 innerHTML 按 <br> 分行。DOMParser 离线文档的 innerText 常无换行，
  // 整格会变成 lines[0]，导致课名塞进老师/班级/地点。
  const cellHtml = (cell.innerHTML || '').replace(/\u00a0/g, ' ');
  const hasSection =
    cellHtml.includes('节') ||
    (cell.textContent || '').includes('节') ||
    (cell.innerText || '').includes('节');
  if (!hasSection) {
    return;
  }

  const htmlBlocks = cellHtml.split(/-{5,}/);
  htmlBlocks.forEach((blockHtml) => {
    let lines = blockHtml
      .split(/<br\s*\/?>/i)
      .map((line) =>
        line
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean);

    // 无 <br> 时再尝试 textContent / innerText 的真实换行
    if (lines.length < 2) {
      const rawText = (
        cell.textContent ||
        cell.innerText ||
        ''
      )
        .replace(/\u00a0/g, ' ')
        .trim();
      const textBlocks = rawText.split(/-{5,}/);
      // 当前块对应的文本：粗略用整段回退
      const textBlock = textBlocks.length === htmlBlocks.length
        ? textBlocks[htmlBlocks.indexOf(blockHtml)] || rawText
        : rawText;
      lines = textBlock
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length < 3) {
        const spaced = textBlock
          .split(/\s{2,}/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (spaced.length > lines.length) {
          lines = spaced;
        }
      }
    }

    if (!lines.length) {
      return;
    }

    const parsedTime = parseWeekAndSection(lines.join('\n'));
    if (!parsedTime) {
      return;
    }

    let name = (lines[0] || '').replace(/\[[^\]]*\]/g, '').trim();
    // 单行粘连：课名取时间串之前
    if (lines.length === 1) {
      const timeMatch = lines[0].match(
        /([\d,\-]+)\s*(?:\((单|双|全部|周)\))?\s*\[([\d\-]+)节\]/,
      );
      if (timeMatch && typeof timeMatch.index === 'number') {
        name = lines[0]
          .slice(0, timeMatch.index)
          .replace(/\[[^\]]*\]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    let teacher = '未知';
    let position = '待定';
    const timeLineIndex = lines.findIndex(
      (line) => line.includes('节') || parseWeekAndSection(line),
    );
    if (timeLineIndex > 0) {
      for (let index = 1; index < timeLineIndex; index++) {
        const line = lines[index];
        if (/^\[[^\]]+\]$/.test(line)) {
          continue;
        }
        if (line.includes('班') || line.includes('选课人数')) {
          continue;
        }
        if (line.includes('节')) {
          continue;
        }
        teacher = line;
      }
    }
    if (timeLineIndex >= 0 && timeLineIndex + 1 < lines.length) {
      const maybePosition = lines[timeLineIndex + 1];
      if (
        maybePosition &&
        !maybePosition.includes('节') &&
        !maybePosition.includes('班') &&
        !maybePosition.includes('选课人数')
      ) {
        position = maybePosition;
      }
    }

    if (teacher && teacher !== '未知' && name.endsWith(teacher)) {
      name = name.slice(0, -teacher.length).trim();
    }
    if (position && position !== '待定' && name.endsWith(position)) {
      name = name.slice(0, -position.length).trim();
    }
    if (!name) {
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
  });
}

function extractCoursesFromDoc(doc) {
  const table =
    doc.getElementById('kbtable') ||
    doc.getElementById('timetable') ||
    doc.querySelector('table.table_border') ||
    doc.querySelector('.table_border') ||
    Array.from(doc.querySelectorAll('table')).find((item) =>
      /星期|周一/.test(
        item.textContent || item.innerText || '',
      ),
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

  // 过程中不再 toast，进度由 App 快捷导入 UI 展示。
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
    // 1) 当前页已是课表且有数据 → 与页面旧版同一路径（日志已证明可解析 54 门）
    let courses = tryExtractCoursesFromLivePage();

    // 2) 否则 fetch 课表页（任意教务页快捷导入）
    if (!courses.length) {
      let doc = await fetchTimetableDoc();
      const semesterResult = await maybeSelectSemester(doc);
      if (semesterResult.cancelled) {
        AndroidBridge.showToast('已取消导入');
        return;
      }
      doc = semesterResult.doc;
      courses = extractCoursesFromDoc(doc);

      // 3) GET 默认学期可能空表：用页面 selected 学期再 POST 一次
      if (!courses.length) {
        const semesterInfo = readSemesterSelect(doc);
        if (
          semesterInfo &&
          semesterInfo.values[semesterInfo.defaultIndex]
        ) {
          const semesterValue = semesterInfo.values[semesterInfo.defaultIndex];
          const semesterDoc = await fetchTimetableDoc(semesterValue);
          courses = extractCoursesFromDoc(semesterDoc);
        }
      }
    }

    if (!courses.length) {
      AndroidBridge.showToast('未解析到课程，请换学期试试或确认本学期有课');
      return;
    }

    // 不弹「正在导入…」进度 toast，避免与 App 完成弹窗叠层。
    // 也不再弹确认框（宏回放无录制 confirm 时会误当成取消）。

    const saved = await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(courses),
    );
    if (!saved) {
      AndroidBridge.showToast('保存课程失败');
      return;
    }

    // 成功结果由 App 完成弹窗展示，这里不再 toast，避免与「导入完成」sheet 叠两层。
    AndroidBridge.notifyTaskCompletion();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    AndroidBridge.showToast('导入失败: ' + message);
    console.error(error);
  }
}

runImportFlow();
