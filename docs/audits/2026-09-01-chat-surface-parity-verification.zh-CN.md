# 聊天截图差异复审与修复验收

本轮结论：截图指出的是有效缺口，不能宣称 Chat 与 Raft 全量一致。
本文只证明下列行为，不沿用旧“核心完成”结论，也不是第三方独立审计。

上游身份、源码 offset 与 owner 见[先行合同](../product/2026-09-01-chat-surface-parity-contract.zh-CN.md)。

## 逐项结果

| 用户反馈                   | 查明的问题／修复                                                                                                                                                              | 仍保留的区别                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 列表字体、修改／排序／添加 | 原 DM 用 b 强制700，拿 role 作描述；改14/20/500及独立灰色description，名称最多70%。新增频道铅笔，复用真实设置；频道+本就存在                                                  | 手动/最近/A-Z、拖拽置顶、已保存、联合频道未完成；Workspace栏是本地信息结构差异    |
| 默认边栏与拖动黄色线       | 当前官方源码/实测默认240，并非320；本地缺宽度保存、上限错为400。已修为180–320、拖后刷新保留、黑线                                                                             | 保留本地额外的键盘Arrow/Home/End支持，不复制中央服务器                            |
| 头像                       | 预设素材及random算法确实来自Raft，不是临时手绘。但旧CLI占位key落入随机几何图案                                                                                                | 四种旧provider占位改官方预设别名；不是给真实Agent改名。用户明确选过的random仍保留 |
| 私信标题状态               | 状态原在副标题新行；已移到名称同行并复用统一presence点                                                                                                                        | 本地“休眠·等待唤醒”不等同官方离线，必须保留真实生命周期语义                       |
| 空消息                     | tg结构移植：36px图标、暂无消息、开始对话吧。；18px/600标题及14px说明                                                                                                          | 双边若一边存在通知提示条，剩余可用高度不同，不能据此误判居中                      |
| 消息右上3图标              | 官方为消息列回复／emoji回应／收藏。本地已有回复并真实打开Thread，补键盘focus显示                                                                                              | 回应、收藏缺canonical能力；本批没有假装实现后两按钮                               |
| 头像悬浮摘要               | 280px、姓名状态同行、handle、Computer/runtime/model/effort、描述分区、最近活动。Computer改可读名称；资料/动态独立失败。预览文字不再拼接整条tool input；颜色按Raft Att活动语义 | 完整工具别名归一化、所有权限组合/失败态的双边核对仍未覆盖，不能称整个预览100%复刻 |

## 2026-09-02 追加收口

- 输入框自身的浏览器 focus ring 被移除；普通 input/textarea 统一保留 Raft 的
  右/下 `4px 4px 0` 位移硬阴影，不再错误加粗左/上边。
- 消息时间轴按本地日历日插入跨日分割线，成员加入使用 canonical Room event 生成系统
  提示；这两类展示不会伪造普通 Message。
- 离开底部后显示“回到底部”，新消息不会抢走用户正在阅读的位置；消息工具栏先随消息
  hover 黑框确定，再用 150ms opacity 延迟出现，键盘 focus 仍立即可达。
- ready/idle 映射为稳定绿点；thinking/working 映射为黄点并仅在活动时闪烁；offline
  为灰点。DM 底部复用同一 canonical presence，不再靠前端超时自行把 Agent 变灰。
- Human 自定义头像现在与 Agent 头像一样投影到 Room 消息，仍保留无头像首字母回退。
- 账户/服务器资料头像采用 Raft 官方上传 DOM 合同，字节由 daemon 验证和持久化；
  不是 data URL、localStorage 或新的像素头像生成器。

## 实际验证

- 双边1440×1000、DPR1，官方登录会话；实查侧栏sort菜单“手动/最近/A-Z”、空Kimi私信、实际computed字体、已有消息三按钮和Alice头像悬浮卡。
- 隔离4201：独立临时状态和host id，真实daemon + Fake CLI。鼠标拖动至240、键盘至320后刷新仍320，坏存储/拒绝存储单测回退；拖动线computed黑色。
- 从Kimi私信点击Agent Council铅笔，在对应频道修改描述并保存；原DM没有被误改。
- 隔离Human用Enter发送，获得明确标注Fake CLI的canonical回复；姓名点击插入`@Kimi `，Shift+Enter保留换行。
- 头像hover打开；移入卡片保留；移到空白后关闭；Escape关闭；点击打开右侧380px面板，默认动态；消息hover后回复按钮打开真实Thread。
- 390×844：相同组件、document scrollWidth390，无横向溢出；头像点击默认动态正常。
- 正式4173：只读打开已有Codex DM和头像预览，显示Mac-Studio、真实已配置的Runtime默认/effort默认、历史动态；点击头像打开Activity。没有发送测试消息，也没有调用付费模型。
- 全量check：687 package测试（685通过、2项opt-in跳过）、106 Web单测、34真实回调回归；共827项、825通过、2跳过。TypeScript、Prettier、diff检查、正式build通过。build仍有大chunk告警，未在本次引入拆包重构。

## 尚未完成能力的补强顺序

1. Human×Workspace导航偏好owner：版本化持久化排序模式、手动顺序、置顶；一次接通section排序、频道偏好与拖拽，避免三套本地状态。沿用Raft版本冲突/重载/回滚边界。
2. 收藏：Human私有saved item读写和分页、去重、删除、ACL复检，再接消息bookmark和已保存入口。不能拿普通浏览器缓存充当持久收藏。
3. 回应：消息×用户×emoji的幂等添加/取消和聚合投影、权限及重连，再移植官方emoji弹层。不是Task状态或普通消息正文。
4. 继续核对消息分组/时间、长消息折叠偏好、头像预览工具别名与各错误态。当前未验证区域逐项保留缺证，不给整站完成百分比。

## 正式交付

重启前无活动Activation/RunAttempt或Task；备份位于
`/Users/sun/Library/Application Support/RAH OS/backup-before-chat-parity-lmWfg8`。
首次重启后逐行比较：2 Workspace、6 Room、16 Membership、2 Message、4 AgentDefinition、8 DefinitionRevision、4 Policy、8 PolicyRevision全部不变；3个agent-memory文件哈希不变。
最终字体/长名称微调已再次构建并安全重启：正式PID42440，冻结目录
`.workbench-web/8e4a2504ae715374437fcf56fbc866ea4291bb0cabe7f0d97b6b44ef75131f96`，
真实新页脚本 `/assets/index-CKvPoxAU.js`。新备份为
`/Users/sun/Library/Application Support/RAH OS/backup-before-chat-final-zpwScA`。
上列8张业务表再次逐行不变，supervisors目录5个文件哈希不变。
最终1440px实页四条私信均500/14px/20px，长名称124.59px，描述47.41px；
保留2条原消息。390×844实页scrollWidth390，最后恢复了用户窗口尺寸。
额外只读检查已有DM的Tasks和Files空态，不构成这两个模块全量验收。
隔离4201已停止；正式用户审查地址为 `http://127.0.0.1:4173/`。
