# 消息头像悬停资料接线

来源：[raft-source a98ae003246a0360872a77d76dec2fccd0347ef7](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，沿用 owner 授权，原始 `packages/**` 未修改。

## 问题与采用方式

消息以 `readOnlyProjection` 显示时，原生 MessageItem 的 SenderAvatar 不向预览卡提供成员资料；官方 Agent/Server store 也没有 Loom 数据。因此头像悬停显示不可用，AgentStatusDot 又把缺少资料默认为离线。不能为了解决入口而取消只读模式，这会同时开放尚未接入的运行和业务操作。

直接复用 SenderAvatar 的 PreviewCard、Trigger、Content、AvatarSlot：悬停延迟 200ms、关闭延迟 120ms、内容宽 280px、sideOffset/collisionPadding 6px，保留原生头像尺寸与鼠标交互。`MessageProfile.tsx` **结构移植** ProfilePreviewCardContent 的身份和简介区块，保持原生字号、字体、间距、分隔线和 Tooltip；这不是完整原版组件的字节复用。省略尚未绑定的运行、模型、在线状态和动态区块，不生成虚假的默认值。

ChannelTimeline 通过 React context 借用现有 RoomSession 成员投影，Portal 仍继承此上下文；没有第二份成员缓存、请求、游标或原生 store。按 ID 和身份类型查找，找不到时明确显示不可用；频道同步失败时上层传入空成员，不能延用旧资料。作用域限于原生消息组件的 import 替换。MessageItem 与输入候选共用 AvatarSlot 薄包装，省略无可靠数据源的状态 badge，其余样式与参数原样转发。

## 验证与边界

先增加浏览器回归并确认旧页面无法展示成员资料卡，再实现适配。桌面 1440×1000 和手机 390×844，DPR 1：临时真实 Core 的 Human 消息验证姓名/handle 与 API 一致；Agent 分支使用明确标注的 timeline 响应展示夹具，不冒充 Worker 发帖或真实模型验收。验证悬停显示、移出关闭、未知在线状态不显示离线；既有候选、发送、成员读取失败恢复、跨频道隔离仍执行。

这批只完成悬停资料。头像点击右侧 inspector 仍未接通，不能称实例详情已完成。原生 AgentDetailPanel 直接依赖 stop/delete/openDM、trajectory 和 runtime 配置等 Raft store/API；下一步应保留原生面板布局，先接 Loom 只读实例状态与 RunAttempt，再逐项接已有命令，不能把原生管理入口整体开放。后端、模型上下文、调度与付费测试均未改变。

检查与正式部署结果记录在[本批证据](../evo/evidence/2026-10-15-message-profile/summary.json)。
