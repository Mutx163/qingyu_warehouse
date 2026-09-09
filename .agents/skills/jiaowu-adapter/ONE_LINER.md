# 一键 AI 自助适配指令（教务课表导入 → 轻屿课表）

> 用法：把下面「指令模板」里的两个占位符（学校名、教务入口 URL）填上，整段粘进 ZCode 或其他 coding agent 的对话框即可。
> agent 会自行拉取本仓库的 skill（`.agents/skills/jiaowu-adapter/SKILL.md`）并照着执行，**第一步是帮你把教务网站打开，然后停下来等你登录**——你在它打开的那个页面里自己完成登录，回一句「已登录」，剩下的它来做。
> **你全程不需要把账号、密码交给 agent**——它只在已登录页面/页签里复用会话；测试代码也只把结果打印到控制台给你复制回传。

本文件 raw 地址（供 agent 直接抓取本指令）：

- 国内（GitCode 镜像，推荐）：https://raw.gitcode.com/mutx/qingyu_warehouse/raw/main/.agents/skills/jiaowu-adapter/ONE_LINER.md
- 国际（GitHub 主仓）：https://raw.githubusercontent.com/Mutx163/qingyu_warehouse/main/.agents/skills/jiaowu-adapter/ONE_LINER.md

---

## 指令模板（填写后粘贴）

```text
我要给我的学校做轻屿课表（shiguang_warehouse / qingyu_warehouse）的教务课表导入适配。
请获取并严格执行这份 skill 文档，按它完成全流程：
https://raw.gitcode.com/mutx/qingyu_warehouse/raw/main/.agents/skills/jiaowu-adapter/SKILL.md
若上面这个地址拉取失败，依次尝试：
1. GitHub 主仓 raw：https://raw.githubusercontent.com/Mutx163/qingyu_warehouse/main/.agents/skills/jiaowu-adapter/SKILL.md
2. 克隆 GitCode 镜像到工作区：git clone https://gitcode.com/mutx/qingyu_warehouse.git ，改读本地 .agents/skills/jiaowu-adapter/SKILL.md 后继续执行

目标学校：【学校名称，如：闽南科技学院】
教务入口 URL：【如：https://jwgl.mku.edu.cn/】

第一步（先只做这一步，然后停下来等我）：
用你的浏览器打开上面的教务入口 URL。打开后不要做任何登录操作，也不要向我要账号密码或验证码——我会自己在你打开的那个页面里登录。登录成功后我回复「已登录」，你再继续执行 skill 里的后续步骤（识别平台 → 探测接口 → 写脚本 → 注入测试 → 本地校验 → 提交）。
如果你没有浏览器控制能力，就提示我在本机浏览器打开该 URL 并登录，我登录好后告诉你继续。

后续过程中会话若失效，只提示我重新登录（我会自己在页面里重新登录），不要索要或操作我的账号密码。
你生成的任何测试/探测代码，只在我已登录的那个页面/页签里运行，结果只输出到页面控制台供我复制回传，不要发送到任何远程地址。
完成后按 skill 的发布步骤提交（fork 用户：推自己 fork 并向 Mutx163/qingyu_warehouse 开 PR）。
```

## 社媒分发版（无链接，适用于小红书等会屏蔽外链的平台）

平台会屏蔽或限流正文里的网址，所以这一版**不出现任何链接**：仓库让 agent 自己搜，教务入口也让它搜出来先跟你确认。

```text
我要给我的学校做轻屿课表（教务课表导入）的适配。

先拿到流程文档：在 GitHub 搜索仓库 qingyu_warehouse（作者 Mutx163），国内网络搜不到就去 GitCode 搜同名仓库，读取里面的 .agents/skills/jiaowu-adapter/SKILL.md，然后严格按它执行。
两处都找不到就直接回我「需要 skill 原文」，我把内容贴给你。

目标学校：【学校名称】

教务入口：请你自己搜索「【学校名称】教务系统」确认官方入口网址，把找到的网址先发给我确认，确认后再打开。

第一步只做这一件事：打开教务网站后就停下来等我，不要做任何登录操作，也不要向我要账号密码或验证码——我会在你打开的页面里自己登录，登录成功后我回复「已登录」，你再继续后面的流程（识别平台 → 探测接口 → 写脚本 → 注入测试 → 本地校验 → 提交）。
如果你没有浏览器控制能力，就提示我在本机浏览器打开教务网站并登录，我登录好后告诉你继续。

后续规则：
- 会话失效时只提示我重新登录，不索要、不操作我的账号密码
- 探测和测试代码只在我已登录的页面里运行，结果只输出到页面控制台给我复制回传，不发送到任何远程地址
- 完成后按 skill 的发布步骤提交（推到自己的 fork 并向 Mutx163/qingyu_warehouse 开 PR）
```

> 分发小技巧：完整链接（含 raw 地址）别放正文，改成**打在图片上**、或放**评论区置顶**、或让用户**私信关键词自动收到**。正文只发上面这段无链接版，通过率最高。

## 示例（已填写，MKU）

```text
我要给闽南科技学院做轻屿课表的教务课表导入适配。
请获取并严格执行这份 skill 文档：
https://raw.gitcode.com/mutx/qingyu_warehouse/raw/main/.agents/skills/jiaowu-adapter/SKILL.md
目标学校：闽南科技学院
教务入口 URL：https://jwgl.mku.edu.cn/

第一步（先只做这一步，然后停下来等我）：
用你的浏览器打开上面的教务入口 URL。打开后不要做任何登录操作，也不要向我要账号密码或验证码——我会自己在你打开的那个页面里登录。登录成功后我回复「已登录」，你再继续。……（其余同上，完整段落见模板）
```

---

## 预期 agent 行为（对照检查）

1. 拉取/阅读 SKILL.md。
2. **先用浏览器打开教务入口 URL，然后停下来等你登录**；登录成功后你回复「已登录」，它才继续（它自己不登录、不问密码）。
3. 识别平台（强智/正方/青果/URP/超星），在仓库里找同平台参考脚本抄骨架。
4. 在你已登录的页面/页签里跑探测片段 → 定接口（模式 B 下由你粘贴到 F12 控制台、把输出贴回）。
5. 写出 `resources/<SCHOOL_ID>/<s>.js` + `adapters.yaml`（新学校加 `index/root_index.yaml` 条目 + 重生 `index/search_index.yaml`）。
6. 给你三段注入测试代码（mock 桥接 → 跑脚本 → 读回 JSON）→ 逐条比对课表（单双周/连堂/跳周）。
7. 本地校验（node --check、python compat 测试、search index --check）后提交/推送。
8. 交付报告里**不出现任何凭证**。任何一步要求你提供密码/验证码/Cookie 的，都是不符合 skill 红线，应拒绝并指出。
