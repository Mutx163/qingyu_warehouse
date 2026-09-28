# qingyu_only/ —— 轻屿专属适配目录

`resources/` 里的脚本必须**只用上游标准接口、能原样提交给上游**。有些学校知识上游
协议表达不了，例如「主教学楼 10:30 上第三节、其它教学楼 10:20」——一次导入只能通过
`savePresetTimeSlots` 存一套全局作息，分流不了。

这类内容放这里，由 App 读取并应用；**脚本仍是 `resources/` 下那份上游标准脚本**。

## 隔离是强制的

- 在 `scripts/warehouse_upstream_compat.py` 的 `PROTECTED_PATH_PREFIXES` 里，
  同步工具会**主动拒绝**从上游检出本目录
- `tests/test_qingyu_only_isolation.py` 钉住这条约束，已接进 CI
- 不在 `resources/` 下，回流上游的 PR 结构上就带不走

**所以：本目录永远不要提交给上游。** 反过来，`resources/` 里也永远不要放轻屿专属
字段——那会破坏「脚本原样回馈上游」。

## 怎么加一所学校

```
qingyu_only/<学校ID>/
  adapters.yaml       # 登记一条轻屿专属适配条目（只能扁平字段）
  time_schemes.json   # 结构化作息数据
```

写完跑一次校验（CI 也会跑）：

```bash
python scripts/validate_qingyu_only.py                     # 全量
python scripts/validate_qingyu_only.py qingyu_only/CQCST  # 只看某校
```

校验会拦住：版本号不对、节次不连续、时间格式错、**时间倒退**（App 建模板时会拒）、
覆盖了不存在的节次、兜底作息缺失或不唯一、校区 id 重复、keywords 非法、
在 `adapters.yaml` 里写嵌套键、在本目录另存脚本副本。

## `adapters.yaml`

只能放**扁平键值**——App 的 YAML 解析器是逐行扁平解析，嵌套结构会被读成垃圾而
不是报错。结构化数据另置文件。

```yaml
adapters:
  - adapter_id: "CQCST_02"
    adapter_name: "重庆城市科技学院强智适配（按教学楼自动分流作息）"
    category: "BACHELOR_AND_ASSOCIATE"
    asset_js_path: "cqcst_01.js"          # 复用 resources/ 下那份脚本，不另存副本
    import_url: "http://jw.cqcst.edu.cn/cqdxcskjxy_jsxsd/"
    maintainer: "Mutx163"
    description: "……"
    # --- 以下为轻屿专属字段，上游 schema 未定义，其它 App 直接忽略 ---
    time_schemes_file: "time_schemes.json"
    campus_prompt: "你在哪个校区？"        # 可选；只有多校区时才需要
```

## `time_schemes.json`

```json
{
  "version": 1,
  "sections": {
    "1": { "startTime": "08:20", "endTime": "09:05" },
    "3": { "startTime": "10:20", "endTime": "11:05" }
  },
  "campuses": [
    {
      "id": "yongchuan",
      "name": "永川校区",
      "schemes": [
        { "name": "永川校区 · 其他教学楼" },
        {
          "name": "永川校区 · A主/主教学楼",
          "keywords": [{ "pattern": "A主", "mode": "prefix" }],
          "overrides": {
            "3": { "startTime": "10:30", "endTime": "11:15" }
          }
        }
      ]
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `version` | 目前只接受 `1` |
| `sections` | **基线作息**，节次从 1 连续编号。必须是一份**完整有效**的时间表：节次不倒退、结束晚于开始——否则 App 建模板时会拒绝。取学校最常见的那一套 |
| `campuses[].id` | 稳定标识；仅一个校区时也照常写 |
| `campuses[].name` | 展示用，也是导入时问用户的那句 |
| `campuses[].schemes[].name` | 时间模板名。**同一校区内不得重名**（重名会让 upsert 命中错误的旧模板） |
| `schemes[].keywords` | 教室名匹配规则。**没有 keywords 的那套是兜底，会成为课表默认**；每个校区必须恰好一套没有 |
| `schemes[].overrides` | 只写与 `sections` 基线**不同**的节次，键是节次号 |

`keywords[].mode` 可选 `prefix`（默认）/ `contains` / `exact`。

### 为什么用「基线 + overrides」而不是每套写全

学校公布的作息通常只有一两个节次因校区/教学楼而不同。写全的话四套各 13 个数字，
学校改一次作息要改 52 处，而且抄错一个就是**静默的错误上课时间**——校验器也看不出
来（格式合法）。`overrides` 把差异显式化，抄错的面积从 52 处降到实际差异那几处。

## 加了新学校之后

如果适配脚本也需要改动（而非只加作息数据），脚本仍然要**只用上游标准接口**，
放在 `resources/<学校ID>/` 下并照常回馈上游。`qingyu_only/` 只放上游协议表达不了的
那部分数据。
