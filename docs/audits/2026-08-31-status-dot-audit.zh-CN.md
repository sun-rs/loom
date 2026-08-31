# 状态点颜色、含义与发布复核

日期：2026-08-31。仅审计状态点，不把按钮、Task 标签的背景色算进来。

## 官方证据与裁决

本次重新打开已登录的官方成员 → 动态页面，核对 DOM/computed style；不是按截图取色。源码来自当前冻结的 `index-BoAC7nSE.js`（SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`）的 `Uze` / `fp` / `ip`，以及 `AgentDetailPanel-DKwoNvgK.js` 的 `Eo/_o/To/Mo/Po/Lo/gs`。当前页面加载 `index-C0_xNE3Z.css`。

| 颜色 / 官方令牌                  | 使用位置与意义                                              | 证据                                                 |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| 粉 `#FE7DA8`                     | 导航未读、系统待关注提示；不是运行状态                      | 源码 + 实页 10×10、1px 黑边                          |
| 灰 `oklch(70.7% .022 261.325)`   | Computer 离线；Agent offline/默认未知回退                   | 源码 + 实页离线 Agent                                |
| 绿 `#A9D877`                     | Agent online；动态空闲；上下文压缩完成                      | 源码 + 实页空闲行                                    |
| 黄 `#FFD440`                     | thinking/working；工具启动。状态/思考行呼吸，工具行不呼吸   | 源码 + 实页两种黄点                                  |
| 橙 `#F8A16F`                     | Agent error；动态 system；压缩开始                          | 源码分支；本次官方没有自然出现这些状态，不能计作实测 |
| 青 `#27CCF3`                     | 动态 text 输出；presence 中 external Agent 标识             | 输出实页；external 仅源码分支                        |
| 浅蓝 `oklch(80.9% .105 251.813)` | 动态 slock_action 结果，包括 claim、发送、freshness hold 等 | 源码 + 实页动作行                                    |

当前 `--color-soft-signal` 解析为 `#FFD440`，不是固定浅黄色。官方呼吸动画为 2 秒、`cubic-bezier(.4,0,.6,1)`、中点 opacity .5，因此截图可能看起来偏浅。`slock_action` 蓝色不代表操作必然成功：freshness hold 也走蓝色结果行。Task 的紫/绿/橙/青标签不是此处圆点；本范围没有发现独立红色或紫色状态点。

## 本地修正

`agent-activity-projection.ts` 成为动态点颜色/脉冲的唯一映射 owner；组件直接消费，不改变业务状态：

- text 原先错误地归为绿色 success，改为青色 output；
- slock_action 原先归灰色 neutral，改为浅蓝 action；system 改橙色；
- error 原先用删除危险色 coral，改官方橙色；
- compaction_finished 原先仍是橙色 warning，改绿色；
- offline 使用官方灰，不再用半透明文字灰；
- thinking/working 按官方参数呼吸，工具启动不呼吸；尊重 reduced-motion 是显式本地无障碍适配。

测试先复现 `text: success != output`，修正后 12 种 entry/status 映射及 pulse 判断通过。旧文本合并、Run/工具边界测试不降低断言。黄色基色本身原先就是正确的，未因截图浅黄而改色。

## 不可扩大结论

导航 pink、Computer 连通状态、Agent presence、历史动态诊断是四个不同投影。不能用历史最后一条 thinking 判断当前 Agent 仍在工作，也不能把错误诊断当作 Task 失败。

本地头像目前消费 Host 连通性与 Agent 启用/Runtime 可用性，只可靠实现在线/非在线绿灰；尚未接入 Raft 完整的当前 thinking/working/error/external presence 投影。本次没有伪造这些实时状态，**不能宣称头像全状态 1:1**。官方 Computer 仍离线，未人为启动、制造故障或执行收费模型来凑齐色卡。

本次颜色修正是对上一份[补强审计](./2026-08-31-parity-reinforcement-final-review.zh-CN.md)的追加，不代表其他未覆盖项已自动通过。提交后的活动检查、备份、重启与真实页面验证记录见下节；它只更新正式发布状态，不撤销此前其他未覆盖项。

## 提交前门禁

