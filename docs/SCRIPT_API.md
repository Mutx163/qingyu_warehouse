# 脚本 API 与数据结构

这份文档描述的是 **轻屿课表当前适配脚本可依赖的桥接能力**，同时也是仓库内浏览器扩展测试工具模拟的接口集合。

如果你新增了脚本桥接能力，请同步更新本文件。

---

## 调用方式

脚本里主要有两类对象：

- `AndroidBridge`：同步、轻提示 / 完成通知
- `window.AndroidBridgePromise`：异步、带返回值 / 需要校验的数据保存

---

## AndroidBridge

### `AndroidBridge.showToast(message)`

显示轻提示。

```js
AndroidBridge.showToast('开始抓取课表');
```

### `AndroidBridge.notifyTaskCompletion()`

通知任务完成。

在浏览器扩展里，这会结束当前测试会话，并把本次运行得到的课程 / 时间模板 / 学期配置整理回扩展内部预览面板。
注意：这条链路必须从扩展里点击“运行当前脚本”发起；如果你只是直接在 F12 控制台运行脚本，桥接层会判定为无效测试会话。

```js
AndroidBridge.notifyTaskCompletion();
```

---

## AndroidBridgePromise

### `showAlert(title, content, confirmText)`

显示确认弹窗。

```js
await window.AndroidBridgePromise.showAlert('提示', '抓取完成', '确定');
```

### `showPrompt(title, content, defaultValue, validatorFnName)`

显示输入框弹窗，可绑定一个脚本内校验函数名。

```js
function validateCode(input) {
  if (!input || !input.trim()) return '请输入分享码';
  return false;
}

const code = await window.AndroidBridgePromise.showPrompt(
  '输入分享码',
  '请输入分享码',
  '',
  'validateCode',
);
```

### `showSingleSelection(title, itemsJson, selectedIndex)`

显示单选列表。

```js
const index = await window.AndroidBridgePromise.showSingleSelection(
  '选择学期',
  JSON.stringify(['2024-2025-1', '2024-2025-2']),
  0,
);
```

### `saveImportedCourses(coursesJson)`

保存课程数组。

```js
await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
```

### `savePresetTimeSlots(timeSlotsJson)`

保存预设节次时间。

```js
await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
```

### `saveCourseConfig(configJson)`

保存学期配置。

```js
await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
```

---

# 数据结构

## 1. 课程 CourseJsonModel

最小必填字段：

- `name`
- `teacher`
- `position`
- `day`
- `weeks`

普通节次课程还需要：

- `startSection`
- `endSection`

如果是自定义时间课程：

- `isCustomTime: true`
- `customStartTime`
- `customEndTime`

### 示例：普通课程

```json
{
  "name": "高等数学",
  "teacher": "张老师",
  "position": "教101",
  "day": 1,
  "startSection": 1,
  "endSection": 2,
  "weeks": [1, 2, 3, 4, 5]
}
```

### 示例：自定义时间课程

```json
{
  "name": "晚自习",
  "teacher": "辅导员",
  "position": "教302",
  "day": 7,
  "isCustomTime": true,
  "customStartTime": "19:00",
  "customEndTime": "21:00",
  "weeks": [1, 2, 3, 4]
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `name` | 课程名 |
| `teacher` | 教师 |
| `position` | 上课地点 |
| `day` | 星期，通常 1-7 |
| `startSection` / `endSection` | 起止节次 |
| `weeks` | 周次数组，如 `[1,2,3]` |
| `isCustomTime` | 是否自定义时间课程 |
| `customStartTime` / `customEndTime` | 自定义开始/结束时间，`HH:mm` |

---

## 2. 节次时间 TimeSlotJsonModel

```json
{
  "number": 1,
  "startTime": "08:00",
  "endTime": "08:45"
}
```

字段：

| 字段 | 说明 |
|---|---|
| `number` | 节次编号 |
| `startTime` | 开始时间，`HH:mm` |
| `endTime` | 结束时间，`HH:mm` |

通常以数组形式传入：

```js
await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify([
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:55', endTime: '09:40' },
]));
```

---

## 3. 学期配置 CourseConfigJsonModel

当前常用字段：

- `semesterStartDate`
- `semesterTotalWeeks`
- `defaultClassDuration`
- `defaultBreakDuration`
- `firstDayOfWeek`

### 示例

```json
{
  "semesterStartDate": "2025-02-24",
  "semesterTotalWeeks": 20,
  "defaultClassDuration": 45,
  "defaultBreakDuration": 10,
  "firstDayOfWeek": 1
}
```

### 默认值

如果你不传某些字段，测试工具会按当前模型补默认值：

- `semesterStartDate: null`
- `semesterTotalWeeks: 20`
- `defaultClassDuration: 45`
- `defaultBreakDuration: 10`
- `firstDayOfWeek: 1`

---

## 推荐脚本执行顺序

建议大多数脚本按这个顺序写：

1. 识别页面 / 获取登录态
2. 抓取课程原始数据
3. 转换为 `courses`
4. 如有需要，再生成 `timeSlots` 和 `config`
5. 调用 `save...`
6. `notifyTaskCompletion()`

---

## 当前仓库里的参考实现

- `resources/GLOBAL_TOOLS/school.js`
- `resources/GLOBAL_TOOLS/test.js`
- `tools/CourseImporterTestTool/school.js`
- 各类现有学校脚本
