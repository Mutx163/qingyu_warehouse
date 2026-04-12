# Contributing to qingyu_warehouse

感谢你为 `qingyu_warehouse` 贡献学校适配或脚本修复。

本仓库为适配资源仓库。浏览器扩展工作台用于 Alpha 阶段调试与验证，正式资源仍通过 `index/` 与 `resources/` 维护。

如果你是第一次参与，请先看：

- [快速开始：10 分钟做出第一个适配](./docs/QUICK_START.md)
- [脚本 API 与数据结构](./docs/SCRIPT_API.md)
- [提交前检查清单](./docs/ADAPTER_CHECKLIST.md)
- [仓库地图](./docs/REPOSITORY_MAP.md)

---

## 先选你的贡献类型

你准备提交的是：

1. 新增学校 / 工具适配
2. 修复已有学校脚本
3. 补充或修正索引信息
4. 协议兼容 / 仓库结构优化
5. 轻屿课表专用扩展
6. 文档、模板或测试工具改进

---

## 推荐流程：先 Alpha，再 Beta

### Alpha：浏览器扩展里验证脚本

第一次适配时，**不要一上来先改索引或资源目录**。

推荐先使用仓库内的浏览器扩展测试工具：

- [`tools/CourseImporterTestTool`](./tools/CourseImporterTestTool)

你只需要：

1. 打开目标教务网页并登录
2. 把自己的脚本替换到扩展目录里的 `school.js`
3. 点击扩展按钮执行测试
4. 在浏览器 F12 控制台看日志和错误
5. 下载导出的 `CourseTableExport.json` 检查结构

浏览器扩展工作台用于脚本调试、结果验证和提交流程辅助，不替代 `resources/` 正式资源目录。

### Beta：接入仓库并在 App 内测试

Alpha 跑通后，再做正式接入：

1. 如需新增学校，先更新 `index/root_index.yaml`
2. 在 `resources/<folder>/` 下创建或修改：
   - `adapters.yaml`
   - `*.js`
3. 使用轻屿课表开发版 + 自定义仓库进行真实导入测试
4. 验证通过后提交 PR

---

## 目录约定

通常你会改这些位置：

- `index/root_index.yaml`
- `resources/<folder>/adapters.yaml`
- `resources/<folder>/*.js`
- `docs/*.md`（如果你在补文档 / 模板 / API 说明）
- `tools/CourseImporterTestTool/*`（如果你在补测试工具能力）

请尽量遵守现有目录和命名方式，避免引入无必要的新层级。

目录职责如下：

- `tools/` 是调试工作台
- `resources/` 是最终交付物
- `index/` 是资源入口索引
- `docs/` 是贡献者文档

---

## 基本原则

- 优先保持与上游仓库结构兼容
- 一个提交尽量只做一类事情
- 不提交纯测试垃圾文件、临时抓包产物或个人环境文件
- 不提交账号、Cookie、Token、验证码样本等敏感信息
- 如果修改基于上游已有脚本，请注明来源与差异点
- 若改动影响轻屿当前脚本 API，请同步更新 `docs/SCRIPT_API.md`

---

## PR 前至少确认这些

- 能进入正确登录页
- 登录后能抓到课表数据
- 课程名 / 教师 / 地点 / 星期 / 节次 / 周次正确
- 单双周、自定义周、连堂课没有明显错误
- 若脚本输出了时间模板或课程配置，结构正确
- `adapters.yaml` 字段完整且可读
- 没有把测试用 `test.js`、账号密码或临时调试文件误提交

更完整清单见：

- [提交前检查清单](./docs/ADAPTER_CHECKLIST.md)

---

## Pull Request 建议写明

- 适配的是哪所学校 / 哪类系统
- 这次改动解决了什么问题
- 是否新增字段或轻屿专用行为
- 是否与上游兼容
- 在什么环境里测过（网页 / 轻屿开发版 / 自定义仓库）

---

## 关于测试工具

仓库内已经提供浏览器扩展测试工具，来源于上游 `shiguang_Tester` 并在下游仓库内保留维护。

当前扩展目录主要承担以下职责：

- 浏览器侧调试
- Bridge 模拟
- 结果预览
- PR 提交辅助

如果你增加了新的桥接方法或需要新的调试能力：

- 请同时考虑更新 `tools/CourseImporterTestTool`
- 并同步更新 `docs/SCRIPT_API.md`

这样后来的贡献者就不需要重复踩坑。

---

## 不建议提交的内容

- 临时抓包文件
- 包含账号密码 / Cookie / Token 的样本
- 与单个设备强绑定的调试文件
- 未整理的测试占位脚本
- 与本仓库目标无关的主应用代码
- `.omx/`、编辑器状态文件等本地运行产物

---

## 致谢

感谢上游仓库和所有适配贡献者的工作：

- [XingHeYuZhuan/shiguang_warehouse](https://github.com/XingHeYuZhuan/shiguang_warehouse)
- [XingHeYuZhuan/shiguang_Tester](https://github.com/XingHeYuZhuan/shiguang_Tester)
