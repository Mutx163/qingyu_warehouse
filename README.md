# qingyu_warehouse

轻屿课表（Qingyu）使用的教务适配资源仓库。

仓库包含三类内容：

- `index/` 负责学校与工具索引
- `resources/` 负责正式适配脚本与元数据
- `tools/CourseImporterTestTool/` 负责浏览器侧调试、验证和提交流程
- `docs/` 负责新人上手、脚本 API 和提交流程说明

## 这个仓库适合谁

- 轻屿课表维护者：维护索引、资源结构和兼容协议
- 学校适配贡献者：新增或修复某个学校 / 教务系统的导入脚本
- 技术用户：会网页调试、抓包、JavaScript，想给自己学校补导入

如果你只是普通用户，要使用课程导入能力，请前往轻屿课表主应用仓库：

- <https://github.com/Mutx163/mikcb>

## 建议阅读顺序

首次参与时，不建议直接修改 `index/root_index.yaml`。建议按以下顺序阅读：

1. [快速开始：10 分钟做出第一个适配](./docs/QUICK_START.md)
2. [脚本 API 与数据结构](./docs/SCRIPT_API.md)
3. [提交前检查清单](./docs/ADAPTER_CHECKLIST.md)
4. [贡献指南](./CONTRIBUTING.md)
5. [仓库地图](./docs/REPOSITORY_MAP.md)

## 仓库范围

- `index/`：学校与工具索引
- `resources/`：正式适配脚本与元数据
- `tools/CourseImporterTestTool/`：浏览器侧调试、验证与提交流程辅助工具

浏览器扩展工作台用于 Alpha 阶段调试与验证。正式适配结果仍通过 `resources/<folder>/` 和 `index/root_index.yaml` 维护。

## 仓库里有什么

```text
index/
  root_index.yaml
  # 学校 / 工具总索引

resources/
  <resource_folder>/
    adapters.yaml
    *.js
  # 正式适配资源：适配器元数据 + 导入脚本

resources/GLOBAL_TOOLS/
  school.js
  test.js
  # 通用示例、模板和工具脚本

tools/CourseImporterTestTool/
  manifest.json
  popup.html
  popup.js
  background.js
  content-script.js
  injected_bridge.js
  # 浏览器扩展工作台：目标、脚本、验证、提交

docs/
  QUICK_START.md
  SCRIPT_API.md
  ADAPTER_CHECKLIST.md
  REPOSITORY_MAP.md
  # 上手、协议、检查表和仓库说明
```

## 推荐工作流

### Alpha：先用浏览器扩展把脚本跑通

适用于首次适配或需要快速验证网页登录导入流程的场景。

使用目录：

- [`tools/CourseImporterTestTool`](./tools/CourseImporterTestTool)

当前扩展工作台已经承接了几件关键事情：

- 选择已有学校或创建当前测试目标
- 生成、粘贴、编辑当前脚本草稿
- 在当前网页环境里运行脚本
- 模拟轻屿当前支持的 Bridge 接口
- 预览课程、时间模板、课表结果
- 整理待提交的资源内容

### Beta：再接入正式资源目录和 App 验证

当 Alpha 阶段已经稳定后，再做正式落库：

1. 需要时更新 `index/root_index.yaml`
2. 在 `resources/<folder>/` 下维护 `adapters.yaml`
3. 把正式脚本保存为 `resources/<folder>/*.js`
4. 在轻屿课表开发版或自定义仓库地址里做真实导入测试
5. 验证通过后再提交 PR

## 标准进入路径

首次补充学校适配时，建议按以下路径进行：

1. 安装浏览器扩展工作台
2. 打开学校教务网页并登录
3. 在扩展里建立目标和脚本草稿
4. 在扩展里反复运行、修正、看预览
5. 跑通后再把结果整理到 `resources/<folder>/`
6. 补好索引和元数据后提交 PR

## 与上游仓库的关系

本仓库 fork 自：

- [XingHeYuZhuan/shiguang_warehouse](https://github.com/XingHeYuZhuan/shiguang_warehouse)

同时也吸收了上游测试工具思路，并在本仓库内保留浏览器扩展目录，方便贡献者直接从浏览器侧进入适配流程。

当前目标是：

1. 尽量兼容上游资源结构与协议
2. 为轻屿课表提供可独立维护的课程导入资源仓
3. 保留适合轻屿当前流程的浏览器插件调试入口
4. 在不破坏兼容性的前提下支持必要的轻屿扩展

## 仓库规则

- 优先保持与上游结构兼容
- 不提交账号、Cookie、Token、抓包原始敏感数据
- 不在主分支长期保留临时测试脚本
- 如引用或修改上游已有脚本，请保留来源信息
- 若新增轻屿专用扩展行为，请在文档或 PR 中写明
- 插件工具的说明与桥接能力改动，要同步文档

## 更多链接

- [贡献指南](./CONTRIBUTING.md)
- [插件工作台说明](./tools/CourseImporterTestTool/README.md)
- [快速开始](./docs/QUICK_START.md)
- [脚本 API](./docs/SCRIPT_API.md)
- [上游适配仓](https://github.com/XingHeYuZhuan/shiguang_warehouse)
- [上游测试工具](https://github.com/XingHeYuZhuan/shiguang_Tester)
