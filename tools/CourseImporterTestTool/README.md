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
3. 点击浏览器右上角扩展图标
4. 同步学校列表，选择已有学校或切换为“新建学校”
5. 填写学校与适配器元数据
6. 点击“抓取当前页面上下文”
7. 点击“生成适配指令”，复制给浏览器 AI / 其他模型
8. 将 AI 返回的 JavaScript 粘贴回扩展
9. 点击“运行当前脚本”反复测试
10. 工具会导出 `CourseTableExport.json` 供你检查结果

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
- 当前版本没有直接接管浏览器 AI，会走“复制提示词 → 外部 AI 生成 → 粘贴回扩展”的稳妥闭环
