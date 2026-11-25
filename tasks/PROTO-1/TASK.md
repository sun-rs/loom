# PROTO-1：收窄 loom 协议（只删不加为主）

## 背景
见 docs/REQUIREMENTS.md 和用户最新决定：hc + 薄 loomd + skill；所有角色由 `loom` 命令拉起；不做 app-server/headless 第二体系；super 以"主动查历史"为主，必要时提问，提问默认不打断。
并行进行中：ADAPT-codex/claude/agy（适配器接口见 tasks/ADAPT-codex/TASK.md "交付"节，请以此为准，可微调但保持字段名）。

## 交付：改写 docs/PROTOCOL.md（原文件先读；超出下列范围的内容删除或移入"未来/不做"附录）
1. 命令面：`loom spawn <role> --cli --model --effort --cwd --project --task --wave [--skill] "<prompt>"`、`loom send <target> --mode queue|steer|interrupt "<msg>"`（queue 为默认：目标轮末投递；steer 不支持时降级 queue 并在回执标明；回复经最终回复搬运回提问者）、`loom hist <role|task|addr> [--turns N] [--level L1|L2]`、`loom state <target>`、`loom ls [--project]`、`loom stop <target>`。每条写输入、输出 JSON、退出码、回执语义。
2. 事件：turn-start、turn-end（含原生最终回复）、stuck（原因：trust/picker/rate-limit/auth/idle-without-stop）、usage。投递语义：0 丢、0 重、按波合并。
3. 会话索引记录字段：role、project、task、wave、addr、cli、model、sessionId、transcriptPath、cwd、account(占位)、baseCommit、startedAt、endedAt、parent。
4. 适配器接口（与 ADAPT 卡一致）与能力声明。
5. 附录"不做"：app-server/headless、daemon 内方法论/状态机、按额度自动切换、多账号/容器/跨机（单机达标后再议）。
同步更新 schema/protocol.ts 的类型（删除无用类型）。写 tasks/PROTO-1/RESULT.md（删除了什么、保留了什么、行数前后对比），最后一行 STATUS: done。

## 红线
只写 docs/PROTOCOL.md、schema/、tasks/PROTO-1/；不 commit；不读凭据和会话记录；不使用 hc send/keys/kill。
