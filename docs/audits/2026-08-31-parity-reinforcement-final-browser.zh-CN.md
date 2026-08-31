# 2026-08-31 加固后第三方双边真实浏览器验收

## 结论

本轮由独立审计 Agent 独占真实浏览器取证。**本轮发现的功能阻塞已修复复验，但不是全量无差异通过**：Activity 未读生命周期、头像交互、fake Room/DM/Thread Enter、非空文件树拖拽/键盘/刷新/手机预览均得到真实 UI 证据；InputRequest漏更新、Activity背景与持续禁用、离线小点和手机系统提醒提示等问题均保留了修复前后证据。仍有明确呈现/导航差异和未双边覆盖项，见下表。

本报告不把源代码、单测、主审口述或合成数据的成功等同于官网双边实测成功。

## 环境与边界

- 官网：已登录 `https://app.raft.build/s/hakasemac`。DOM `script[src]` 为 `https://app.raft.build/assets/index-BoAC7nSE.js`；本轮没有发现入口版本漂移。
- 本地第一隔离 fixture：`http://127.0.0.1:4195/`，Host `independent-final-audit-20260831`；独立临时目录 `rah-os-multi-agent-web-boOFh4`，Room `room_831684fa-6f88-483e-926d-156078e99914`。
- 本地第二隔离 fixture：`http://127.0.0.1:4196/`，Host `independent-final-mobile-audit-20260831`；独立临时目录 `rah-os-multi-agent-web-ViPvx6`，Room `room_c76dd173-6c1f-4b5d-827c-1a0a1e55181e`。
- 合成观测投影：`http://127.0.0.1:4197/`，反向代理仅覆写上述4196的inventory `computer.status`与一次故障的`lastSeenAt`，其余API与真实App保持原样。不改Kernel Host、不读写浏览器hidden state；**不是Host停止E2E**。与真实fixture截图区分，文件名前缀为P。
- 两个 fixture 均启用 `RAH_FIXTURE_WORKSPACE_FILES=1`、`RAH_FIXTURE_FIRST_AGENT_INPUT=1`。Alice/Kimi 使用 fake CLI；没有启动真实付费 provider。没有操作正式 4173 服务。
- 桌面两边均实际读取 `innerWidth=1440`、`innerHeight=900`、`devicePixelRatio=1`；手机两边均实际读取 `390×844`、DPR `1`。尺寸以 DOM 读取为准，未把配置值当实际值。官网手机另开独立标签页才成功施加手机视口，原桌面标签页保持不变。
- 官网仅导航、hover、展开、收起、只读查看。没有发送消息、回答请求、claim、删除、保存配置、标全部已读、关闭单条系统通知或启动 Computer。姓名点击插入的草稿通过 `Meta+A`、`Backspace` 清空，并核验 textarea 空值及 Send disabled。
- 打开官网已有对话/已读 Thread 可能触发自然 read；本轮没有点击两条未读 Thread，Activity 仍显示 `2 条未读`。没有读取 cookies、storage、隐藏状态或凭据。
- 遵循 Browser 技能，以浏览器客户端驱动真实页面；截图均实际显示检查，非仅保存即视为通过。产品代码由主审修改，本审计不修改产品代码。

证据目录：[`docs/evidence/parity-reinforcement-final-browser-20260831`](../evidence/parity-reinforcement-final-browser-20260831/)。以下文件名均相对此目录。

## 行粒度双边结果

下表保留首轮取证与发现过程；同一项经主审修复后的最终结果，以后面的“末轮集中复验”表为准。旧截图不删除、不改写为修复后证据。

