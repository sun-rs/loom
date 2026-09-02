# Agent 资料密度与操作颜色修复合同

## 来源与设计审查

基准为授权 Raft 登录后页面与冻结的
`docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`，SHA-256
`b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`。
`qc`（UTF-16 128483–144890）拥有资料滚动容器、头像标题和操作区；
`hc`（73882–105139）拥有字段、信息和运行时配置。

2026-09-01 双边实际视口 1440×1000、DPR 1。官方 Alice 的资料内容高
1051px，滚动视口 908px；首个操作 y=895，所有祖先均没有 sticky/fixed。
因此“操作永远无需滚动”不成立，不改为固定操作栏，不裁掉信息来伪造首屏一致。

官方操作：section padding 16px 20px，标题下间隔 12px，按钮高 40px，
按钮间隔 8px，删除前没有额外间隔。橙色 #f8a16f、红色 #f97264、
模型/成员紫色 #bbafe6，与已有生成 token 一致。

本地确认的问题：标题下额外 margin-top 29px、删除前额外 24px；
窄屏头像区强制 min-height 136px、信息强制单列；
`--purple` 未定义，模型/成员标签落成透明白底；所有操作图标缺失；
报告按钮因 native disabled + 全局 opacity .45 被整体洗白。

## 施工边界

1. 保持一个正常文档流滚动区，沿用官方 20px padding、40px 按钮与 8px 间隔。
2. 姓名和状态同一行、handle 下一行；长名称可省略但保留 title，正文完整换行。
   创建信息按内容宽度自然排列；窄屏不额外增高 hero，不强制两项创建信息单列。
3. 使用已有 lavender token，补官方操作 SVG 几何。消除其他 authored CSS 中
   同一无效 purple 引用，不修改冻结 token 来源。
4. 移除运行时区误标为“人设指令”的 role 摘要；真实人设仍在管理配置中。
   “已创建的 Agent”没有投影时不伪报 0，明确尚不支持。
5. 不为颜色而启用假功能：管理仍打开现有配置，诊断仍打开真实动态；
   restart/reset、报告仍 native disabled，无 mutation handler。
   对“能力尚未提供”的按钮保留基准底色与黑边，以可见“暂不可用”和禁用语义
   表达能力状态。这是明确的本地适配，**不是**官方 enabled 状态的功能一致。
   权限拒绝等普通 disabled 态继续使用原有淡化规则。

owner 为 AgentProfilePane / agent-directory.css；不改 daemon、CLI、记忆或权限。
无需引入 Multica/OpenAgents：Raft 已给出确定的布局和按钮规格。

## 验收

先新增失败回归：颜色变量、操作间距、窄屏密度、未实现操作仍禁用与显式说明。
再修复，运行全套 check、格式检查和正式 build。浏览器测试同尺寸正式/官方页、
390×844、长名称、资料滚动、管理打开/关闭、诊断跳转、禁用操作无副作用。
修复后检查在途工作、备份、重启正式持久版本并重新检查，不用 fixture 代替交付。
