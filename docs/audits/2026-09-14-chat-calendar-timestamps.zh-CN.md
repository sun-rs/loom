# 聊天日期标识与跨日更新

## 规则与来源

用户要求 Room/私聊正文的名字、模型之后，时钟之前显示日历日期：今天省略，昨天显示
“昨天”，更早显示 `MM/DD`。同一 `MessageArticle` 服务于 Room、DM 与 Thread，Human 与
Agent 使用相同日期规则；消息列回复预览也复用该格式。跨年按 Raft 保留 `YYYY/MM/DD`，
避免把不同年份的同月日混淆。原有12/24小时设置与浏览器本地时区继续生效。

采用 Raft 发布的 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
`v3e`（pretty 79585）/ `t_` / `dd.formatMessageTime`（118453）：
按日历日期判断、今天仅时钟、昨天前缀、同年短日期、跨年含年份。
这是结构移植，非字节复制；沿用现有来源声明，未新增上游资产或修改冻结快照。

对照 Multica 本地 revision `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/mobile/lib/time-ago.ts`，其按经过分钟/小时/天显示相对时长，不能满足本次日历日期规则，
因此未采用其代码。其 LICENSE 有 Apache-2.0 及附加条款；本次无 Multica 源码移植。

## 单一 owner 与生命周期

- `chat-timeline-presentation.ts` 复用日历日期拆分，提供正文日期前缀；
  `date-time-presentation.ts` 拼接原有时钟格式，不复制时间偏好逻辑。
- `chat-calendar-clock.ts` 是仅用于显示的共享日期时钟。所有已挂载的时间标识及日期分隔线
  共用一个定时器，不给每条消息创建轮询。定时器精确对准下一次本地午夜；
  最长60秒校准一次系统时钟，仅日期变化时通知订阅者。午夜由本地 Date 日历操作计算，
  不假设每个本地日都是24小时。
- 页面 focus、visibilitychange、pageshow 会立即校准，覆盖后台计时器节流、休眠与返回缓存页。
  最后一个订阅者卸载时释放计时器及监听。普通跨日不访问后端、不改消息时间戳、不重建消息。
- `ChatMessageTime` 与 `ChatDateDivider` 消费同一时钟；正文模型后方仍使用既有 `time`
  的灰色等宽12/16px规则。无新增 CSS，无新的消息或业务状态 owner。

## 验证

单元断言先确认缺失实现失败，再加入最小实现；覆盖今天/昨天/短日期、跨年、闰日、
夏令时25小时日、无效输入、12/24小时、午夜前1ms/午夜、共享订阅及解除订阅。

`test-chat-message-time-browser.mjs` 使用明确标注的隔离 fixture，渲染实际 MessageArticle
与日期分隔线，未调用真实CLI。Chrome/Firefox、1440×900及390×844均验证：

- 日期位于模型之后、时钟之前，Human与Agent一致。
- 午夜前仍省略日期，午夜立即变“昨天”；之前的昨天变为MM/DD，分隔线同步变化。
- 页面恢复、系统时钟回拨及刷新后重新计算日期。
- 消息DOM身份与输入草稿保留，没有横向溢出。

这是模拟时钟的真实浏览器验证，不是等待自然午夜的生产观测；也不声称复刻了未核实的
Raft动态计时器内部实现。正式页面验收与重启记录在本轮完成后补充。

另执行既有 `run-message-timeline-browser-gate.mjs`：10050条逻辑消息、27个挂载行，
滚动锚点偏移0px；桌面/手机与Markdown动态内容回归通过。此项是既有长历史门禁，
与前述共享消息组件的模拟午夜测试分开记录。

## 最终检查与正式页面

`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 通过。当前共享CSS摘要（工作区并行修改后的证据）与内部catalog已刷新；
本功能本身没有修改CSS。

空闲检查后，使用原有Tailnet/LAN/loopback启动模式，校验备份并正常停止正式实例，
以冻结构建 `cabcfb9a69f11636ef4884b24dad340ce57dea04a69b3421219a9faaad50e76f` 启动。
备份为 `/Users/sun/.rah/backups/pre-restart-91502b60-d6a3-4b83-81c7-aafec090bd31`。

新浏览器先验证真实Room/DM的近期消息，再通过既有深链接验证历史消息（Room `09/01`、
DM `08/30`），断言ISO datetime与共享格式结果一致、刷新后保持；本机/LAN/Tailnet
均核对新构建身份通过。正式验证只读，未发送消息、修改系统时间或启动付费Provider。
生产跨日能力的证据仍是前述可控时钟测试，不冒充在正式实例等待自然午夜的观测。
