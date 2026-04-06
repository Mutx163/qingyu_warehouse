# qingyu_warehouse

轻屿课表（Qingyu）使用的 **教务适配资源仓库**。

这个仓库面向两类人：

- **普通维护者**：维护学校索引、适配脚本和元数据
- **技术用户 / 适配贡献者**：给自己学校新增或修复教务导入脚本

如果你是第一次来，**不要先去改 `root_index.yaml`**。建议先看：

- [快速开始：10 分钟做出第一个适配](./docs/QUICK_START.md)
- [脚本 API 与数据结构](./docs/SCRIPT_API.md)
- [提交前检查清单](./docs/ADAPTER_CHECKLIST.md)
- [贡献指南](./CONTRIBUTING.md)

---

## 与上游仓库的关系

本仓库 fork 自：

- [XingHeYuZhuan/shiguang_warehouse](https://github.com/XingHeYuZhuan/shiguang_warehouse)

同时也同步引入了上游适配测试工具思路，并在下游仓库内提供了浏览器扩展测试目录，方便技术用户直接开始 Alpha 阶段适配。

目标是：

1. 尽量兼容上游资源结构与适配协议
2. 为轻屿课表提供可独立维护的适配仓
3. 在必要时支持轻屿侧扩展与更适合本项目的贡献流程

---

## 仓库里有什么

```text
index/
  root_index.yaml                  # 学校 / 工具总索引

resources/
  <resource_folder>/
    adapters.yaml                  # 当前学校 / 工具的适配器配置
    *.js                           # 适配脚本

resources/GLOBAL_TOOLS/
  school.js                        # 组件 / 数据结构示例
  test.js                          # 适配脚本占位模板（推荐 Beta 阶段测试用）

tools/CourseImporterTestTool/
  manifest.json                    # 浏览器扩展清单
  school.js                        # Alpha 阶段测试脚本入口
  injected_bridge.js               # 浏览器里模拟 App Bridge
  ...

docs/
  QUICK_START.md                   # 新人上手教程
  SCRIPT_API.md                    # 轻屿当前支持的脚本 API / 数据结构
  ADAPTER_CHECKLIST.md             # 提交前检查表
```

---

## 推荐适配流程（重要）

### Alpha：先在浏览器扩展里把脚本跑通

适合第一次适配的人。目标是：

- 先确认能不能登录 / 抓到课表
- 先确认能不能把数据转成正确 JSON
- 不要一上来就改索引和仓库结构

请直接使用：

- [`tools/CourseImporterTestTool`](./tools/CourseImporterTestTool)

它是一个可加载到 Chrome / Edge 的浏览器扩展。你只需要把自己的适配代码替换它里面的 `school.js`，登录目标教务网页后点击扩展按钮即可测试。

### Beta：再接入仓库和 App 真机验证

当 Alpha 阶段已经能稳定导出正确课程数据后，再做：

1. 在 `index/root_index.yaml` 登记学校 / 工具
2. 在 `resources/<folder>/` 下创建 `adapters.yaml` 与正式脚本
3. 用轻屿课表开发版 / 自定义仓库地址做 App 内真实导入测试
4. 验证通过后再提交 PR

---

## 如果你是技术用户，最短路径是

1. 看 [快速开始](./docs/QUICK_START.md)
2. 安装浏览器扩展测试工具
3. 在扩展的 `school.js` 里写自己的脚本
4. 对照 [脚本 API](./docs/SCRIPT_API.md) 输出课程 JSON
5. 跑通后再把脚本放进 `resources/<folder>/` 并补索引

---

## 仓库规则

- 优先保持与上游结构兼容
- 不提交账号、Cookie、Token、抓包原始敏感数据
- 不在主分支长期保留临时测试脚本
- 如果引用或修改上游已有脚本，请保留来源信息
- 如果增加轻屿专用扩展行为，请在文档或 PR 中写明

---

## 适用对象

本仓库主要面向：

- 轻屿课表维护者
- 学校适配脚本贡献者
- 会抓包 / 网页调试 / JavaScript，想给自己学校补教务导入的人

如果你只是普通用户，请前往轻屿课表主应用仓库：

- <https://github.com/Mutx163/mikcb>

---

## 更多链接

- 上游适配仓：<https://github.com/XingHeYuZhuan/shiguang_warehouse>
- 上游适配教程：<https://github.com/XingHeYuZhuan/shiguangschedule/wiki/%E5%A6%82%E4%BD%95%E9%80%82%E9%85%8D%E6%95%99%E5%8A%A1>
- 上游测试工具：<https://github.com/XingHeYuZhuan/shiguang_Tester>