| 项目                               | 官网前置 / 动作 / 结果                                                                                                             | 本地前置 / 动作 / 结果                                                                                                                                                                       | 判定与证据                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Activity 粉点语义                  | 账号已有 16 条进行中、2 条未读；Chat 中粉点出现；进入 Activity 后点消失，但 header 仍 2 未读；离开回 Chat 点恢复。未点任何未读项。 | Task 回答后在 Computer 页面等待 Alice 的两条 Thread 回复；粉点出现。进入 Activity 后点隐藏、`data-has-unread=true` 且卡片仍 `2 条新消息`；离开到 Computer 点恢复。                           | 状态语义一致。官网 O01/O04；本地 L08/L09。仅进入 Activity 不是 read。                                                    |
| Activity 点颜色、尺寸、坐标、title | 非选中状态点 `10×10`，`rgb(254,125,168)`，左上 `(34,169)`；点自身 title 空、`aria-hidden`；所属按钮“动态”。                        | 点 `10×10`、同色，左上 `(32,171)`；点自身 title 空、`aria-hidden`；所属按钮 title/aria-label“动态”。                                                                                         | 颜色/尺寸一致；本地点左移 2px、下移 2px，不能称像素一致。坐标为1440×900 CSS px。O01/L09。                                |
| 实际 Thread 阅读清未读             | 为保留用户未读，仅打开已读“请查询日期”Thread；官网真实未读→已读转换未触发。                                                        | 点击 Activity 的 Task Thread 卡；打开对应 Thread，显示两条 canonical fake 回复且定位最新回复；点消失、`data-has-unread=false`；返回 Activity 卡片不再有“新消息”。                            | 本地通过；官网清读转换未实测，不伪称双边闭环。L10。                                                                      |
| Activity Thread 目标导航           | 点击已读 `#test 请查询日期`；URL 保持 `/activity?thread=…&open=thread:…&msg=…`，Activity 中栏保留，右侧打开正确 Thread。           | 点击本地 Task Thread 卡；转为 Chat 中栏“已定位原消息及前后文”，右侧打开正确 Thread。                                                                                                         | 目标身份正确，但背景页面不同，确定差异。O07 对 L10。                                                                     |
| Computer 灰点                      | Computer 详情实际显示“离线”；头像灰点 title“离线”，`10×10`，`oklch(0.707 0.022 261.325)`，左上 `(112,113.25)`。未启动 Computer。   | 正常独立 Host 显示“已连接”，绿色点。4197合成offline时title“离线”、`10×10`、同坐标`(112,113.25)`，颜色为`rgb(160,160,154)`。API不可用时是unknown而不是offline。                               | title/大小/坐标一致，灰色色值不同。官方灰点不是未读粉点。合成offline是投影验证，不是真实Host停止E2E。O02、P01/P02、L11。 |
| Computer 根路由                    | 直接打开 `/s/hakasemac/computers`，不清任何浏览器偏好；桌面列表存在，详情为空，中心原文“选择一个频道”。                            | 点击“计算机”直接显示唯一 Mac-Studio 的详情。                                                                                                                                                 | 确定默认落点差异，O08对L09。必须区分根路由、导航记忆及显式点击详情，不把账号当前记忆推广为普遍默认。                     |
| 官网系统 notice                    | 原桌面标签页通知曾为空；新的手机标签页真实出现 `Computer 需要处理 / 1 台离线 / 查看 / 关闭`。只用铃铛打开/收起，仍 `1 条待处理`。  | 4197合成offline产生`计算机 / Mac-Studio离线 / 查看计算机 / 忽略此提醒`。InputRequest另用“需要输入 / 问题 / 查看 Room / 回答”。                                                               | 两类对象分开呈现。官网真实系统项对本地合成投影，不是真实生命周期双边。O05、P02；不能因旧tab空就断言官网无系统通知。      |
| InputRequest 实时到达              | 未制造官网请求、未回答官网请求。                                                                                                   | 第一 fixture Task 已 `waiting_input`，通知两次仍0；reload才出现1。主审修复后，第二fixture的新Task#2通过UI提交，离开到Agents，无reload，自动出现1；回答后即时0。                              | 发现问题后本地复验通过；非官网双边发送验收。L06/L07为修复前，L14/L15为修复后。                                           |
| 打开通知不等于处理                 | 新官网手机系统项打开/收起后仍1，未点“关闭”单项动作。                                                                               | 打开/收起 InputRequest 后仍1；仅填写并发送精确回答 `Yes, remain loopback-only` 才0，任务随后恢复。                                                                                           | 两类对象均证实“查看不等于处理”；处理动作语义不同。O05、L07、L14/L15。                                                    |
| 消息头像 hover                     | Chat 里的 Alice 消息头像 hover，显示 Agent、Computer、runtime、model及最近动态。Escape 后“最近动态”消失。                          | fake Alice 回复头像 hover，显示“在线”、Host、runtime、模型及最近动态；Escape 后 tooltip 不存在。                                                                                             | 本次交互一致；真实字段值因 Agent/runtime不同不要求相同。O03/L03。                                                        |
| 头像点击默认 peek                  | Escape 后点击消息 Alice 头像；右 peek 的“动态”tab实际选中。                                                                        | 点击“查看 Alice 动态”；右 peek 动态选中，Chat 保留。                                                                                                                                         | 当前账号这次点击一致。不能推广为所有账号或所有 Agent 永久默认：官网有记忆/排序偏好。                                     |
| 姓名点击 @                         | 关闭peek，点击 Alice 姓名；textarea 为 `@Alice `；未发送。原生全选删除后空值且发送禁用。                                           | 相同动作得到 `@Alice `；原生全选删除后空值且发送禁用。                                                                                                                                       | 通过。与点击头像打开peek是不同动作；未用 `fill('')` 假设清草稿。                                                         |
| Room Enter                         | 官网仅保留只读草稿验证，不发送。                                                                                                   | Room 输入 `Final independent audit: Room Enter fake probe.` 后按 Enter；出现人类行及 Alice fake 回复，草稿空、发送禁用。                                                                     | 本地真实UI通过；官网发送未实测。                                                                                         |
| DM Enter                           | 官网禁止发送，未测。                                                                                                               | 在 Kimi DM 输入独立probe并 Enter；人类行、Kimi fake 回复、空草稿/禁用发送均观测到。                                                                                                          | 本地通过；非双边发送验收。L05保留DM上下文。                                                                              |
| Thread Enter 与 Shift+Enter        | 官网禁止发送，未测。                                                                                                               | 点击消息“在消息列中回复”；Shift+Enter保留换行，精确草稿为 `Final independent audit: Thread\nEnter fake probe.`；Enter发送，Thread出现一条两行回复，输入空、回复按钮禁用，父消息显示1条回复。 | 本地通过。L05。                                                                                                          |
| 非空 Agent workspace               | 官网桌面和手机进入Alice工作区均“加载文件失败”；Computer离线。仅记录root/刷新/隐藏开关，不推断成功tree。                            | 独立fixture确有 `notes/guide.md`、`MEMORY.md`、`preview.html`及隐藏文件。展开notes并选guide后显示真实fixture文本。                                                                           | 本地通过；官方成功tree/preview不能双边验证。L01/L02/L12/L13；O06。                                                       |
| 文件选中与刷新                     | 官网离线，无可选文件，因此未测成功态。                                                                                             | guide行 `aria-selected=true`；背景 `oklab(0.748915 0.162332 0.00199008 / 0.2)`、右边框 `2px solid rgb(254,125,168)`。刷新后 notes仍展开、guide仍选中、preview仍同内容。                      | 本地通过；非双边。L02。                                                                                                  |
| 文件树真实拖拽                     | 官网离线，不把源码约定冒充实测。                                                                                                   | 桌面全页workspace树初始256；separator x556,y129,w8,h721。真实鼠标从(560,430)经590/630拖至(660,430)，树与aria-valuenow变356、separator x656。                                                 | 主审提到的“拖拽不动”未复现；真实拖拽通过，不仅键盘通过。L01/L02。                                                        |
| 文件树键盘与边界                   | 官网成功tree不可用，未测。                                                                                                         | separator Home→160，End→600，ArrowLeft→584；notes ArrowLeft折叠、ArrowRight展开。                                                                                                            | 本地通过，min/max/步长与计划一致；非双边。                                                                               |
| 复制路径反馈                       | 官网可见复制入口，本轮未向clipboard读取确认。                                                                                      | 点击复制路径后 status“已复制”，按钮名仍“复制路径”；首次观测elapsed0存在，后续elapsed1723ms不存在。                                                                                           | 本地反馈消失实测；不是精确1500ms边界证明，clipboard内容未读取。                                                          |
| 桌面窄 peek 工作区                 | 官网offline不能测内容。                                                                                                            | 380px peek为compact树/预览切换；无文件树separator。选文件后仅显示预览与“关闭文件预览”。                                                                                                      | 明确不是全页拖拽失败，而是不同宽度下的compact模式。L04。                                                                 |
| 手机文件预览/关闭                  | 新官网手机tab实际390×844 DPR1，进入工作区显示加载失败，不能验证文件关闭。                                                          | 实际390×844 DPR1：展开notes，选择guide变预览；点击关闭预览回树，notes仍展开、guide仍存在；返回成员列表恢复底栏。document scrollWidth=390。长文本在预览内部横向滚动。                         | 本地通过；官网成功内容未双边。L12/L13、O06。本地与官方手机Agent页header高度/底栏组织仍肉眼可见不同，不宣称全像素一致。   |

