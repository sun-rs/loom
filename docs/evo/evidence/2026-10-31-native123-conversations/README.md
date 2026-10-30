# 完整官方1.21.23候选：频道生命周期与独立单聊

继续采用完整、未修改的Web1.21.23／UI0.7.0。实现位于外部adapter123，复用原版成员抽屉、原生归档／删除确认、SOS弹窗、Role私信入口和DM正文。**未部署候选；正式HTTP200、launchd PID34735与前批相同**。本记录不宣称全站替换完成。

## 接通内容

- 原生成员页选择Role后，通过既有`role.instantiate`新增真正的频道Instance；成员移除解析真实Instance及所属Channel，再调用`room.member.remove`。已知拒绝留在原生确认框显示错误；不能吞掉异常而关闭成成功。
- 当前成员从既有`readCurrentChannelMembers`读取：当前membership为准，新身份用有界latest bootstrap补齐；不依赖首次聊天snapshot，也不重放整段历史、ACK或推进聊天游标。
- 原生归档／恢复／永久删除调用既有SDK所有者及Room因果／幂等围栏。真实测试核对归档刷新保留、恢复、删除频道和已移除实例记录，并保留可复用Role；不从HTTP成功自行推断执行终止。
- 原生SOS停止／恢复映射`room.sos.stop`、`room.sos.resume`。仅发送Human输入的指导，移除原版附带的check_messages/read_history命令。停止请求处于stopping时，原生Promise不进入“全部停止”；同operation的stopped＋pendingTargetCount0才可完成。当前候选对尚缺证明的停止保留“核实”只读入口，不重发停止请求；尚未优化成自动进度刷新。
- Role的原生私信入口创建普通Channel＋新冻结Instance，随后以HumanSidebar.dmOrder显式分类。再次打开复用该显式归类且仅有一个对应Role实例的频道，不猜名字、普通频道或private box。关闭的DM可重新显式打开。
- 新单聊的已确认步骤只在当前UI操作生命周期缓存。成员／分类已知失败后再次点击继续，不重复创建已确认对象；未知发送保持原WriteIntentSlot和原生Promise，经同幂等键核实后才继续后续步骤。刷新后未分类的部分频道仍以普通频道保留，不隐式恢复为DM或悄悄删除。

## 验收

`core-channel.json`：1440×1000、390×844各执行原生成员增加、注入403拒绝后留框／显错、显式重试移除、SOS停止／恢复及指导原文、归档刷新／恢复、永久删除及Role保留。`core-conversations.json`：两尺寸各执行Role入口创建独立单聊、注入分类403后继续而不重复建对象、发消息后SDK账本核实、刷新和再次进入保持同一实例。均为真实临时Core、临时数据和Fake CLI目录，pageerror为空，付费调用0；截图已人工查看。

`unit.txt`共49项通过，包含来源2463文件hash、当前成员无ACK／游标变化、DM同键未知结果核实、已知部分失败、SOS匹配终止证明，以及既有命令／偏好／运行时规则。候选类型与构建、单React/UI运行时、根类型检查通过；原版chunk／dynamic import警告保留。未做后端行为改动，不据此重跑付费模型矩阵。

`pixel-regression.json`14组页面零像素差异，1px偏移反向校验有效；`interaction-regression.json`21组原生菜单／鼠标DnD／分栏零差异。参考版仍是未改官方App＋独立native HTTP oracle；新增SDK membership fixture按真实schema校验，没有把生产mapper作为参考答案。仅共同页面和已登记交互，不扩张成所有Role专属槽／所有业务菜单或真机PWA验收。报告保留原版缺billing/upload夹具和屏蔽SW的诊断，通知未验收。

## 本批发现与修复

1. 新Instance在Kernel已创建，但成员页仍显示旧snapshot：保留`failed-stale-roster-before-fix.json`及红单测；修正当前membership读。
2. 原版removeAgent hook吞掉明确拒绝，ConfirmDialog因回调resolve而关闭：保留`failed-removal-confirm-before-fix.json`及红单测；只在外部精确语义槽补异常传播，其余hook原样不变。
3. SOS核实通过后仍返回旧stopping DTO的早期错误，红测试保留；返回实际核实后的stopped投影，不能只让UI文字看着成功。

测试调试也修正过选择器／时序：实例名称来自真实Agent配置而非不含名称的Instance目录；桌面移除图标须按原版先hover成员行；取消归档按原版会关闭抽屉，需要重新打开；409 stale_context会按既有规则恢复重试，因此拒绝注入使用明确403。没有把这些测试编写错误算成产品缺陷。日志文件只移除ANSI和行尾空白，失败JSON原样保留。

## 保留限制和下一顺序

- 频道实例私密box、原生第三栏／返回关闭、Fork／Side尚未接；独立Role单聊不能代替它。
- 当前SOS浏览器测试在无活动执行目标时验证真实Kernel状态；pending proof由假客户端单测约束。**不证明正在付费CLI中运行的进程已被此候选终止**；后端既有停止证明仍保留。
- 线程与任务／收藏／表情完整命令及分页、文件工作区／评论／预览、平台记忆、通知／PWA、六CLI全部原生表单、已批准移动策略仍待迁移。
- 公开／联合／多Human／Raft云账户等不属于本产品的入口需要继续省略。当前候选保留这些未闭合入口，故不能部署覆盖完整稳定产品。

```sh
npm run build:official-web:native123
npm run test:official-web:native123
LOOM_BROWSER_SLICE=native123-channel-lifecycle LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=native123-conversations LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
```
