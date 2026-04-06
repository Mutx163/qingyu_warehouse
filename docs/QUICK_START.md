# 快速开始：10 分钟做出第一个适配

这份文档是给第一次来适配学校教务系统的人准备的。

如果你会：

- 浏览器 F12 调试
- 基本 JavaScript
- 看网络请求 / HTML / 接口返回

那你就可以开始了。

---

## 先理解两阶段流程

### Alpha：先在浏览器扩展里跑通脚本

目标：

- 先证明“这所学校能抓到课表”
- 先把数据转成正确 JSON
- 不要一上来就改索引和仓库结构

使用目录：

- [`../tools/CourseImporterTestTool`](../tools/CourseImporterTestTool)

### Beta：再接入仓库和轻屿 App

当 Alpha 跑通后，再：

1. 新增 / 修改 `resources/<folder>/*.js`
2. 维护 `adapters.yaml`
3. 需要的话再更新 `index/root_index.yaml`
4. 用轻屿开发版 + 自定义仓库进行真实导入验证

---

## Alpha 阶段怎么做

### 1. 安装浏览器扩展

以 Chrome / Edge 为例：

1. 打开扩展管理页（如 `chrome://extensions/`）
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择本仓库里的 `tools/CourseImporterTestTool` 文件夹

### 2. 打开目标教务系统并登录

先确认你能在浏览器里正常进入学校教务网页。

### 3. 把测试脚本替换到扩展里

先改这里：

- `tools/CourseImporterTestTool/school.js`

这是扩展测试入口。

### 4. 点击扩展按钮执行测试

扩展会：

- 注入你的脚本
- 在页面中模拟轻屿的 `AndroidBridge` / `AndroidBridgePromise`
- 把导出的课程 / 时间段 / 配置保存成 `CourseTableExport.json`

### 5. 打开 F12 看日志

重点看：

- 是否能拿到课程原始数据
- 是否有登录失效 / 跨域 / 页面结构变化
- JSON 是否通过验证

---

## 第一版脚本建议只做这几件事

1. 找到课表数据来源
2. 解析成课程数组
3. 调用 `saveImportedCourses()`
4. 成功后调用 `notifyTaskCompletion()`

第一版不一定非要马上处理：

- 时间模板
- 学期配置
- 复杂弹窗交互

这些可以第二版再补。

---

## 最小脚本骨架

```js
async function main() {
  try {
    AndroidBridge.showToast('开始抓取课表');

    const courses = [
      {
        name: '高等数学',
        teacher: '张老师',
        position: '教101',
        day: 1,
        startSection: 1,
        endSection: 2,
        weeks: [1, 2, 3, 4, 5],
      },
    ];

    await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(courses),
    );

    AndroidBridge.showToast('导入数据已生成');
    AndroidBridge.notifyTaskCompletion();
  } catch (error) {
    await window.AndroidBridgePromise.showAlert(
      '导入失败',
      String(error?.message || error),
      '确定',
    );
  }
}

main();
```

完整字段说明见：

- [脚本 API 与数据结构](./SCRIPT_API.md)

---

## Beta 阶段怎么做

当 Alpha 跑通后：

### 1. 新增学校（如果仓库里还没有）

更新：

- `index/root_index.yaml`

### 2. 创建资源目录

例如：

```text
resources/CQCST/
  adapters.yaml
  cqcst_01.js
```

### 3. 维护 adapters.yaml

至少要写清：

- `adapter_id`
- `adapter_name`
- `category`
- `asset_js_path`
- `import_url`
- `maintainer`
- `description`

### 4. App 内测试

在轻屿开发版中：

- 配置自定义仓库地址
- 拉取自己的 fork
- 进入“导入课程 > 教务系统导入”验证真实导入流程

---

## 推荐调试顺序

1. 先确认网页能登录
2. 再确认课表数据在哪
3. 先只导课程
4. 再补时间模板 / 学期配置
5. 最后再处理复杂边缘情况（单双周、自定义周、合班、拆分课程等）

---

## 如果不知道从哪抄

优先参考：

- 同类教务系统的现有脚本
- `resources/GLOBAL_TOOLS/school.js`
- `resources/GLOBAL_TOOLS/test.js`
- `tools/CourseImporterTestTool/school.js`

如果你的学校是：

- 正方
- URP
- 青果
- 超星
- 其他统一教务框架

通常都能从已有脚本里找相似案例。

---

## 提交前

请至少再过一遍：

- [提交前检查清单](./ADAPTER_CHECKLIST.md)