## 修复复验与异常记录

### InputRequest 漏更新

1. 第一fixture在约17:27通过真实composer创建Task#1、指派Alice。Chat明确显示`waiting_input`；离开/返回、打开通知两次仍为0。
2. 截图L06记录等待任务与空通知同屏；本审计主动reload后，立刻得到1项真实问题，截图L07。这是本轮发现的失败，不是没有生成InputRequest。
3. 主审收到复现后修复；本审计不以主审测试结果直接判通过。
4. 第二fixtureTask#1在Computer页面无需reload出现通知。为了排除已有请求/HMR干扰，修复后再次由UI提交全新Task#2（17:36），离开到Agents；后续观察自动出现1，L14。没有在两者之间reload。
5. 在手机Inbox回答后，0项待处理，L15；随后Task#2确为submitted，并产生Alice两条canonical fake回复，L16。没有精测从canonical生成到UI可见的毫秒延迟，因此仅证明无需reload到达，不能据此宣称严格5秒SLA。

### Host fault injection 的有效范围

第一fixture由一个进程同时承载API和AgentHost loop。本审计仅针对该临时DB注入offline观测，试图保持API在线。实际AgentHost认证拒绝offline身份，fixture主进程退出，API随之不可用；这不是“真实Host离线、API存活”成功实验。

