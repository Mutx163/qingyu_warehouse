// Run: node --test tests/test_cppu_adapter.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../resources/CPPU/cppu.js'), 'utf8');
const row = (overrides = {}) => ({
  KCMC: '示例课程', JS: '示例教师', DDMC: '教学楼101',
  SKRQ: '2026-09-15', JC: '01', MC: '2026年秋季学期', ...overrides
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function mockStore(rows, options = {}) {
  return {
    currentPage: 2, pageSize: 30, calls: [],
    getTotalCount() { return rows.length; },
    isLoading() { return false; },
    loadPage(page, { callback }) {
      this.calls.push(page);
      this.currentPage = page;
      const start = options.repeat ? 0 : (page - 1) * this.pageSize;
      const items = rows.slice(start, start + this.pageSize).map((data) => ({ get: (key) => data[key] }));
      queueMicrotask(() => callback(items, {}, page !== options.failPage));
    }
  };
}

async function load(options = {}) {
  const state = { courses: null, config: null, completed: false, toasts: [] };
  const context = {
    setTimeout, clearTimeout, console: { error() {} },
    document: { querySelector: () => options.store ? { id: 'V_JWBZK_PK_XSKBZHCX_jegridview' } : null },
    window: {
      Ext: { getCmp: () => ({ getStore: () => options.store }) },
      AndroidBridge: {
        showToast: (text) => state.toasts.push(text),
        notifyTaskCompletion: () => { state.completed = true; }
      },
      AndroidBridgePromise: {
        showAlert: async () => options.confirm !== false,
        showSingleSelection: async () => options.selection === undefined ? 0 : options.selection,
        showPrompt: async (title) => title === '学期总周数' ? '20' : options.startDate === undefined ? '2026-09-07' : options.startDate,
        saveCourseConfig: async (text) => { state.config = JSON.parse(text); },
        saveImportedCourses: async (text) => { state.courses = JSON.parse(text); }
      }
    }
  };
  vm.createContext(context);
  await vm.runInContext(source, context);
  return { context, state };
}

test('按日期计算周次、星期，合并跳周并保留调课地点', async () => {
  const { context } = await load();
  const courses = plain(context.cppuParseCourses([
    row(), row(), row({ SKRQ: '2026-09-29' }),
    row({ SKRQ: '2026-09-20', DDMC: '教学楼202' })
  ], '2026-09-07'));
  assert.equal(courses.length, 2);
  assert.deepEqual(courses[0], {
    name: '示例课程', teacher: '示例教师', position: '教学楼101',
    day: 2, startSection: 1, endSection: 2, weeks: [2, 4]
  });
  assert.equal(courses[1].day, 7);
  assert.equal(courses[1].position, '教学楼202');
});

test('教务大节代码 01–05 转换为真实两节连堂，未知代码停止导入', async () => {
  const { context } = await load();
  const mapping = [['01', 1, 2], ['02', 3, 4], ['03', 5, 6], ['04', 7, 8], ['05', 9, 10]];
  for (const [code, start, end] of mapping) {
    const courses = plain(context.cppuParseCourses([row({ JC: code })], '2026-09-07'));
    assert.deepEqual([courses[0].startSection, courses[0].endSection], [start, end]);
  }
  assert.throws(() => context.cppuSections('06'), /大节代码/);
  assert.throws(() => context.cppuSections('00'), /大节代码/);
});

test('跨年、闰日以及不连续节次', async () => {
  const { context } = await load();
  const courses = plain(context.cppuParseCourses([row({ SKRQ: '2028-02-29', JC: '1-2,5,6' })], '2027-12-27'));
  assert.deepEqual(courses.map((course) => [course.startSection, course.endSection, course.weeks]), [[1, 2, [10]], [5, 6, [10]]]);
  assert.equal(context.cppuDate('2026-02-30'), null);
  assert.ok(context.cppuValidateStartDate('2026-09-08'));
  assert.throws(() => context.cppuParseCourses([row()], '2026-09-21'), /开学日期/);
  assert.throws(() => context.cppuParseCourses([row({ JC: '2-1' })], '2026-09-07'), /节次/);
  assert.throws(() => context.cppuParseCourses([row({ SKRQ: '' })], '2026-09-07'), /上课日期/);
});

test('218 条记录读取所有八页，恢复原页并通过标准桥接保存', async () => {
  const rows = Array.from({ length: 218 }, (_, index) => row({ KCMC: '示例课程' + index }));
  const store = mockStore(rows);
  const { state } = await load({ store });
  assert.deepEqual(store.calls, [1, 2, 3, 4, 5, 6, 7, 8, 2]);
  assert.equal(store.currentPage, 2);
  assert.equal(state.courses.length, 218);
  assert.ok(state.courses.every((course) => course.startSection === 1 && course.endSection === 2));
  assert.equal(state.completed, true);
  assert.deepEqual(state.config, { semesterStartDate: '2026-09-07', semesterTotalWeeks: 20, firstDayOfWeek: 1 });
});

test('失败分页与重复分页不保存部分课表', async () => {
  const rows = Array.from({ length: 70 }, (_, index) => row({ KCMC: '示例课程' + index }));
  for (const options of [{ failPage: 2 }, { repeat: true }]) {
    const store = mockStore(rows, options);
    const { state } = await load({ store });
    assert.equal(state.courses, null);
    assert.equal(state.completed, false);
    assert.equal(store.currentPage, 2);
    assert.match(state.toasts.at(-1), /导入失败/);
  }
});

test('取消日期输入及未进入课表时不保存数据', async () => {
  for (const options of [{ store: mockStore([row()]), startDate: null }, {}]) {
    const { state } = await load(options);
    assert.equal(state.courses, null);
    assert.equal(state.config, null);
    assert.equal(state.completed, false);
  }
});

test('混合学期只导入选择的学期', async () => {
  const store = mockStore([row({ MC: '另一个学期' }), row({ KCMC: '目标学期课程' })]);
  const { state } = await load({ store, selection: 1 });
  assert.equal(state.completed, true);
  assert.equal(state.courses.length, 1);
  assert.equal(state.courses[0].name, '目标学期课程');
});

test('无课与错误开学日期均不保存', async () => {
  for (const options of [
    { store: mockStore([]) },
    { store: mockStore([row()]), startDate: '2026-09-08' },
    { store: mockStore([row()]), startDate: '2026-10-05' }
  ]) {
    const { state } = await load(options);
    assert.equal(state.courses, null);
    assert.equal(state.completed, false);
  }
});
