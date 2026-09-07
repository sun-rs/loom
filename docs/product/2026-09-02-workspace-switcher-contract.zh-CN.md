# P6.1 空间切换浮层 Raft-first 合同

状态：`C/A/L/D` 完成

首次落盘：2026-09-02

## 1. 上游事实

授权冻结发布物 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：

- `eQe / Moe`，byte offset `2688036..2693000`：当前 Server 有 check；每行显示头像、名称、
  `/{slug}`、其他 Server 的 Activity 未读；独立拖拽 handle；Pointer 6px、Touch 500ms/10px；
  点击切换，修饰键/中键遵守新窗口；菜单自身 `tabIndex=-1`。
- `Moe` 关闭合同：打开后把焦点放到浮层；document `mousedown` 在浮层外关闭；Escape 关闭；
  浮层内 `mousedown.stopPropagation()`；选择后关闭。桌面挂在标识右侧，`left-full top-1 ml-2
w-64`，最大高度为 viewport 减 16px；移动端挂在标题下方。
- rail call site，byte offset `2813770..2814300`：左上标识的 tooltip 与可访问名称为当前 Server；
  **点击**切换浮层，不是 hover；桌面浮层是 anchored menu，不是 modal/backdrop。
- mobile Home call site，byte offset 约 `2779369`，`mobile-server-switcher-menu`：标题是当前 Server
  名称加 chevron；复用 `Moe`，位置为 `top-full left-2 right-2 mt-1`，最大高度
  `calc(100dvh - 160px)`；选择使用 `navigationMode: "replace-with-home"`，不恢复桌面的最近详情页。
- `yoe / iJe / Dm / oJe / lJe / cJe`，byte offset `2641750..2643300`：保存每个 Server
  最近合法路径和每个 rail surface 最近路径；读取时重新验证路径仍属于目标 Server，坏值删除；切换优先恢复，
  否则落默认首页。
- Server 顺序由 `updateServerOrder` 持久化。冻结 Web 只能证明前端请求/乐观投影，不能证明 Server 事务。

## 2. RAH OS 裁决

RAH 没有 Raft 中央 Server、社区加入和公开 Server picker。对应关系为：

| Raft                    | RAH OS                                          |
| ----------------------- | ----------------------------------------------- |
| Server                  | 本地 canonical Workspace                        |
| `/s/{slug}` 路径        | 当前单页 typed query target                     |
| Server order            | 当前 Human + 浏览器的 Workspace 顺序偏好        |
| Join Community          | 明确排除                                        |
| Switch or Create Server | 当前只进入本地 Workspace 管理；创建 UI 另立合同 |

本批结构化移植浮层、排序、最近位置、关闭/焦点合同，不复制中央社区动作，也不把旧的 Workspace 编辑
dialog 冒充 switcher。Workspace 名称/头像编辑仍走既有 `workspace.update` causal owner，从浮层的“管理当前协作空间”
单独打开。

Workspace 排序与最近位置属于当前 Human 的纯导航偏好，不是 Room/Message truth。第一版存储在当前浏览器
`localStorage`，键带稳定 Human principal；读取必须合并 canonical Workspace 列表、丢弃未知 ID、追加新 Workspace，
并验证 remembered Room 仍属于目标 Workspace。它不会改变 Kernel Workspace 顺序，也不声称跨浏览器同步。

## 3. 唯一 owner

```text
workspace.list canonical identities
  -> workspace-switcher-state.ts (bounded local preference + validation)
  -> WorkspaceIdentity anchored switcher (pointer/keyboard/focus/DnD)
  -> App Workspace selection reconciliation
  -> existing typed Room/surface URL owners

workspace.update remains unchanged
```

不得在 `App.tsx`、switcher 组件和 sidebar 各写一套排序或 remembered-location parser。

## 4. failure-first 与验收

1. 纯模型红测：顺序去重/剔除未知/追加新项；拖拽移动；不同 Human 隔离；坏 JSON fail closed；位置长度有界；
   remembered Room 只有属于目标 Workspace 才可恢复。
2. 组件红测：源码不再把空间列表与编辑表单放进同一个 modal；trigger 具有 menu 语义；Escape/outside/select
   关闭；Escape 返回 trigger；菜单打开后获得焦点；拖拽 handle 独立于选择按钮。
3. Desktop 真实浏览器：点击、tooltip、当前 check、头像/name/slug、拖拽后刷新保持、选择 Workspace 恢复位置、
   outside press、Escape/focus return、管理动作仍走旧 causal edit。
4. `390x844`：浮层不横向溢出，选择与关闭可操作；不额外造一套移动业务状态。
5. 完成后按 `AGENTS.md` 审计 active work、备份、优雅重启精确 `4173`，再做正式只读复核。

## 5. 明示延期

- 其他 Workspace Activity 未读数需要一次聚合 read model；当前 `activity.list` 是当前 Workspace 请求，不能在
  React 为每个 Workspace 制造 N+1 polling。没有聚合 owner 前，不用 Room unread 或 Agent presence 冒充。
- Human-global、跨浏览器 Workspace 顺序同步需要 typed preference owner；本批浏览器偏好会如实标注。
- Workspace create/archive/leave 与社区 join 不属于这个弹层视觉移植批次。

## 6. 施工与验收记录（2026-09-02）

- failure-first：`workspace-switcher-state.test.ts` 先因 owner 模块不存在失败；随后覆盖 Human 隔离、坏 JSON、
  canonical Workspace 合并、拖拽移动、4096 字符上限、跨 Workspace Room/Agent 深链拒绝。
  `identity-interactions.test.ts` 先证明旧实现把 switcher 和编辑表单混进同一个 modal，且 390px 下整个 rail
  被隐藏、空间入口不可达。
