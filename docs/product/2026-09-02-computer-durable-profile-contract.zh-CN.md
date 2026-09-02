# P6.7 本机 Computer 持久资料 Raft-first 合同

日期：2026-09-02  
范围：本机 Computer 的显示名称与描述；不包含远程 Computer、CLI 安装、中央账号、创建者、浏览器内
`restart/status/doctor` 或 heartbeat 推断字段。

## 1. Raft 可证明合同

冻结来源：

- `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`，SHA-256
  `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`；
- `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
  `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

Raft `MachineDetailPanel` 可证明：

- 只有 `canManageMachines` 时显示名称与描述铅笔按钮；
- 名称点击后变为单行输入框，移除换行，空值拒绝；Enter 保存、Escape 取消；保存为粉色、取消为白色；
- 描述点击后变为 textarea，最大 500 字符，显示 `N/500`；`Cmd/Ctrl+Enter` 保存、Escape 取消；空描述保存为
  `null`；
- 保存期间输入和按钮禁用；失败保留编辑态并在字段内显示橙色错误；相同值直接退出编辑态而不请求；
- 两者最终都调用 `PATCH /servers/{serverId}/machines/{machineId}`。名称 body 为 `{name}`，描述 body 为
  `{description}`；前端成功后只合并已确认字段，不做失败乐观写入。

冻结 Web bundle 不能证明 Raft Server 的存储表、事务、权限实现或幂等策略，本项目不伪造“后端源码已移植”。

## 2. RAH 本地裁决与单一 owner

RAH 没有 Raft 中央 Server。Computer 心跳继续只拥有 hostname、OS、版本、在线状态和 last-seen；显示名称／描述
由 daemon 的 `LocalComputerProfileStore` 单独持久拥有，文件位于当前 `stateDirectory`，随离线完整状态备份一起
迁移。UI、heartbeat、localStorage 均不得成为资料真相。

协议使用 `hostId` 稳定身份，并冻结：

- `displayName`：trim 后 1..120 字符；
- `description`：trim 后 0..500 字符，空值规范化为 `null`；
- `revision`：从 0 开始的单调版本；
- 更新请求同时携带完整 name/description、`expectedRevision` 与稳定 `idempotencyKey`；
- 同 key 同 payload 返回同一结果；同 key 异 payload 或 revision 过期返回 conflict，绝不静默覆盖。

`host.runtime.list` 把持久 profile 覆盖到本机动态 observation；更新响应立即投影到当前 UI，5 秒 read-model
reconcile 后仍以 daemon 资料为准。该设计复用 Raft 可见编辑状态机，同时按本地 daemon 架构补足可靠存储与并发
控制，不把主机名写回 heartbeat。

## 3. 安全与失败顺序

1. protocol 先红测：strict shape、长度、nullable 描述、revision 与未知字段拒绝；
2. store 先红测：首次读取、持久恢复、幂等、同 key 冲突、stale revision、未来 schema、损坏文件、symlink、
   owner-private 权限、原子写入；
3. application/SDK 红测：认证、缺失 administration、typed 409、完整响应；
4. Web 红测：名称 Enter/Escape、描述 Ctrl/Cmd+Enter/Escape、500 字符、pending、失败保留、焦点；
5. desktop 与 `390×844` 真实浏览器只使用隔离 `RAH_HOME` 修改测试资料；正式 4173 只做只读验收，避免替用户
   改名。

若进程在临时文件写入前中断，旧 profile 继续有效；写入必须使用 owner-private 临时文件、file fsync、原子 rename
与 directory fsync。未来 schema、符号链接、宽松权限或超限正文 fail closed，不能回退到 hostname 后继续接受写入。

## 4. 明确不做

- 不帮助安装或登录 Agent CLI；
- 不增加远程 Computer 注册／跨机文件传输；
- 不根据首次 heartbeat 伪造创建时间或创建者；
- 不在网页按钮中执行 `doctor/status/restart` 假命令；
- 不使用 Multica：本批 Raft 已给出完整可见编辑合同，Multica 没有更完整的 Computer 资料 owner。

## 5. 完成定义

只有 protocol、持久 owner、HTTP/SDK、UI 状态机、重启恢复、Chrome/Firefox desktop + `390×844`、active-work
审计、离线备份、标准 4173 重启和新标签只读复核全部通过，才可将 P6.7 标为 `C/A/L/D`。Raft Server 未公开，
`R` 只表示前端请求与交互合同一致，不表示后端实现逐行相同。
