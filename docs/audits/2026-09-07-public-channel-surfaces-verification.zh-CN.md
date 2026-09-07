# 公开频道 Tasks、Files、Thread 与收藏修复验收

范围更新（2026-09-07，用户后续决定）：本报告保留实现/测试历史；其中公开频道优先收口、
暂停其他主线施工的要求已撤销。多 Human 功能整体延期，按
[单 Human 主线决定](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)继续推进。
延期不代表公开频道完整复刻通过。

本报告只适用于独立 `rah_os`。本批代码已交付正式本机工作台；公开频道整项仍不标记完整复刻，
不切换到其他页面族。设计/来源与权限 owner 见
[公开频道合同](../design/public-channel-discovery-and-join.md#2026-09-07-public-surfaces-continuation)。

## 已闭合的本批行为

- 非成员 Tasks 读取复用有界 Task projection；任务卡片可打开 Thread，修改和拖拽仍受写权限限制。
- Chat 使用 canonical Principal 作者和可见根消息的 Task/Thread 标识，不再用简化作者替代。
- 已有 Thread 和无回复根消息都可打开。单纯读取不创建 Thread、Room event、Inbox 或 Activation。
- 桌面保留 Channel 与 Thread，移动端返回频道；Thread 中加入后停留在原消息列，复用原 composer。
- Files 复用原列表、附件权限与空态组件；tab 由 URL owner 维护，刷新不退回聊天。
- 非成员个人收藏可保存、刷新和从 Saved 回跳；不产生 Room event。公开资格撤销后拒绝读取和重放。
- `canReact` 来自服务端成员关系。reaction mutation 包括重试仍显式 requireRoomMember；完整 sync、
  ACK、Task 写入、上传、Agent execution 不放宽。

## 实际验证

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-public-closure`。

- RED：`surface-red.log`、`root-read-red.log`、`chat-task-red.log`、`ui-red.log`、
  `tab-reload-red.log`、`saved-navigation-red.log`、`join-thread-red.log`。
- `check-final.log`：918 项共享/后端通过，2 项付费 opt-in 跳过；355 Web、34 parity、9 formal-policy 通过。
- `format-accepted.log`、`git diff --check` 通过；正式 bundle 构建通过。
- `public-final-4.log`：Chrome/Firefox × 1440×900 / 390×844 四组通过，运行期间输入快照一致。
  原消息打开、任务进入/返回、Files 刷新、收藏、撤权清屏、Saved 回跳、加入/发送/刷新、离开后关注均有断言。
- `lifecycle-final.log`：Chrome/Firefox × 桌面/移动 × 退出/删除 × 正常/丢回执，共 16 组通过。
  此后仅公开频道测试增加了等待 Firefox 文档/输入框就绪的条件，没有改动产品代码。
- 已查看最终桌面/移动截图。先前 candidate/final 失败日志保留，不冒充通过。

最后两项测试时序修正有明确依据：Back 后等待实际 Search 文档；刷新后等待 composer 可用、
确认真实焦点再按 Escape。官网观察的前提是 composer 聚焦，不能对着仍聚焦的空搜索框测试同一结论。
任务与消息可见不等于完整 Room 同步完成。

## 正式实例恢复

正式 URL：`http://127.0.0.1:4173`。
Web build：`4b0bdfa59baf3cca31bb3725305a33ceaf344db6c3718e03c77ef17da27ea51f`。

恢复前原进程已不存在、4173 无监听，不能声称执行了不存在实例的 graceful stop。
已检查没有 queued/leased/quarantined Activation 或活动 Run/Process/Placement/管理 fence，
完成并核验 `formal-state-backup` 后恢复正式 daemon，实际新 PID 为 15539。
`formal-accepted.log` 验证新 Chrome/Firefox 页面、真实 bundle 和 8 张截图；没有使用 fixture URL。

`formal-before.json` / `formal-after.json` 与 `persistent-comparison.json` 证明：6 Room、43 Message、
2 Task、378 Room event、4 Agent/35 revisions、Runtime 配置和 37 个私有记忆文件摘要完全一致。
正式浏览器阅读更新了个人 read frontier，因此不声称所有数据库字节完全未变。
没有提交、推送、发布远端或运行付费 Provider。

## 仍未收口，继续留在公开频道

前端：公开预览的频道搜索/详情入口、任务筛选中完整 Agent/本人身份接线、Thread 回复摘要头像与
完整菜单/引用跳转仍须与已加入视图合并核对；不能把三个 tab 出现当作整个页面族完成。
任务列表分页是有界 current keyset，未宣称具有冻结消息 ceiling 的 Task 状态快照语义。

后端：本批 Human 权限边界已通过上述测试；Raft Agent 侧 channelJoin/Leave/Search 与 Run-scoped
Worker grant 的映射仍是另一个未闭合同，不能用 Human API 结果替代。

对照：官方已实操非成员任务看板、Task Thread、Files 空态、加入和返回；非空官方文件、全部
普通 Human 权限组合及整个页面族像素/焦点矩阵未取得同条件双边验收。公开频道整项与 B016
保持未完成，不按测试数量计算百分比。
