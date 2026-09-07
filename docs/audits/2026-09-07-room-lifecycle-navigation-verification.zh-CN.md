# Room 生命周期导航隔离与 Task 虚拟窗口

日期：2026-09-07。范围：独立 `rah_os`；单一工作 agent 实施与自测，不称独立审计。
状态：修复已实现并部署到正式本机工作台；自动化与双浏览器证据见交付记录。

## 本批发现与修复

旧 App 的 leave/delete 在服务端接受后，无条件使用发起时的 Room 列表覆盖当前目录并跳转。
用户等待期间通过浏览器 Back 返回 Search，旧回执仍会重新切回 Room；同类问题会影响更晚的
Workspace/Room 导航。现在仅以函数式更新移除操作的原 Room，现有 navigation generation
决定是否仍可切换位置。旧回执不能覆盖新目录、关闭新页面或夺走其导航。

浏览器历史导航会关闭原频道设置；设置实例按 Human/Room 标识隔离，迟到请求的错误或
pending 状态不进入另一个 Room 的设置。退出失败由原确认框显示可访问的错误，不再把已经
处理的失败重新抛为全局未处理异常。所有业务写入继续由原 Kernel owner 完成。

没有重写 Room/Task/AgentHost/记忆，没有修改数据库结构或放宽 ACL。

## 来源和公开频道边界

[设计与下一段权限边界](../design/room-lifecycle-navigation.md)记录授权 Raft bundle 的版本、
位置和 Multica 比较。Raft 提供 Channel 生命周期/确认框/加入按钮的产品参考，不能从其源码
直接声称同一迟到回执场景在官方通过。本轮另外只读打开官方频道设置及退出确认后取消，
未执行退出、删除或设置修改。在线入口仍为 `index-BVfbaScj.js`；确认文案明确保留公开
Thread 关注，与冻结来源一致。此次视口 1280×720、DPR 2，只核对语义，不混入同尺寸像素验收。

公开频道自助加入仍未实现。现有实现统一要求 membership 才能读取；官方则区分公开阅读、
加入发言和公开 Thread 关注。下一段必须先在既有 policy owner 分离这些权限，逐入口验证
撤销，再补 join 按钮；简单放宽 `requireRoomMember` 会同时影响 Agent 投递和私密内容。
B016 仍为 needs-feature，只把已有生命周期 owner 和新增场景登记清楚，不升级为全项完成。

## 失败先行

- `rah-room-lifecycle-J0VgGg`：后端真实接受退出，浏览器已 Back 到 Search；旧回执仍改回 Room URL。
- `rah-room-lifecycle-O98KJS`：服务端已接受退出，故意丢失回执后出现全局 `RahClientError`。
- `rah-room-lifecycle-BCsov4`：请求尚未写入后端即失败，退出确认框没有可见错误。
- Formal browser policy 单元反例：当前 SDK 的 `/humans/profile`、`/agents/get` 被旧守卫拒绝。
  修复仅开放确切只读路径；旧错路径、退出、删除、成员角色和资料写入仍被拒绝。

浏览器专项使用临时数据库、Fake providers 以及真实 authenticated API。服务端实际接受后
再故意延迟/丢失回执，不能把 fixture success 当成业务完成。桌面与 390×844、两浏览器覆盖
leave/delete、失败反馈、重试、Back、新页面保留和 reload；独立 rooms.list 确认操作结果。
退出后目录不可见不代表永久删除；delete 本身使用独立操作和既有内核门禁。

## 同批发现的 Task 复刻漏项

Firefox 完整页面族在 1,001 个任务的续页位置再次失败，并报告 `out of memory`。
本轮保留失败回执 `rah-ui-foundations-VDDfE9`；不能沿用上一批“再跑一次成功”作为根治证据。
回查冻结 Raft 源码，确认官方看板和列表都使用 `cce` 虚拟窗口与 `L8` 跨组锚点；本地原先
把所有已加载卡片直接挂载。新增测试 `rah-task-virtual-qUmsMr` 先证实 500 条任务导致 DOM
超过上限，再移植该来源已有的结构。详见[版本、owner 和差异](../design/task-virtual-window.md)。

共享 UI 层负责有界挂载、实测高度、锚点和跨窗口 Tab；原 GlobalTaskBoard 继续组合卡片、
DndKit 与原有业务动作。数据分页、刷新和 canonical Task 状态没有改写。原 1,001 任务测试
仍核对续页 cursor、重复刷新较早页和状态更新，只把“离屏卡片始终存在 DOM”的错误前提
改成实际滚动访问。Task 专项覆盖双浏览器、双视图、桌面/手机、首尾滚动、移除视口前任务
后的锚点保留和双向键盘边界。最终结果待下方交付记录核实。

