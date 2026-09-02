# P6.4 Thread 关闭与焦点归还 Raft-first 合同

状态：`C/A/L/D` 完成；`R` 仅覆盖可证明的 Raft Escape 分层

日期：2026-09-02

## 1. Raft 可证明合同

冻结上游为 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：

- byte offset `3320945..3325000`：`_v` 以 Thread 容器 ref 跟踪 pointer/focus 是否进入消息列；非图片预览状态下，
  window Escape 仅在事件未被消费、目标属于 Thread、且目标不是 input/textarea/contenteditable 时调用 canonical
  `closeThread`。
- byte offset `3336500..3342000`：搜索输入框 Escape 只关闭搜索；“在频道中查看”按钮的 Escape 显式消费后关闭
  Thread；header `thread-close` 调用同一 close owner。
- byte offset `3437000..3441000`：side/modal/mobile presentation 都读取同一个 Thread store；side 宽度与 resizer 不拥有
  close 状态。

Raft 发布 bundle 没有证明 side Thread 关闭后把焦点恢复到哪个 opener。RAH OS 因此只把“事件分层和关闭条件”列为
structural port；焦点归还是本地可访问性增益，不能冒充上游事实。

## 2. 本地唯一 owner

新增一个小型 `useThreadFocusReturn` owner：打开 Thread 时记录显式消息触发元素；Task 等入口没有显式元素时记录当前
activeElement。显式关闭后，下一次 layout 稳定时先尝试原元素；若它已卸载，则按 canonical root message id 查找仍在主聊天
中的消息 article；两者都不存在时不猜测别的页面元素。

`ThreadPane` 只负责 Raft Escape 分层；它不读取 App 路由、不查找主聊天消息。App 只负责打开/关闭和 focus-return 生命周期；
MessageArticle 只把自己的 article ref 作为 opener 交给上层。导航造成的隐式 Thread 消失不恢复旧焦点，避免跨 Room 抢焦点。

## 3. failure-first 与验收

1. 纯函数红测：已连接 opener 优先，断开的 opener 回退到已连接 root，两者无效时不聚焦。
2. Web 合同红测：所有消息入口把 article 作为 opener；Thread Escape 排除输入/可编辑目标并尊重
   `defaultPrevented`；浮层 Escape 必须先 `preventDefault`。
3. 隔离 Firefox desktop 与 `390x844`：消息按钮打开 → close/Escape → 焦点回原消息；搜索 Escape 只关搜索；菜单
   Escape 只关菜单；导航切换不把焦点拉回旧 Room。
4. 全量 check/build/format/audit/diff，active-work 审计、离线备份、精确重启 4173 后只读复核。

## 4. 施工与验收记录

- failure-first：纯函数与 Web 合同测试先暴露缺少统一 focus-return owner；真实 Firefox 又暴露菜单与 Thread
  同时注册 window Escape 时，监听顺序变化会让一次 Escape 穿透并关闭两层。实现后，浮层在自身层级消费
  `preventDefault + stopPropagation`，Thread 只处理未消费且来自自身、非输入控件的 Escape。
- single owner：`useThreadFocusReturn` 只记录显式 opener 与 canonical root message id；显式关闭优先回到仍连接的
  opener，卸载时回退到主聊天 root article。Room/路由切换造成的隐式关闭不恢复旧页面焦点。
- 自动化：Thread 定向测试 `12/12`；全量 package `798` 项中 `796` 通过、`2` 个真实付费 Provider 用例按规则
  跳过；Web `204/204`、真实回调 `34/34`。`npm run check`、`format:check`、生产 Workbench build、Firefox
  150.0.2 `1440x1000`/`390x844`、`npm audit --omit=dev` 与 `git diff --check` 均通过，依赖漏洞为 `0`。
- 发布审计：Activation、RunAttempt、RuntimeProcess、Agent 独占 lease、pending InputRequest、Placement、Computer
  operation、Room SOS、未决 cancellation 与 workspace lease 均为 `0`；保留一个已经 `submitted`、等待人类审核的
  durable Task，不把它改写成运行中工作。两个正式数据库 `quick_check`/外键检查通过。
- 离线备份：在确认 `4173` 无监听后创建
  `/Users/sun/.rah/backups/pre-p64-thread-focus-offline-20260902TlGdAqY`（1.5G）；两个备份数据库再次检查为
  `ok`。一次被旧启动 shell 竞态污染的副本没有作为证据，已移入废弃区后重新备份。
- 正式实例：冻结产品构建以单一 `node scripts/run-local-workbench.mjs` 恢复到 `127.0.0.1:4173`；health 为
  `online`，Host 以新 generation 接管。正式 Room 只读打开已有 Thread，没有发送、回应、收藏或修改 Task。
- 正式浏览器：桌面端关闭按钮与 Thread Escape 均把焦点归还
  `message_4b96b825-7397-4b51-a64e-95aaa439d2f4`；菜单 Escape 只关菜单并回到“消息列操作”，搜索 Escape
  只关搜索而保留 Thread。`390x844` 的 Thread rect 为 `x=0,width=390,right=390`，document/body
  `scrollWidth=390`。console error/warn、可见 alert、`NetworkError` 与 `JSON.parse` 均为 `0`。

因此本批 `C/A/L/D` 完成。Raft 发布物证明的是 Escape 所有权和共同 close owner；焦点回到 opener/root 是
RAH OS 的可访问性增益，不冒充 upstream `R` 事实。