- `npm run check`：801 项，799 通过、2 项 opt-in 跳过、0 失败；包含类型检查、676 package、95 Web、30 实际回调回归。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。仍有大于 500 KB chunk 警告，未宣称性能收口。
- 官方 live 页实际观察粉、灰、绿、黄、青、浅蓝；橙及 external 分支依据源码，未制造真实故障。
- 正式库只读预检：1 个 completed Activation、1 个 exited Run、1 个 terminated RuntimeProcess，无 Task。此记录只授权受控停止，不是重启成功证明。
- 本次提交纳入连续开发的产品源码、测试、owner 文档和官方发布源码参考；本地原始聊天截图/运行证据不纳入。未推送。

## 提交后发布与真实浏览器核验

代码提交：`33d3c20`（积累的前后端补强与状态点修正）、`10e5fb0`（网关停止连接修复）。未推送远端。

重启前备份位于 `/Users/sun/Library/Application Support/RAH OS/backup-before-33d3c20-v9eWjF`。Room/Runtime Registry 使用 SQLite backup，数据库完整性检查均为 `ok`；配置、supervisor 和记忆文件另行保留。预检无活动 Task/Run，没有为了测试调用收费 CLI。

旧实例第一次收到 SIGTERM 后，被两个未完成的 HTTP 请求卡在 gateway stop，尚未进入 Core 停止。确认活动检查及备份后第二次 SIGTERM 结束旧进程，再验证原库完整性。没有与旧进程同时启动第二个同库 Core，也没有清空状态。本次因此增加了真实 HTTP 回归：先复现挂起请求阻塞 shutdown，再在网关停止时释放浏览器连接、销毁对应上游请求；连接关闭不代表已接受的业务变更被撤销。修复提交后才启动新正式实例。

正式服务使用持久状态目录 `/Users/sun/Library/Application Support/RAH OS/state`，入口为 `http://127.0.0.1:4173`；静态资产固定为 `.workbench-web/811fd78dcd383ac79c3ac801ea19e164ed7698774ed62d0db70bc4295ccbfbc5`。核验 GET 首页、`sw.js`、health 均返回 200，health 为 online，随后实际浏览器打开并刷新成功，不以 HEAD 或健康检查代替页面验收。

数据复核：3 个 Room、2 条消息、4 个 Agent、8 个 Agent 修订、8 条成员关系和 2 个 Workspace 保留。身份/配置/关系哈希一致；消息表迁移新增 `attachments_json` 字段导致整行哈希变化，但与备份逐个原有字段对比完全相同。5 个 supervisor/记忆文件哈希与备份相同，没有把新测试会话当作旧历史恢复证据。

最终代码门禁在网关修复后重跑：`npm run check` 共 **802 项，800 通过、2 项 opt-in 跳过、0 失败**（677 package、95 Web、30 实际回调回归），类型检查通过；format、diff 检查及 product build 通过。大于 500 KB chunk 警告仍存在。

正式浏览器核验（非隔离假数据页面）：

- 官方与本地桌面均确认 1440×900、DPR 1；官方动态实页颜色与本地持久历史动态的对应计算样式吻合。实际观察本地黄色工作状态呼吸、黄色工具启动不呼吸、青色输出和绿色空闲，圆点均为 8×8；橙色/浅蓝等未在本地现有历史自然出现的分支仅计源码和映射测试，不伪称实页覆盖。
- 首页无 token 输入要求，聊天侧栏显示全部 4 个 Agent 的私聊入口。Computer 默认打开 Mac-Studio，读取真实连接状态和四家 CLI 的版本/Runtime 信息。
- Codex 资料页打开 Runtime/模型/effort 编辑弹层；未改变配置时保存禁用，Escape 关闭。本轮未保存新模型或调用 CLI，因此不把打开编辑器当作模型切换执行验收。
- Codex 动态显示此前持久化的真实 Run 工具、文件修改及输出记录；点击动态对话目标回到原有 DM 的准确 Room 身份，恢复原有两条消息，不新建另一间 Room。
- 聊天头像悬停显示摘要；点击头像打开右侧 Agent 面板且默认动态；关闭面板后点击姓名向 composer 插入 `@Codex ` 并聚焦。测试前确认草稿为空，测试后只清除本次插入的文字，未发送消息。
- 刷新原 DM 后路由、消息及侧栏恢复。390×844 实页截图检查通过，文档宽度为 390、composer 保持可见，无横向溢出；核验后恢复正常浏览器视口。

结论：本轮修改已进入正式持久服务，而不再只存在于隔离测试页面。**不能据此宣称全站或头像所有实时状态与 Raft 1:1**；未覆盖项仍按上文及前次独立审计保留。