额外的浏览器定位区分了两个问题：Firefox 单次超大 wheel 被限制为一屏，测试现按实测位置
连续滚动；Chrome 完整 Task 流程的 `rah-ui-foundations-VYDwiy` 捕获 React lifecycle 内
`flushSync` 错误，Task 虚拟栈现在与既有 MessageTimeline 一样关闭 TanStack 同步 flush。
二者均保留失败证据，不把测试驱动问题与产品修复混称为原 OOM 的全部成因。
Firefox 另一次整套复跑 `rah-ui-foundations-n9g8TU` 在 Human 拒绝态重试按钮的一次性样式
读取中返回空串；目录刷新可替换该节点。验收现等待当前连接的重试按钮并保留 2px 边框
断言，未修改生产样式，也不接受空样式作为成功。键盘边界专项在刷新后通过真实滚轮定位、
等待布局帧，再对当前窗口边界执行双向 Tab，避免把测试人为聚焦的离屏旧节点当成稳定边界。

## 正式验收层收口

上一批外置的 Human 正式页面烟测已进入仓库 `ui-human-formal-browser-scenarios.mjs`，由现有
Settings 正式验收 runner 调用，沿用同一受约束请求守卫、构建标识、数据库快照和截图路径。
正式页只读，不在用户 Room 上测试退出、删除或角色变更。

## 交付记录

本批证据保存在 `/Users/sun/Code/reviews/rah_os/2026-09-07-room-lifecycle`。
Task 专项最终回执为 `rah-task-virtual-rf6ciJ`：Chrome/Firefox、看板/列表、1440×900/390×844，
千条投影首尾滚动、挂载量不超过 80、刷新锚点与双向 Tab 全部通过。截图已人工查看。
该数字是本测试的 DOM 上限，不是 Task 数据容量或全产品性能承诺。

正式候选 Web build：`3d40ebab637919d21ae9c7b17e630e4e58f653a2be4ff7565da86e8a48bfff1b`。

- `npm run check`、`npm run format:check`、`git diff --check` 和正式 Web build 通过；本批未提交、推送。
- Room 生命周期：`rah-room-lifecycle-gJMSww`，16 场景通过。
- 完整页面门禁：Chrome `rah-ui-foundations-AkBRpp`、Firefox `rah-ui-foundations-97iEif`，各 14 组通过，包括原 1,001 Task 续页/刷新场景。
- 四份隔离浏览器回执均核对 993 个输入文件，结果见 `verified-receipts.json`。随后只修正正式 Settings runner 的截图清单：保持 48 张 Settings，并另要求四个确切 Human 截图文件。该 runner 已重新在正式页通过；产品和其他门禁代码未变，差异及旧/新 SHA 见 `post-browser-verification-delta.json`，未改写原成功回执。
- 正式旧实例 6386 在确认 idle、完整备份及复核后平滑退出；新实例 49308 服务 `http://127.0.0.1:4173`。备份为 `/Users/sun/.rah/backups/pre-restart-763c4829-1472-4b1b-a5ae-e47f6b9a18aa`，加载上述冻结构建。
- 重启后正式 discovery `rah-discovery-formal-zXmOmA`（8 张截图）、Settings/Human `rah-settings-formal-Nid6au`（48+4 张截图）均在 Chrome/Firefox 通过，无未声明请求/页面错误。正式页不执行删除、退出或付费 Provider。
- `persistent-before.json` 与 `persistent-after.json` 完全相同：6 Room、43 Message、2 Task、378 Room event，4 Agent/35 定义修订、4 runtime profile/31 修订，以及 37 个私有记忆文件。正式读取正常推进已读投影，不改变协作内容。
- 已查看正式 Human 桌面/手机及 Task 截图。CUA 前台复核因 Mac 锁屏受阻，没有声称完成前台手动操作；正式真实浏览器自动验收及截图查看已完成。

## 剩余限制

- 正式 Human 桌面截图仍可见原 Agent 与 Human 两处粉色高亮，排入下一批导航选中一致性及官方同条件复核，不以本批正式烟测宣称该页面族完全对齐。
- 本批不是完整 Room 页面族验收：公开发现/加入/关注、全套 archive/SOS/Task/Thread 组合仍待推进。
- 导航后的丢失回执测试证明新页面不受旧请求污染；不证明留在原页面时所有不确定写入的自动恢复。
- 本批已复现并修复 Task 全量挂载这一来源明确的缺陷；完整门禁中的同一续页场景通过也不等于证明所有 OOM 成因或长期压力测试通过。Human 拒绝态测量与 Task 滚轮/焦点测试的异步前提单独记录。
- 没有提交、推送或调用真实付费 Provider。

## 2026-09-07 解锁后的复核纠正

解锁后使用正式页面真实指针点击 Human 并检查选中状态：只有一个实际选中项；
此前截图中另一处粉色来自 Agent 行 hover。该观察没有复现为导航选中缺陷，
不据此修改导航逻辑。原锁屏及截图记录保留；后续证据见
[公开频道增量审计](./2026-09-07-public-channel-discovery-and-join-verification.zh-CN.md)。
