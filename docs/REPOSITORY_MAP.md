# 仓库地图

本文档用于说明 `qingyu_warehouse` 各目录的职责划分。

## 一句话说明

`qingyu_warehouse` 为适配资源仓。浏览器扩展工作台用于调试与验证，服务于资源生产流程，不替代资源仓本身。

## 目录分工

### `index/`

资源入口索引。

主要维护：

- 学校 / 工具列表
- 资源文件夹映射
- 适配入口元数据

当前最关键文件：

- [`index/root_index.yaml`](../index/root_index.yaml)

### `resources/`

正式适配资源目录。

保存会被仓库下游读取和分发的正式资源内容：

- `adapters.yaml`
- 学校或工具对应的 `*.js` 脚本

通常一所学校或一类工具对应一个文件夹，例如：

```text
resources/CQCST/
  adapters.yaml
  cqcst_01.js
```

### `resources/GLOBAL_TOOLS/`

通用示例、模板和全局工具脚本。

主要用途：

- 参考脚本结构
- 提供测试占位脚本
- 放共享工具能力

### `tools/CourseImporterTestTool/`

浏览器扩展工作台。

该目录为当前推荐的 Alpha 调试入口，负责：

- 选择目标学校或创建草稿目标
- 生成、编辑和运行脚本
- 模拟轻屿当前支持的 Bridge
- 预览课程、时间模板和课表结果
- 协助整理待提交内容并发起 PR

该目录为工作入口，不是正式资源发布目录。

### `docs/`

贡献者文档区。

目前主要包括：

- [快速开始](./QUICK_START.md)
- [脚本 API 与数据结构](./SCRIPT_API.md)
- [提交前检查清单](./ADAPTER_CHECKLIST.md)

### 仓库根目录

主要放置对外入口文档：

- [`README.md`](../README.md)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md)

## 建议阅读顺序

首次阅读建议按以下顺序查看：

1. `README.md` 先告诉你这个仓库是什么
2. `tools/CourseImporterTestTool/` 帮你在浏览器里把脚本跑通
3. `docs/SCRIPT_API.md` 告诉你脚本能调用什么 Bridge
4. `resources/<folder>/` 存放正式提交的适配结果
5. `index/root_index.yaml` 把这些资源接进总索引

## 三种常见角色

### 1. 只想给自己学校补适配

优先看：

1. `docs/QUICK_START.md`
2. `tools/CourseImporterTestTool/`
3. `resources/` 里同类学校脚本

### 2. 要正式提交资源

优先看：

1. `CONTRIBUTING.md`
2. `docs/ADAPTER_CHECKLIST.md`
3. `index/` 和 `resources/`

### 3. 要维护插件工作台本身

优先看：

1. `tools/CourseImporterTestTool/README.md`
2. `docs/SCRIPT_API.md`
3. `tools/CourseImporterTestTool/*`

## 概念区分

### 插件工作台

主要解决：

- 如何更快调试脚本
- 如何在浏览器里反复验证
- 如何更顺手地整理提交内容

### 适配资源仓

主要解决：

- 正式脚本放在哪里
- 资源如何索引
- 下游如何读取和分发

两者属于同一流程中的不同层级，不是相互替代关系。
