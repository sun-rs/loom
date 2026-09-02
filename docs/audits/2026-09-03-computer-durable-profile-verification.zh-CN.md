# P6.7 本机 Computer 持久资料验收审计

日期：2026-09-03  
范围：Computer 显示名称、描述、资料编辑状态机、daemon 持久 owner、正式重启；不包含远程 Computer、CLI
安装、中央账号或浏览器内执行 restart/status/doctor。

## 1. 上游裁决

| 来源                                                                     | SHA-256                                                            | 可证明合同                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js` | `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8` | `canManageMachines`、名称／描述编辑、键盘、字符上限、pending/error、按钮顺序与颜色 |
| `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`              | `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` | `PATCH /servers/{serverId}/machines/{machineId}` 及 name/description body          |

Raft Server 存储实现没有出现在冻结发布物中。因此 `R` 只能证明前端触发与请求合同；RAH 本地持久实现按
local-first 架构独立接受可靠性审计，不能冒充未知后端源码的逐行移植。Multica 没有更完整、同语义的 Computer
资料 owner，本批未引入第二套实现。

## 2. 单一 owner 与数据流

`ClientComputerProfileUpdateRequest` 冻结完整 name/description、`hostId`、`expectedRevision` 和稳定
`idempotencyKey`。`LocalComputerProfileStore` 是唯一资料真相，使用 owner-private v1 文件、严格 schema、有限
profile/receipt、临时文件、file fsync、atomic rename 和 directory fsync。application service/SDK 只传输；Web
只保留已确认响应到下一次五秒 inventory reconcile。

heartbeat 继续独占 hostname、OS、版本、在线状态与 last-seen。Inventory 只在投影时用持久 profile 覆盖
`displayName/description/profileRevision/profileUpdatedAt`，没有把用户资料写回动态观测。

## 3. 失败审计

- 同 idempotency key 同 payload 返回原 receipt；异 payload 冲突；stale revision 冲突；
- 损坏 JSON、未来 schema、符号链接、宽松文件／目录权限和超限状态 fail closed；
- 保存失败保留 Web 草稿和错误，不能投影成功；
- 代码复审额外发现“写盘失败后内存曾先更新”的反例。新增失败测试删除持久目录后发起更新，旧实现错误地让
  `read()` 看见未落盘资料；修复后改为构造 `nextState`、完成原子持久化，再替换 `#state`。定向测试已由红转绿。

## 4. 验收证据

| 层级                     | 结果                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 定向 protocol/daemon/Web | `18/18 PASS`，包括持久失败不污染内存                                                                            |
| 全库                     | packages `808`（`806 pass / 2 opt-in skip`）、Web `220/220`、回调审计 `34/34`                                   |
| 静态／供应链             | typecheck、format、`git diff --check` 通过；`npm audit --omit=dev` 为 0 漏洞                                    |
| Chrome 隔离浏览器        | desktop + `390×844`，名称 Enter、描述 Cmd+Enter、刷新持久、resize/hover/click 全通过                            |
| Firefox 150 隔离浏览器   | desktop + `390×844`，名称 Enter、描述 Ctrl+Enter、刷新持久全通过                                                |
| 正式 4173                | active work 为零；只读打开 Computer，点击名称铅笔、确认输入／保存／取消，再以 Escape 退出；无错误且未改正式名称 |

正式离线完整备份：`/Users/sun/.rah/backups/pre-p67-computer-profile-20260903-ktjnMv`，约 1.5 GiB，三个
SQLite 文件 `quick_check=ok`。历史 `placement.ready` outbox 28 条无租约、无错误，不是活动执行。重启前 28 个
Activation 均 `completed`，28 个 Runtime process 均 `terminated`，SOS hold、未决取消、InputRequest 和运行中
Task 均为零。

## 5. 结论

P6.7 达到 `C/A/L/D`。名称／描述的可见前端行为与 Raft 发布合同一致，本地后端比可见发布物多了明确的
revision、幂等与崩溃安全，但仍不宣称 Raft Server 后端逐行一致。远程 Computer、CLI 安装和中央账号继续明确排除。
