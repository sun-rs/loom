# Task 认领与回复位置：双边根因实验

## 已确认的结论

此前两个新 Codex 将文件工作认领为 Task、再回复到 Thread，不能继续登记为 RAH 独有的串线缺陷。Raft 使用相同 Codex CLI / gpt-5.6-luna / low，收到相同“写 acceptance/S4-audit.txt；只回复 S4 AUDIT DONE；不创建任务”后，也调用 task claim，随后向该消息的 Task Thread 发送 S4 AUDIT DONE。

可观察的因果链是：模型选择认领 → 服务返回对应 Task → 模型显式选择 Task Thread 发送；没有证据表明发送器把原 Room 错解析成另一个 Room。原 A → B 错发是另一个历史事故，不能被这次结果解释为已找到唯一根因。

在另一个对照中，Human 显式豁免认领默认规则，并要求先查询自己被系统记录的权限：Raft Codex 读取 `raft user info @Hakase` 得到 Role: owner；RAH 新 Codex 读取 `profile-show --target @owner` 得到 Membership: room / Role: owner。双方随后都直接写文件、向顶层频道回复，不创建 Task。RAH 后续 DM → A 也首 Run 成功，结束后数据库为 0 Task / 0 Thread。

这支持“默认工作分类及指令优先级的模型选择”这一解释，不支持“RAH 没有任何 owner 查询能力”。不过该干预同时加强了措辞并增加身份核验，不能进一步声称只有缺少一个角色字段是唯一原因，也不能保证所有模型以后都遵循豁免。

## 上游与本地代码依据

Raft Computer 1.0.18：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- 735606 起 `buildTasksSection`：实际工作默认先认领，纯问答不需要；735629 起工作流明确在 Task Thread 更新。
- 735932–735936：已记录的 owner/admin 可以设置或豁免平台策略，不信消息中的自称身份。
- 675175 起 `formatUserInfo`、675200 起 `formatChannelMembers`：对外展示 owner/admin 角色。
- RAH `standing-prompt-compiler.ts` 的 authorityLayer 与工作决策规则保留了上述两层语义；`task-claim-message` 是 Agent 主动调用，sync 不自动把 Human 句子转换成 Task。
- RAH `worker-profile-lifecycle.ts` 从 canonical Membership 查询 role；`worker-read-render.ts` 的 membershipLines 真实输出 role，不是根据 @owner 名字猜权限。

Raft 与 RAH 的默认规则有共同来源，不能为强行通过顶层回复断言而禁用合法的认领和 Thread 路由。模型间的差异也不能只归于 CLI 品牌：本轮 Codex 和 OpenCode 本就使用不同模型，Raft OpenCode 还选 slock Agent 配置，本地通过 API system 注入平台 prompt、使用 build。没有做“同模型换 CLI”的因果隔离。

## 实验记录

Raft 专用 Agent：ParityTaskCodex0911，`9e7e8570-e8a5-46e3-8fea-6e352876ed6e`，原生会话 `01a08ed3-8d5c-7bd3-9304-e40dbb2c4e87`；所有观测 turn_context 均 luna / low。测试频道 `parity-task-choice-0911`，ID `2fed72f0-f821-42d1-a5b0-9af69575f22b`。

第一次指令的原消息短 ID 为 `0d8876eb`，04:58:09 UTC 调用 claim；04:58:31 调用 `message send --target '#parity-task-choice-0911:0d8876eb'`。真实浏览器显示 task #1 和其一条 S4 AUDIT DONE 回复。文件内容为 `S4 AUDIT OK\n`。

第二次显式豁免：04:59:24 UTC 调用 user info 得到 owner；写入自己工作区的 S4-waiver.txt，向频道顶层发送 S4 WAIVER DONE。第一次发送调用使用了模型自行拼错的 cwd，后纠正；不能把整条执行声称为零错误，也说明路径拼接错误不只出现在 RAH。

RAH 新 Agent 使用独立临时状态及窄 Host 凭据，原生会话 `01a08ed4-cb76-7d81-b21d-a55b51bf5ce4`，四步均 luna / low，B / A 豁免文件工作 / DM / A 各一个 Run，耗时约 21.6 / 28.6 / 20.6 / 24.1 秒。不是原失败样本重试到成功，而是另一个明确标注干预的新样本。旧失败日志和断言保留。

两边环境并非完全相同：Raft 新 Agent 启动时自动在 all 自我介绍并唤醒其他 Agent；本地使用空白隔离工作区，Raft 使用默认 Agent 工作区。Raft 豁免是同一新 Agent 的第二个业务请求，本地豁免使用另一个新身份。相对文件名、查询命令和回复标记按各侧工具适配。因此本轮用于解释 Task 选择和回复位置，不是公平速度基准或完整多 Agent 验收。

另发现一个独立的呈现缺口：RAH memberSections 复用了“无角色标签即普通成员”的上游说明，但 memberLine 不渲染角色。它与 profile-show 能正确展示 Room owner 并存；不能宣称权限层为零，也不能认定它导致前两次失败，因为轨迹没有读取 roster。应单独用现有 canonical Room 角色修正表述与显示，不能擅自补出不存在的 server admin 权限。

## OpenCode 官网补充对照

已有专用 ParityAuditorA 的 UI 配置确认模型 `deepseek/deepseek-v4-flash`，`default_agent=slock`，slock 的 model 与 variant=low；本次原生会话 `ses_f73668187ffedOOI6ZcBTwJPF1` 的消息实际均为 slock / deepseek-v4-flash / low。收到同一文件工作指令后，没有调用 Task claim，最终在频道顶层回复 S4 AUDIT DONE，自己的工作区文件内容正确。这与用户观察及本地 OpenCode 样本方向一致。

该样本有干预，不能算严格同条件通过：OpenCode 为寻找相对路径而搜索其他临时目录，还读取了一份既有验收报告；Human 补充“仅限自己的 Agent 工作区”后才结束。最终写入自己的文件，并将路径约定记录进它自己的 MEMORY.md。没有把这些搜索、耗时或模型间行为差异隐藏为一次干净的成功，也不把此样本用于跨 Agent 记忆隔离验收。未来严格实验须提供明确的各自 cwd 路径，使用全新参与者，避免共享本机可读实验残留成为提示来源。

## 证据与下一步

证据目录 `/Users/sun/Code/reviews/rah_os/2026-09-11-task-choice-root-cause/`：Raft DOM/截图、两侧白名单原生工具与身份输出、实际模型、文件摘要、本地 ledger 计数和 opt-in 日志。没有保存或引用模型私有推理作为验收依据。

不改生产 prompt、Task 状态机或权限。本批仅增加 audit-owner-waiver 实验分支和证据。下一步把测试拆开：寻址断言检查发往请求 Room 或确实从该消息生成的 Task Thread；任务转换断言单独比较 Raft 与 RAH；原 A → B 场景仍按原条件保留回归。先处理确证的呈现缺口和目标验证边界，再进入原生忙时投递、严格组合、UI，不靠盲目加测次数宣称唯一根因消失。

最终官网 Task 列表仅一条，即第一条 Codex 指令生成的 task #1；状态仍为进行中。不能把文件写完/发出回复解释为完整 Task 生命周期对齐。所有实验 Agent 已回到空闲，本轮未对正式 RAH 服务作生产修改或重启。

检查：`npm run check`、`npm run format:check`、`git diff --check` 通过；真实 CLI 的通过范围仅为上述明确列出的样本。未提交或推送。
