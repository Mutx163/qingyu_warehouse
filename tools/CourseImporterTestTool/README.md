# CourseImporterTestTool

这是为 `qingyu_warehouse` 贡献者准备的浏览器扩展测试工具。

来源：

- 上游仓库：`XingHeYuZhuan/shiguang_Tester`
- 引入基础版本提交：`8e4f07c4408ee5fe01c27a3c3aeb1fe0e2416001`

用途：

- 在 **Alpha 阶段** 直接用浏览器调试教务脚本
- 无需先编译 App，也无需先更新仓库索引
- 在网页里模拟轻屿当前支持的 Bridge 接口

## 安装

1. 打开 Chrome / Edge 扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择本目录 `tools/CourseImporterTestTool`

## 使用

1. 打开目标教务网页并登录
2. 修改本目录下的 `school.js`
3. 点击浏览器右上角扩展图标
4. 点击“开始测试”
5. 打开 F12 看日志
6. 工具会导出 `CourseTableExport.json` 供你检查结果

## 适配建议

- 第一步先只让 `saveImportedCourses()` 成功
- 第二步再补 `savePresetTimeSlots()` 和 `saveCourseConfig()`
- 如果桥接能力不够，请在本目录和 `docs/SCRIPT_API.md` 一起补充

