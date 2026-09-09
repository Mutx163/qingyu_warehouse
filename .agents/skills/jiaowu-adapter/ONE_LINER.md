# 一键 AI 自助适配指令（教务课表导入 → 轻屿课表）

> 用法：先在**浏览器里登录好你们学校的教务系统**，把下面「指令模板」里的两个占位符填上，整段粘进 ZCode 或其他 coding agent 的对话框即可。
> agent 会自行拉取本仓库的 skill（`.agents/skills/jiaowu-adapter/SKILL.md`）并照着执行。
> **你全程不需要提供账号、密码**——agent 只在已登录页签里复用会话；测试代码也只把结果打印到控制台给你复制回传。

本文件 raw 地址（供 agent 直接抓取本指令）：
https://raw.githubusercontent.com/Mutx163/qingyu_warehouse/main/.agents/skills/jiaowu-adapter/ONE_LINER.md

---

## 指令模板（填写后粘贴）

```text
我要给我的学校做轻屿课表（shiguang_warehouse / qingyu_warehouse）的教务课表导入适配。
请获取并严格执行这份 skill 文档，按它完成全流程：
https://raw.githubusercontent.com/Mutx163/qingyu_warehouse/main/.agents/skills/jiaowu-adapter/SKILL.md
若 GitHub raw 拉取失败（如国内网络），请改用 GitCode 镜像克隆到工作区：git clone https://gitcode.com/mutx/qingyu_warehouse.git （或用你了解的 GitHub 加速代理），改读本地 .agents/skills/jiaowu-adapter/SKILL.md 后继续执行。

目标学校：【学校名称，如：闽南科技学院】
教务入口 URL：【如：https://jwgl.mku.edu.cn/】
我已在本机浏览器登录教务系统且会话有效；过程中会话若失效，只提示我重新登录，不要索要或操作我的账号密码。
你生成的任何测试/探测代码，结果只输出到页面控制台供我复制回传，不要发送到任何远程地址。
完成后按 skill 的发布步骤提交（fork 用户：推自己 fork 并向 Mutx163/qingyu_warehouse 开 PR）。
```

## 示例（已填写，MKU）

```text
我要给闽南科技学院做轻屿课表的教务课表导入适配。
请获取并严格执行这份 skill 文档：
https://raw.githubusercontent.com/Mutx163/qingyu_warehouse/main/.agents/skills/jiaowu-adapter/SKILL.md
目标学校：闽南科技学院
教务入口 URL：https://jwgl.mku.edu.cn/
我已在本机浏览器登录教务系统且会话有效；……（同上，完整段落见模板）
```

---

## 预期 agent 行为（对照检查）

1. 拉取/阅读 SKILL.md，先识别平台（强智/正方/青果/URP/超星），在仓库里找同平台参考脚本抄骨架。
2. 给你 F12 探测片段 → 你粘贴运行、把输出贴回 → 它定接口。
3. 写出 `resources/<SCHOOL_ID>/<s>.js` + `adapters.yaml`（新学校加 `index/root_index.yaml` 条目 + 重生 `index/search_index.yaml`）。
4. 给你三段注入测试代码（mock 桥接 → 跑脚本 → 读回 JSON）→ 逐条比对课表（单双周/连堂/跳周）。
5. 本地校验（node --check、python compat 测试、search index --check）后提交/推送。
6. 交付报告里**不出现任何凭证**。任何一步要求你提供密码/验证码/Cookie 的，都是不符合 skill 红线，应拒绝并指出。
