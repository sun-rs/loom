# Agent 自定义图片头像 Raft-first 收口合同

状态：`C/A/L/D` 完成（P4.4）

日期：2026-09-02

## 1. 目标与非目标

本批只关闭 Agent 资料页的自定义图片头像能力，并让该头像通过同一 `avatarKey` 出现在 Agent 目录、Room/DM 消息、成员列表、hover card 与资料页。它不增加第二套 Agent 文件服务，不把聊天附件当头像，也不改变 Runtime、角色、Memory 或 Agent 身份。

本批不做图片物理删除。上传文件使用内容寻址且可能被多个 revision 复用；切回官方头像只是移除当前 Agent revision 对上传图片的引用。只有在有完整引用图、保留期和可恢复 GC 合同后才能删除 blob，不能为了模仿一个按钮而做不安全的即时删除。

## 2. Raft 冻结源码事实

上游证据：

- 冻结发布文件：`docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`
- SHA-256：`b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`
- 精确符号：`Mt`（选择 pixel preset）、`Me`（上传图片）、`sa`（恢复默认机器人）以及 profile 分支中的 avatar picker。

观察到的产品合同：

1. 只有 `canManageAgent` 才能点击资料头像打开 picker；只读用户只能查看自定义图片。
2. picker 包含上传图片、默认机器人和官方 pixel preset；当前选择用粉色边框/浅粉底标示。
3. 上传前拒绝超过 5 MiB 的文件；请求为 `POST /agents/{id}/avatar` multipart，字段名为 `avatar`。
4. 上传成功后使用响应中的 Agent 数据更新目录 store 并关闭 picker；失败在 picker 内显示 `uploadAvatarFailed`。
5. 文件 input 每次选择后清空，使同一文件能够重试。
6. Escape 关闭当前 picker；关闭后焦点返回头像触发按钮。提交中不允许关闭或重复提交。
7. 上传图片在资料头像和 picker 内用 `object-cover` 显示；Raft 发布 bundle 不能证明服务端是否转码，因此 RAH 不凭空增加有损转码。

复用类别：前端交互为 structural port；RAH 的认证、内容寻址存储和 revision-safe profile mutation 是 local-first glue。没有取得的 Raft Server 内部实现不声明 byte-exact。

## 3. RAH 唯一 owner

```text
Browser file input
  -> RahClient.profileImages.upload(file)
  -> authenticated PUT /v3/client/profile-images/content
  -> ProfileImageStore (sniff + max 5 MiB + content hash + atomic rename)
  -> uploaded avatarKey
  -> agent.manage/update_profile(expectedRevisionId, avatarKey)
  -> canonical AgentDefinition revision
  -> every AgentAvatar projection reads the same avatarKey
```

各层责任：

- `packages/protocol/profile-image.ts`：允许的 MIME、5 MiB、上传 key 和内容 URL。
- `packages/daemon/profile-image-store.ts`：文件验证、权限、内容寻址和不可变读取。
- `packages/application-service/client-profile-image-routes.ts` 与 SDK：认证上传/读取；不解释 Agent。
- `client-agent-profile.ts`：只允许官方 key 或合法上传 key，仍拒绝任意路径/URL。
- Kernel `agent.manage/update_profile`：expected revision、ACL、幂等和 canonical revision。
- `agent-avatar.tsx`：官方 pixel 与上传图片的唯一 Agent 渲染器，并保留 status dot。
- `AgentProfileAvatarEditor`：picker、上传顺序、错误、pending、Escape/focus 与 profile mutation。

Human 与 Workspace 已使用同一 ProfileImageStore；本批只扩展消费方，不复制存储。

## 4. 失败、竞态与回退

- 不支持的 MIME、伪造内容或超过 5 MiB：上传层 fail closed，不创建 profile revision。
- 上传成功但 profile revision 已过期：保留原头像并显示错误；上传 blob 可能暂时成为无引用内容，但不会覆盖别人或破坏 canonical state。
- profile 保存成功：目录 reconcile 使用 revision 单调更新；刷新后仍由 daemon canonical revision 恢复。
- 提交中禁用上传与 preset；Escape 不关闭，避免用户误以为请求已取消。
- 切回官方头像是安全回退。物理 blob GC 延后，不提供危险 DELETE。

## 5. 测试与验收

严格顺序：

1. protocol 红测：合法上传 key 可作为 `avatarKey`，任意 URL/路径仍拒绝；
2. Web helper 红测：必须先上传，再用返回 key 与原 expected revision 保存；上传失败不得保存；
3. renderer/组件合同：上传图片走认证内容路径，picker 不再显示 disabled 占位，input 限定四类 MIME；
4. Kernel 持久化回归：上传 key revision 重启后保持；
5. 全量 typecheck/test/build/format/audit；
6. 隔离 Chrome/Firefox desktop 与 390×844：选择、失败、同文件重试、Escape/focus、刷新恢复、无横向溢出；
7. 检查正式 active work，备份，优雅重启精确 `4173` 实例，再只读验证入口与既有资料不回归。

## 6. 2026-09-02 验收结果

- failure-first：protocol 首先拒绝上传 key；Web helper 首先因模块不存在失败；组件合同首先发现 disabled 占位。实现后 protocol/Kernel/Web 定向测试全部通过。
- 自动化：全量 `npm run check` 通过；packages 789 项中 787 通过、2 个真实付费 Provider 用例按规则跳过；Web 174/174；回调回归 34/34。`npm run build:web:workbench`、format、`git diff --check` 和生产依赖 audit 通过且为 0 vulnerability。
- 隔离 Chrome：真实 DevTools file input 选择 PNG，认证上传、canonical revision reconcile、上传图片 selected state、切回官方头像及后续 Direct Room/Message 统一头像均通过；全门禁最后在 `390×844` 通过。
- 隔离 Firefox 150.0.2：真实 `setInputFiles`、上传、刷新恢复、desktop/390 以及既有 Agent/Room/Settings 流程全部通过。
- 正式发布：重启前 28 个 Activation、28 个 RuntimeProcess、28 个 RunAttempt 均为终态；只有 1 个 submitted Task 待 Human，没有 active work。迁移前一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/pre-p44-agent-avatar-20260902T094206Z`（773 MiB），两个 SQLite `quick_check=ok`。本次重启同时执行已接线的数据根迁移到 `~/.rah/state`，终态/Task 计数保持。最终监听 PID `41805` 在 `127.0.0.1:4173` online。
- 正式 Chrome 与 Firefox：资料页上传按钮启用、accept 精确为四类 MIME、Escape 只关 picker 且还焦点；`390×844` 的 `scrollWidth=390`，console/page error 为空。正式状态未上传演示图片，避免擅自修改用户 Agent。

证据层：P4.4 `C/A/L/D` 已完成；`R` 覆盖冻结 bundle 可证明的前端行为，不扩大为未知 Raft Server 存储同构。物理 blob GC 仍是明确延期项，不影响自定义头像主链。
