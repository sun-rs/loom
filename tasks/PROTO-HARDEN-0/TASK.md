# PROTO-HARDEN-0：协议与投递可靠性——逐条保证、故障注入
背景：docs/PROTOCOL-v2.md 定义了 loom 在 OAR 契约上的扩展（会话索引、按波搬运、持久收件箱 queue/steer/interrupt、唤醒、证据卡、交接）。loomd 已实现并通过一次端到端冒烟（tasks/LOOM-CLI-0/RESULT.md）。要求：每条保证都可证。先读 PROTOCOL-v2、tasks/{RELAY-1,INBOX-0,STUCK-0,EVID-0,LOOM-CLI-0}/RESULT.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
1. 写出保证清单（放进 PROTOCOL-v2 的新章节"保证与非保证"）：例如 worker 最终回复必达 Leader 且不重复；每波 Leader 恰好被唤醒一次（忙时排队不丢）；Auditor 仅在 FAILED/MISMATCH 时被抄送；send 的回执语义（accepted/delivered/answered）；interrupt 只作用于指定轮；崩溃恢复不丢不重；单写者。每条写明前提和明确的非保证。
2. 规范与实现逐条对账：状态机每个转移、每个持久化点，对应代码位置；不一致处修代码或修文档（说明取舍）。
3. 故障注入矩阵，每条保证至少一个确定性测试：loomd 在每个持久化步骤前后被 kill -9；投递中目标会话退出；目标长时间忙；两个发送方并发；旧锁残留；JSONL/SQLite 半写损坏；worker 永不结束（波次超时与迟到结果）；worker 在波次封存前就结束；OAR runtime 进程崩溃；hc 服务重启；同一消息重复提交（幂等）。
4. 关键几条做实测（实测目录 /Users/sun/Code/exp-relay/proto-harden-0/，用便宜模型或本地脚本角色即可）。
5. 波次超时策略：现为 900s 固定窗；改为"部分成员已完成后缩短剩余等待"的可配置策略，并测试。
6. npm test 全绿；RESULT 给出：保证→测试→结果 表、修复清单、仍存在的非保证。
可写：inbox/、relay/、daemon/、index/、watch/、evidence/、handover/ 的逻辑与测试、docs/PROTOCOL-v2.md、tasks/PROTO-HARDEN-0/。并行卡 CLEAN-0 在 relay/、inbox/tui.mjs 只做删除与 import 替换并删除 drivers/；TUI-REL-0 改 adapters/、runtimes/claude-tui/。编辑前重新读文件，冲突写进最终回复。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