- implementation：`workspace-switcher-state.ts` 是 bounded 导航偏好的唯一 owner；`WorkspaceIdentity` 结构化移植
  Raft anchored menu、current check、头像/name/slug、6px pointer activation、独立 drag handle、outside/Escape/focus；
  Workspace 编辑继续走独立 `workspace.update` dialog。最近位置在 `App` 完成 URL 同步后写入，避免切换时把旧
  Workspace URL 记到新 Workspace。
- intentional difference：Raft 的 Server 顺序发给中央 `updateServerOrder`；RAH 第一版是 Human-scoped、
  browser-local preference，不宣称跨浏览器同步。其他 Workspace Activity unread 仍等待聚合 read model；
  不以 N+1 polling 或 Room unread 冒充。Agent 详情 deep link 在没有目标 Workspace Agent ACL 校验前不恢复。
- browser：隔离 Firefox 150.0.2 在 `1440×1000` 创建两个真实 canonical Workspace/Room，实际 pointer 打开、
  outside close、Escape/focus return、拖拽后 reload 持久、两次往返恢复第二 Workspace 最近 Room；实测菜单相对
  trigger 右移 8px、下移 4px、宽 256px、最大高度为 viewport 减 16px。`390×844` 以真实 pointer 打开同一菜单，
  `scrollWidth=390`；移动端只保留顶部 Workspace 标识，其他 rail 动作仍由既有底部导航承担，并为设置、关系图、
  Agent 返回键保留命中区域。完整 Firefox workbench gate 通过。
- evidence：代码、定向模型/组件测试、Web typecheck、正式 bundle build 和隔离真实 Firefox 已完成。正式发布前
  再次只读确认 Activation、RunAttempt、RuntimeProcess、独占操作、取消请求、SOS、Computer 操作、InputRequest
  与 Placement 的活动数全部为零；旧 PID `63740` 优雅退出并完成 WAL checkpoint。完整离线状态备份位于
  `/Users/sun/.rah/backups/pre-p61-workspace-switcher-offline-20260902Tk2Wdel`，Room 与 Runtime Registry 两库均通过
  `quick_check` 和外键检查；新 PID `77340` 以同一 `~/.rah` 数据根监听 `127.0.0.1:4173`。
- formal browser：正式页面用真实 pointer 打开浮层，确认当前 Workspace check、名称、slug、独立拖拽把手和管理入口；
  Escape 与外点关闭均通过，页面没有 `NetworkError`、`JSON.parse` 或重复消息级错误。隔离 Firefox 已证明桌面
  256px 几何、拖拽重载、最近 Room 恢复与 `390x844` 不溢出；正式状态只有一个 Workspace，因此没有在用户数据上
  制造第二 Workspace 做破坏性拖拽。证据层级为 `C/A/L/D`。Raft 同账号多 Server 实页未再次执行，因此本批不新增
  `R` 声明。

## 7. 2026-09-04 响应式回归修正

响应式 Shell 隐藏整个桌面 rail 后，旧的移动 Workspace 入口也被隐藏，Home 标题只剩静态文字。
本轮 Firefox 全工作台门禁发现该回归；核对上述 mobile call site 后，先增加失败的组件合同测试，
再由同一个 `WorkspaceIdentity` 提供 mobile trigger/menu。桌面和移动复用排序、canonical identities、
outside/Escape/focus owner；使用不同 menu ID，避免两个挂载入口产生重复 ID。移动选择返回 Home，
桌面仍恢复最近位置。

最新 Firefox 150.0.2 的 `390×844` 实测：标题按钮可点击，菜单左/右各 8px、宽 374px，
`scrollWidth=390`；Escape 关闭并把焦点返还移动 trigger。桌面 256px 菜单及原有排序、reload、
最近 Room 恢复门禁继续通过。此前第 6 节“移动只保留顶部 rail 标识”是当时实现，不再是当前移动合同。
本批正式重启与最终验收记录见
[附件投影与移动回归审计](../audits/2026-09-04-forwarded-attachment-projection-verification.zh-CN.md)。

## 8. 2026-09-06 完整 App 导航合同补证

组件 fixture 只能证明 switcher 自身会发出 `replace-with-home`，不能证明生产 `App` 没有在接线时
恢复桌面详情或增加历史记录。当前生产接线把选择意图明确分成两类：

- desktop `restore`：恢复经过 canonical Room 归属校验的最近位置；
- mobile `replace-with-home`：忽略桌面最近详情，复用既有 Home owner，清除 Thread、消息焦点与成员设置，
  打开当前 Workspace 的 Room 列表；不新增第二套移动路由。

`scripts/run-firefox-workbench-gate.mjs` 在真实生产 App 中创建两个 canonical Workspace/Room，先为第二个
Workspace 写入一个真实桌面 Settings 最近位置，再于 `390×844` 从移动 Workspace 菜单切换。验收证明：

1. 进入的是第二 Workspace 的 Room/Home，而不是 remembered Settings；
2. 切换前后 `history.length` 不增加，受控 Back/Forward 可回到两边准确的 Room；
3. reload 后仍由 URL 与 canonical Workspace/Room 恢复第二 Workspace；
4. 移动菜单与桌面菜单仍消费同一 Workspace identity owner。

Chrome/Firefox 的 switcher 组件页面族继续覆盖几何、长名称、外点、Escape/focus、pointer drag 与刷新排序；
完整 App 的 URL、历史和 hydration 接线由 Firefox 生产门禁补证。顺序和最近位置依然只是当前 Human 浏览器的
有界导航偏好；Workspace/Room 身份来自 canonical API，本文不把偏好写成 Kernel 事实或跨浏览器同步能力。