故障后真实UI进入“状态未知 / 观测暂不可用”，保留先前CLI清单但Computer上的Agents为不可用；Kimi DM标题为“状态未知”、composer disabled。L11可证明fallback不假报online。不能用此截图证明offline系统notice的发生/消除。

注入脚本[`inject-fixture-host-observation.mjs`](../evidence/parity-reinforcement-final-browser-20260831/inject-fixture-host-observation.mjs)仅允许本审计精确临时DB与Host，未读取credentials。已执行restore移除测试trigger；fixture进程已退出，第二fixture独立接续，正式服务未重启。此脚本不是可用于真实Host停机验收的通用方案。

### 随后补充：明确合成 API 的离线投影

经主审确认，使用[`synthetic-observation-proxy.mjs`](../evidence/parity-reinforcement-final-browser-20260831/synthetic-observation-proxy.mjs)在4197挂载真实App。只代理本审计4196，inventory必须精确匹配自己的Host才覆写；没有代理官网或正式4173，没有输出请求header/凭据。

| 合成前置与动作                       | 真实App结果                                                                            | 证据              |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ----------------- |
| 初始unknown，真实CLI inventory仍可用 | Computer状态未知、灰点；Computer上Agents不可用；Alice DM标题状态未知；没有系统notice   | P01、DOM          |
| 控制台切offline，等待真实App观测更新 | Computer离线；出现1条独立系统notice；Computer和铃铛各有attention，选中时点隐藏         | P02               |
| 离线时打开Alice DM及资料             | DM标题与资料均“离线”；此时sidebar/header/profile头像缺少灰点；Member Host分组仍绿点    | P03/P04，已报主审 |
| 点击“忽略此提醒”                     | Inbox0，铃铛attention清除；Computer仍离线、Computer rail粉点仍在。没有回答InputRequest | P04               |
| 控制台online                         | Computer恢复已连接、Computer上Agents恢复可用                                           | DOM               |
| 再次offline，新的lastSeenAt          | 新一轮系统notice重新出现1；旧outage的忽略没有吞掉新项                                  | P05               |

补测同一offline页面的390×844手机视图：Inbox内有1项系统notice，但关闭时底栏Inbox没有粉点/数值，DOM仅svg和文字。官网手机铃铛有粉点和aria待处理1。P06对O05，已报主审。

上述通过仅说明UI按给定API观测投影，并不证明Host心跳/停止/恢复的真实因果链。这里保留的是首轮成员/头像小点与手机system notice问题；修复后证据见末轮表，不以状态文字正确掩盖曾经的小点缺失。

## 末轮集中复验

