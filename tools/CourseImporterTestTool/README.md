# CourseImporterTestTool

这是为 `qingyu_warehouse` 贡献者准备的浏览器扩展适配助手。

来源：

- 上游仓库：`XingHeYuZhuan/shiguang_Tester`
- 引入基础版本提交：`8e4f07c4408ee5fe01c27a3c3aeb1fe0e2416001`

用途：

- 在 **Alpha 阶段** 直接用浏览器调试教务脚本
- 在线同步适配学校列表并读取某校已有适配器
- 可视化填写学校 / 适配器元数据，生成待提交文件预览
- 一键抓取当前网页上下文，生成可复制给 AI 的适配提示词
- 粘贴 AI 返回的脚本后，直接在当前页面反复测试
- 在网页里模拟轻屿当前支持的 Bridge 接口
- 使用 GitHub PAT 在扩展内直接发起 fork / branch / PR

## 安装

1. 打开 Chrome / Edge 扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择本目录 `tools/CourseImporterTestTool`

## 使用

### 基础调试流

1. 打开目标教务网页并登录
2. 如刚安装扩展，请先刷新当前网页一次
3. 点击浏览器右上角扩展图标，打开右侧 **Side Panel 工作台**
4. 在“目标”页选择已有学校或新建学校，并补全元数据
5. 进入“脚本”页，复制外部 AI 指令或直接使用内置 AI 生成
6. 在同一页继续编辑 / 粘贴 / 导出脚本草稿
7. 进入“验证”页运行脚本，查看提取结果、时间模板和课表预览
8. 如果结果不对，直接在“验证”页反馈给 AI 修正，进度会显示在顶部 AI 面板
9. 确认验证通过后，再到“提交”页登录 GitHub 并发起 PR

### 扩展内提交 PR

1. 准备一个 GitHub fine-grained PAT
2. 至少授予仓库 `Contents` 与 `Pull requests` 的读写权限
3. 在扩展里点击“验证并保存 Token”
4. 填好 PR 标题 / 描述后，点击“提交到 fork 并发起 PR”
5. 扩展会自动：
   - 确认或创建你的 fork
   - 从默认分支切新分支
   - 更新 `index/root_index.yaml` / `resources/*/adapters.yaml` / 脚本文件
   - 向上游仓库创建 PR

## 适配建议

- 第一步先只让 `saveImportedCourses()` 成功
- 第二步再补 `savePresetTimeSlots()` 和 `saveCourseConfig()`
- 如果桥接能力不够，请在本目录和 `docs/SCRIPT_API.md` 一起补充
- 当前版本同时支持“复制提示词 → 外部 AI”与“内置 AI 直接生成”两条路径
- 扩展主界面现在默认运行在浏览器侧边栏（Side Panel），更适合持续调试、看流式输出和对比结果
