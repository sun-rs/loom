# 一级正文按钮、分隔线与设置抽屉

## 修正合同与单一 owner

用户修正此前“所有桌面详情都有 X”的合同。ChannelHeader 不再根据关闭回调显示
桌面 X；回调保留给手机返回。后续 Thread/Agent/Human 和不可用资料的已有分栏
X/单页返回继续由各自标题栏和共享宽度 owner 决定。没有新增 PWA 特判、业务状态
或导航栈。搜索/动态再次点击当前主导航通过既有 closeSearchPreview 退出预览，
清除子详情与定位，不清除查询/筛选，不改变其他入口的历史层级。

## 分隔线实测

1600×1000 Chromium 隔离页面：搜索列表右边框 2px，正文左边框 2px，两者相邻
构成 4px；动态为 2px+0px。修正搜索正文左边框为 0，由列表持有 2px 可见边界。
拖动区域仍 8px，伪元素仍 2px，调整其位置与列表边框重合；键盘 focus 不额外
绘制 8px 区域的外框，仍显示共享高亮线。未修改拖动算法与宽度偏好。

## 设置抽屉源码考证

证据：本地留存 Raft Web 2026-09-08 `index-BVfbaScj.js` 和
`AgentDetailPanel-DSYPOiPi.js`（manifest 与原文件位于 docs/evidence/raft-web-20260908-current）。
来源和许可边界沿用共享导航合同及 Raft reuse ledger；仅核查发布产物，不复制 bundle。

- `qot`：`hideDesktopClose` 控制桌面关闭按钮；频道 overflow 调用明确传 true。
  根层移动退出为 `md:hidden` 分支，不代表桌面存在退出按钮。
- 根层 `bare: view === "members"`，进入成员时隐藏根层 header；`pde` 的
  page 分支进入 `Hot`，不是叠加一套通用关闭按钮。
- `Hot` 的 `Zn` 成员页 header 只含返回；添加模式回成员页，否则调用根层 onBack。
- 成员资料使用 `Bot` embedded，`onBack: ne` 对资料路径 slice(0,-1)，
  `onClose: we` 调用父层 onClose。
- Agent `Zc` 将显式 onBack 映射到 `backButtonVisibility: "always"`，
  与 onClose 分开。因此资料层返回与桌面 X 同时存在有明确来源。

本地 RoomSettingsDialog/RoomMemberPages/AgentDetailHeader 已符合这几层，保持不改，
扩展真实浏览器测试验证根层无按钮、添加/管理只有返回、资料返回与桌面关闭。
这是指定留存版本的源码核对与本地验收，不声称当前 Raft 在线逐层双边实测。
Multica 无该嵌套抽屉的相同合同，本批沿用既有 owner，不引入其路由结构。

## 验证记录

共享导航测试先复现一级正文 X，另一次先复现重按搜索导航未退出预览，再修复。
分隔线基于修复前 computed style 实测及修复后总宽 2px、命中区 8px 断言。

源码 SHA-256：index `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`；
AgentDetailPanel `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`。

Chromium/Firefox 共享四层导航回归通过；Chromium 搜索预览拖拽/关闭/任务定位回归通过；
Chromium/WebKit 的频道/私聊 × 聊天/搜索/动态桌面与手机标题栏矩阵通过，含删除 Agent
资料及重复缩放；设置抽屉根层/添加/管理/资料回归通过。CSS 变更后重新生成两个
组件的真实浏览器 matched-rules 证据与 UI catalog。附带修正共享模型显示函数
可选 displayName 的 TypeScript 显式 undefined 兼容性，不改执行行为。

全仓 check 仍在既有 `/v1/worker/message-present` parity 注册缺失处停止。

正式部署：安全守卫检查通过，完整备份 `pre-restart-dfab49bc-bb62-4902-b834-1119a0f5e078`
后重启为新进程；冻结 build `5e1f6f2944b42be48c74ddcdc32ac1cd01a834f6e735d311ee354ca2df493808`。
新浏览器只读验证三个大页一级正文桌面无 X/返回、390 返回、搜索/动态接缝 2px，
实际消息列→资料→逐层返回及缩放/reload；设置资料的返回/桌面 X 验证通过。
先前因 active Activation 暂缓的推理说明同包上线。未发送消息、未修改 Agent 配置。
类型检查、正式构建、diff 检查通过；format 仍有 11 项无关既有文件/实验文件告警。
未提交或推送；没有运行付费 CLI，也不声称实体移动 PWA 或当前 Raft 线上双边验收。