| 项目                     | 官网前置 / 动作 / 结果                                         | 修复后本地前置 / 动作 / 结果                                                                                                                                                                                             | 最新判定                                          |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Activity粉点             | 1440×900，O01：10px，rgb(254,125,168)，(34,169)                | 同尺寸DPR1，P08 DOM：10px、同色、(34,169)                                                                                                                                                                                | 原2px偏移已消除                                   |
| Computer灰点             | O02：title离线、10px、(112,113.25)、oklch(0.707 0.022 261.325) | 4197合成offline，P09 DOM：四项均相同                                                                                                                                                                                     | UI投影点位与色值一致；仍非真实Host停止E2E         |
| offline Agent/Host点     | 官网离线Agent头像有灰点                                        | P07/P08：sidebar/header/profile头像均有title离线的灰点；Member Host分组亦灰点；色值同Computer                                                                                                                            | 原缺灰点/Host假绿已修复复验                       |
| 手机system notice提示    | O05：通知展开时铃铛粉点仍在                                    | P07：390×844 DPR1，Inbox aria“有待处理事项”、粉点在关闭/展开均存在，dialog1项                                                                                                                                            | 原手机漏提示已修复；数量措辞并非逐字一致          |
| 桌面通知展开             | 官网通知提示不等于read                                         | P09：展开时rail仍有粉点，data-has-unread=true                                                                                                                                                                            | 原选中抑制通知点已修复                            |
| Activity背景/filter/目标 | O07保留Activity，右Thread为正确目标                            | P10：未读筛选打开Task#2，Activity/未读筛选保留，右Thread正确；阅读后仅该卡从未读列表消失；reload恢复同目标和filter。最终直连4196：不reload连续Task1→Task2、提及→全部保持当前Thread；关闭后改未读并reload，不复活旧Thread | 背景/目标/筛选/URL恢复及连续可操作性通过，最终L18 |

Activity Thread导航曾出现第二个问题：右侧已完整显示两条回复且未读已清，中栏所有卡打开/标完成/全部已读仍持续disabled；reload后解除，再开另一个Thread复现。4197合成投影及直连4196均观察到，故障证据L17。主审修复后，本审计直连4196、不经代理，连续打开两个不同目标，两个目标的中栏disabledCount均0；随后切filter、关闭、再切filter和reload均无目标复活，最终L18。该阻塞已关闭。

最后布局回归：同一1440×900、DPR1，Activity打开Thread后分别切Search和Tasks。两页均无Thread DOM，main边界为x64至1440、宽1376，没有因隐藏Thread state产生空白第三列。截图L19/L20已实际检查。此项仅本地回归，不扩大为搜索/任务全功能双边通过。

## 未实测、保留差异与交付限制

- 官网成功workspace文件树、刷新保留、pink选中、拖拽、键盘、copy时间、HTML预览以及手机关闭：因Computer离线无数据，不得标双边通过。
- 本地真正Host离线且API仍可用：本轮证据不足。offline系统notice忽略/恢复/新outage已补合成UI投影，但不能升级为真实Host生命周期通过。Agent全部入口仍未穷尽。
- 官网所有发送/回答、实际两条未读的清除、付费模型/provider执行均未做；fake通过不等于真实provider通过。
- 正式发布与4173版本：本轮没有检查或重启正式服务，验收对象为隔离fixture加载的工作树版本；不能据此宣称正式发布、安装产物或4173已运行本轮构建。
- 竞态导航的延迟旧响应、连续换目标/切tab后的最终落点，本轮未人工制造网络延迟；不能以正常目标点击通过覆盖race测试。
- 浏览器历史Back：尝试原生Meta+[未产生URL改变，不能证明历史跳转实际触发，因此Back未计浏览器通过。已完成的是真实点击目标、切filter、关闭与reload恢复；没有用脚本调用history冒充用户Back。
- 模型/角色保存、Tab focus trap、全站搜索、任务管理、上传下载/外部文件链接不是此次最终加固复验完整范围；此前审计不替代本轮缺失证据。
- 首轮Activity粉点坐标、灰色色值、offline头像缺点、手机系统notice提示、Activity背景与持续disabled均在末轮修复复验。仍保留Computer根路由默认落点、手机导航/Agent页布局等差异，不宣称全像素一致。
- 所有截图是真实页面，在保存后实际显示检查。截图包含本用户已登录页面的对话和本机路径，仅作本地审计资料，未对外发送。

## 清理与交接

- 临时浏览器viewport已reset；本审计新建的全部标签页已关闭，浏览器已释放供主审接续。
- 4197合成投影已通过其专属exec session `18573` 发送Ctrl-C结束；4195无listener，原fault-injection trigger已移除。未删除用户资料。
- 应主审要求保留4196供抽查：专属exec session `63044`，fixture/API进程经`ps`核验为PID `50659`（`node --experimental-strip-types scripts/run-multi-agent-web-fixture.mjs`），daemon端口59134；Vite子进程PID50672、端口4196。抽查后需重新核验PID命令行，再向50659发送SIGTERM，勿套用到正式服务。
- 报告/审计脚本格式检查及`git diff --check`通过；不宣称工作树干净、已提交、已发布或正式daemon已更新。
