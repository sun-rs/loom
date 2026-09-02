# Raft 聊天边栏与 Agent 资料侧栏宽度验收

日期：2026-09-01

## 裁决

本批只裁决两个桌面分栏合同，不扩大为全站 Raft 一致性声明：

| 分栏                | Raft 默认值 | Raft 最小值 | Raft 最大值 | RAH OS 结果 |
| ------------------- | ----------: | ----------: | ----------: | ----------- |
| 聊天 Room / DM 列表 |      240 px |      180 px |      320 px | 已一致      |
| 右侧 Agent 资料页   |      380 px |      300 px |      600 px | 已一致      |

两者均使用 8 px 可命中的竖向分隔条，并把最终宽度保存在浏览器本地布局偏好中。右侧资料页从左边缘拖动：向左增宽、向右缩窄；移动端不暴露分隔条，资料页占满可用宽度。

## Raft 来源

- 官方聊天边栏 bundle 合同：`storageKey: "slock:sidebarWidth"`、`min: 180`、`max: 320`、`defaultWidth: 240`。
- 官方资料侧栏 bundle 合同：[ProfilePanel-C-NXUlfh.js](../evidence/raft-web-20260831-current/ProfilePanel-C-NXUlfh.js) 中的 `storageKey: "slock:profilePanelWidth"`、`min: 300`、`max: 600`、`defaultWidth: 380`、`direction: "left"`。
- 官方资料侧栏分隔条为左边缘绝对定位的 8 px 命中区，使用 `cursor-col-resize`、Pointer capture、touch-none/select-none。
- 官方登录页 1280×720 实测：聊天边栏 240 px；打开 Agent 资料页后右侧为 380 px。真实鼠标拖动分别抵达 300 px 与 600 px，随后恢复默认值。

## 本地实现

- 聊天边栏继续由 `room-sidebar-resize.ts`、`use-room-sidebar-width.ts` 和 `room-sidebar-resizer.tsx` 单一拥有。
- Agent 资料侧栏新增 `profile-panel-resize.ts`、`use-profile-panel-width.ts` 和 `profile-panel-resizer.tsx`；`AgentDirectoryPane` 只组合该 owner，不自行解析拖动或存储。
- `identity-interactions.css` 只负责几何和视觉：桌面宽度变量、8 px 左边缘命中区、移动端满宽及隐藏拖柄。拖动和聚焦不再产生黄色框线。
- 键盘补充 `ArrowLeft` / `ArrowRight`（每次 8 px）、`Home`（300 px）和 `End`（600 px），不会改变 Raft 的鼠标合同。

## 验收证据

隔离 Firefox 门禁走真实产品路径：

1. 打开 Agent Council，确认聊天边栏 `240 / 180 / 320` 与 8 px 分隔条；用真实 `page.mouse` 拖至 320 px、180 px，刷新确认 180 px 持久化，再恢复 240 px并刷新确认。
2. 从频道设置添加已发现的本机 Agent。
3. 从 Agent 页创建私聊，点击私聊标题的 Agent 头像打开右侧资料页。
4. 确认初始 380 px；用真实 `page.mouse` 向左拖至 600 px、向右拖至 300 px。
5. 刷新页面，确认 300 px 持久化；再拖回 380 px并刷新确认。
6. 切到 390×844，确认资料页宽 390 px且桌面分隔条不可见。

通过门禁：

- `node --test apps/web/test/profile-panel-resize.test.ts`：3/3。
- `npm run typecheck`。
- `npm run test:web:unit`：143/143。
- `npm run test:web:firefox`：Firefox 150.0.2，1440×1000 与 390×844。
- 相关文件 Prettier 检查和 `git diff --check`。

## 边界

Agent 全页面内部的成员列表边栏是另一个布局合同（当前 240 px、180–400 px），不等同于聊天中点击头像后出现的右侧资料页。本报告不以本批几何通过替代 Agent 页面其余资料、动态、编辑和服务端行为的独立验收。
