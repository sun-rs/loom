# P6.2 消息回应者浮层 Raft-first 合同

状态：`C/A/L/D` 完成

日期：2026-09-02

## 1. 上游事实

唯一产品来源是获授权冻结的 Raft Web 发布物
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

- byte offset `2956049..2959900`：`ri` 从共享 reaction actor cache 取得名单；`Rl` 从
  viewer overlay 判断“我是否回应”；`qc` 以 chip 的 `getBoundingClientRect()` 建立浮层状态，当前 Human
  以“你”置于首位，最多显示 5 个名称，`hiddenCount = count - visibleNames.length`。
- byte offset `2975413..2979000`：回应 chip 在 `mouseenter/focus` 打开，在 `mouseleave/blur`
  关闭；点击先关浮层再提交回应。浮层经 portal 挂到 `document.body`，`role=tooltip`、
  `data-message-affordance=reaction-reactors-popover`，fixed/z-80、最大宽度 280px、2px 黑边、
  白底、横向 8px/纵向 6px 内距、12px bold；位置为 chip left、chip bottom + 4px。名称最多
  112px并截断，内容区最多 240px并可换行，浮层不接收 pointer。
- 相同片段证明消息快捷回应仍是固定 `t8` 七项。入口文件中动态加载
  `emoji-picker-react.esm-*` 的 `WQe` 属于侧栏分区 emoji 编辑，不是消息回应。因此本批不新增
  “完整消息 emoji picker”，也不把未出现的 UI 当成待对标功能。

Raft 发布物没有公开 reaction Server SQL。它只能证明 viewer overlay、actor cache 与前端呈现，不能证明
中央 Server 的持久事务。

## 2. RAH OS 映射与唯一 owner

现有 `MessageSocial` 已拥有共享 `message_reactions` 集合、Human 私人 `mine` 投影、ACL、幂等写入和
最多 20 个 actor 的 bounded read model；Protocol 已返回 `principalId/name`，前端当前仅把姓名塞进原生
`title`。本批不加 schema、不加 endpoint、不加第二 store：

```text
message_reactions canonical set
  -> MessageSocial.item(actorId): 当前 viewer actor 排首位，其余 handle 稳定排序
  -> existing MessageSocialItem.reactions[].actors
  -> MessageReactionSummary hover/focus tooltip portal
```

viewer-first 只改变当前请求的展示顺序，不改变共享集合、计数、Room event 或 Agent wake。前端只有在
`mine=true` 时把 actors[0] 显示为“你”；若数据不完整则按已知名称显示并用 count 计算隐藏人数，不能猜身份。

## 3. 交互与失败边界

- mouseenter/focus 打开；mouseleave/blur、点击回应、消息卸载、scroll、resize 关闭；切换到另一 chip 时覆盖
  当前状态。tooltip 是只读且 `pointer-events:none`，不建立 hover bridge。
- keyboard focus 与 pointer 使用同一组件和状态；不新增只在桌面生效的第二路径。
- popover 坐标按 viewport clamp，不能从右边或下边溢出；Raft 可见源码只直接赋值 left/top，本地 clamp 是
  390px 安全 glue，不改变内容语义。
- 原生 `title` 不再承载回应者名单，避免与自定义 tooltip 重叠；完整名单仍通过有界 `aria-label` 提供。
- 读失败继续由现有消息级 social error 单处显示，不在每个 actor 或 tooltip 内重复错误。

## 4. failure-first 与验收

1. Kernel 红测：同一 emoji 有两名回应者时，不同 viewer 各自排在 actors[0]；计数和集合不变。
2. Web 红测：必须存在 portal tooltip、mouse/focus 对称触发、Raft geometry class 与隐藏人数呈现；旧的
   title-only 不能满足合同。
3. 定向 protocol/kernel/Web、typecheck、workbench build。
4. 隔离 Firefox desktop 与 `390x844`：真实 hover、focus、blur、scroll、resize、点击切换、reload；两名
   Human 的“你”排序由服务测试证明，浏览器 fixture 至少显示姓名和隐藏计数。
5. 完成后按 `AGENTS.md` 重做 active-work 审计、完整备份、精确 4173 重启与正式只读复核。

## 5. 明示不在本批

- Saved 独立页当前 Raft 实页没有搜索/Room/排序控件；RAH 不自行暴露协议保留的高级查询参数。
- Message context menu、复制链接/Markdown、Thread follow 等另按其官方菜单合同施工，不塞进回应 tooltip。
- 超过 actor read model 上限的服务端完整名单页没有已观察触发；本批只复刻最多五名 + 隐藏人数摘要。

## 6. 施工与验收记录

- failure-first：Kernel 测试先证明旧查询不会把当前 viewer 排到首位；Web 合同测试先证明旧实现没有 portal、
  hover/focus 对称触发和 Raft geometry。两项均在产品代码修改前红。
- single owner：`packages/kernel/src/message-social.ts` 只对当前请求的 bounded actor read model 做
  viewer-first 稳定排序；`apps/web/src/components/message-social.tsx` 是唯一 tooltip 状态/portal owner；没有新增
  schema、endpoint、缓存或第二份 reaction store。
- structural port：当前 Human 显示“你”、最多五名、隐藏人数、`role=tooltip`、body portal、固定定位、
  mouse/focus 对称开关、点击前关闭和 Raft 字体/边框/内距均按冻结 bundle 移植。viewport clamp、scroll/resize
  关闭是 390px 本地安全 glue。
- 自动化：定向 Kernel/Web `8/8`；`typecheck`、`build:web:workbench`、`git diff --check` 通过；完整
  `npm run check && npm run format:check && npm audit --omit=dev && git diff --check` 退出码为 0，依赖漏洞为 0。
- 本地浏览器：Firefox 150.0.2 在 `1440x1000` 与 `390x844` 实际完成 hover、focus、blur、viewport clamp、
  点击切换、reload 与既有收藏/回应回归；门禁结果为 `PASS`。
- 正式部署：重启前 active Activation、RunAttempt、RuntimeProcess、exclusive operation、InputRequest、
  Placement、Computer operation、SOS、cancellation 和 workspace lease 均为 0；两份 SQLite quick check/外键检查
  通过。1.5 GB 停机一致性备份位于
  `/Users/sun/.rah/backups/pre-p62-reaction-tooltip-offline-20260902T2aE18M`。新 PID `84596` 在 `4173`
  online；正式页面真实打开七项回应菜单、Escape 关闭并恢复 `aria-expanded=false`，console error/warn 为零。
  正式数据当前没有既有 reaction actor，故没有为了截图写入共享回应；tooltip 的 actor 内容、pointer/focus 和
  `390x844` clamp 由隔离真实 Firefox 门禁证明。`D` 证明部署与非写入交互，不冒充正式共享数据写入验收。
