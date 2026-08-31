# 全局 Tasks / Search / Human Activity：第二批验收

日期：2026-08-30。范围是缺口方案 B，不是全产品或全部 Raft 功能收口声明。

本批已经从“Room 局部入口 / 不可用入口”变为可读写、可刷新、可定位的全局产品链。实现和隔离浏览器验收完成；最终全仓门禁见文末。没有更新用户正在使用的 4173 正式实例，没有调用付费模型，没有修改 CLI、memory 或 Agent 生命周期。

## 1. 复用裁决：复制了什么，适配了什么

| 部分              | 证据与落地方式                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局 Tasks 范围   | Raft 发布包 `index-WTraJnrd.js` 的 channel/private 过滤及官方页面“个频道任务”：RAH 只聚合当前 Workspace 中有权限的 channel Tasks，DM Task 留在 DM 内。                            |
| Tasks 状态/筛选   | 复用五组状态、Done/Closed 默认折叠、频道/创建者/负责人多选与 taskNumber 倒序；RAH 的 waiting/blocked 映射到进行中。                                                               |
| Activity 身份     | 移植 Raft `Sa` 的 conversation/thread 身份规则。一张卡代表频道、私聊或消息列，而不是一条事件/一次 CLI Run。                                                                       |
| Activity 处理水位 | 移植 `markDone(throughActivitySeq)`：只处理用户见到的水位；done 与 read 分离，done 不能完成 Task，新回复重新出现。                                                                |
| CSS/图标          | 14 个 reference allowlist 资源逐字节校验；新增两个 SVG 图标路径直接取自官方 bundle。全局 Tasks 的 320px 列、12px padding、小状态标签与浅外框由官方 live DOM/computed style 校准。 |
| 必要本地适配      | SQL/ACL/keyset cursor、Human 私有 read-state、React/SDK/HTTP 适配为 RAH 实现。已取得的 Computer activity 切片是 tree-shaken 空壳，不能声称复制了不可见的 Raft 服务端。            |

官方 bundle SHA-256：`fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。图标来源：`fFe` / `lUe`。来源、设计和施工前复审见[设计文档](../product/global-discovery-design.zh-CN.md)。没有移入旧 RAH 的 Session 中心架构。

## 2. 浏览器操作结果

官方已登录 Chrome 页面与隔离 RAH 页面均使用 1440×1000。官方侧读取页面、筛选入口、分组、展开和列表模式，不创建或修改线上任务。RAH 侧使用真实浏览器发起 canonical 请求；Alice 是确定性 fake Worker，验证的是这一批产品/查询链，不能冒充新的真实模型验收。

| 实验                    | 实际结果                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两个频道各创建一个 Task | Agent Council / Discovery Lab 在全局看板合计 2 项；fake Worker 将 Alpha 提交到待确认，Beta 保留待办。                                                                                               |
| 私聊 Task 排除          | 从 Search 的 Alice 目录结果打开 canonical DM，创建第三个 Task；全局仍为 2 个频道任务。                                                                                                              |
| 筛选与持久 URL          | 频道选 Discovery Lab、负责人选未分配均只剩 Beta；清除恢复两项。频道筛选刷新后保留。列表/看板和折叠可切换。                                                                                          |
| 跨频道打开任务          | 点 Beta 进入其原 Room / Task / Thread，不使用当前 Room 的同号 `#1` 冒名定位。                                                                                                                       |
| 老消息搜索              | 110 条历史中搜索 `History fixture 001`，打开初始最近窗口之外的精确消息。实际目标 top=148.5px；刷新仍定位同一 messageId；返回最新后能看到最新 Task。                                                 |
| Search 分页             | `History fixture` 结果 110 条，逐次页面为 50（110–061）、50（060–011）、10（010–001）；换关键词回到第一页。                                                                                         |
| 消息列/私聊搜索         | `Thread discovery needle` + 消息列范围得到真实回复并打开正确根消息；目标回复 top=171px。`Discovery Private` + 私信范围只得到 DM 消息。                                                              |
| 动态与 Task 独立        | 处理 Beta 消息列动态后从 6 卡变 5 卡；回原 Room，Task 仍 todo。追加新回复后重新出现，恢复 6 卡。                                                                                                    |
| 已读与关注              | 全部已读后未读筛选为空；线程内关注请求成功。普通对话按实际进入视口的 canonical message sequence 确认已读，不使用传输 replay/head 作为已读。                                                         |
| 定位后继续对话          | 从 Activity 定位 DM Task #2，提交回复后消息列由旧快照切回实时记录，显示全部 4 条回复；返回动态未读为 0。另从 `History fixture 001` 定位后直接在频道发言，新 Human 消息及 fake Worker 回复立即显示。 |
| 390×844                 | Tasks 横向看板/列表、Search 输入/过滤/分页、Activity 滚动及底导航可用；Activity 文档宽度恰为 390。筛选避让、方向键和 Esc 实测。仅代表 Chromium 窄屏，不代表原生 iOS 或 Firefox 本轮验收。           |

截图在 [evidence/2026-08-30-global-discovery](./evidence/2026-08-30-global-discovery/)。重要配对：`raft-tasks-desktop.png` / `rah-tasks-desktop.png`、`raft-activity-desktop.png` / `rah-activity-desktop.png`、`raft-search-desktop.png` / `rah-search-desktop.png`；另含精确消息/线程定位与三页 mobile 截图。

这些截图的数据不同，不能用来宣称整页像素误差为零；本轮比对的是框架、布局规格、状态及操作结果。最后的 Unicode casefold 与长消息列 SQL 优化另经 Kernel 和 HTTP 全仓回归验证；浏览器验收服务启动在这两项优化之前，未据此声称所有最终 SQL 字节都做过浏览器重启复验。

本轮自建测试标签已关闭，浏览器视口覆盖已恢复，4189 测试进程已退出。复验可在仓库运行下列隔离 fixture；它不会复用正式数据库，也不代表真实付费 CLI：

```bash
RAH_WEB_PORT=4189 RAH_FIXTURE_HISTORY_MESSAGES=110 npm run dev:web:multi-agent-fixture
```

## 3. 反例审计与修正

- 每页重新校验 membership、Workspace 和归档状态；退群后拿旧游标不能继续读被撤销 Room，精确 message context 同样拒绝。Actor/查询条件改变会使游标失效。
- Search 按字面量处理 `%_`，HTML 保持文本；非 ASCII 大小写由统一 casefold 处理。非法日期 URL 不导致白屏；长消息摘要围绕命中词，而非永远截取开头。
- 取消关注覆盖自动关注；已经读过的旧提及不会复活消息列。新的精确 @Human 提及可以提醒，但不能借此突破 Room ACL。
- Activity 已读/处理水位使用单调最大值。处理请求与新回复并发时，新回复不会被误吞；重开数据库后 read/done 仍在。操作不发业务事件，不唤醒 Agent。
- 修复错误复用聊天室看板列样式、缺失的刷新/@图标、Search 输入双边框、窄屏菜单越界、旧消息定位被自动滚到底部覆盖、Thread 每次重绘重新居中。
- 浏览器补测发现定位上下文会遮住提交成功后的新回复：现仅在 canonical 提交成功后退出该次定位快照；失败保留原上下文，迟到完成不清掉另一个新选中的 messageId。频道与消息列两条发送路径都已实测；DM 消息列标题使用 `@` 而非 `#`。
- 截图还暴露出“DOM 已有新消息、实际仍在输入框下方”的反例：图片/图表及虚拟行后测量改变高度，普通 scroll 回调误取消贴底。现由虚拟列表按消息身份定位，并用 ResizeObserver 维持用户选择的贴底状态；向上阅读手势释放跟随。修复后末条 Agent 回复位于 y=808–862，消息视口下沿 y=878，底部差值 0；PageUp 后离底 924px，轮询没有拉回。没有以 DOM 节点存在冒充可见。
- `RoomKernel` 保持 6,925 行 ratchet：把原有 legacy Task migration 原样抽到独立 schema owner，没有调高上限。

性能回归采用临时真实 SQLite/canonical 消息，不是 mock 数组：

| 场景                                | 修复前     | 修复后本机单次测量 |
| ----------------------------------- | ---------- | ------------------ |
| 2,000 条顶层消息，Activity + Search | 约 2,612ms | 约 18–21ms         |
| 取消关注的 1,200 条回复，Activity   | 约 1,288ms | 约 5ms             |

前者修掉了每条消息重复扫描整个 Room event 表的问题；后者改成每个 thread 只计算一次资格。查询复用现有 canonical Message/event，辅助索引不成为第二份消息真相。上述数字不是大规模吞吐 SLA，也不是百万历史验收。

## 4. API 与 owner

Kernel schema v20 新增 `human_activity_frontiers`、`human_thread_follows` 和只读 `discovery_messages` view / 辅助索引。旧 task schema SQL 原样抽离。Human 私有阅读状态不是 Task mutation，没有 session / provider log 解析路径。

| SDK operation                         | Human HTTP（POST）                               |
| ------------------------------------- | ------------------------------------------------ |
| `task.global.list`                    | `/v3/client/tasks/global`                        |
| `search`                              | `/v3/client/search`                              |
| `message.context`                     | `/v3/client/messages/context`                    |
| `activity.list` / `.mark` / `.follow` | `/v3/client/activity/list` / `/mark` / `/follow` |

通过 HumanApplicationPort 白名单暴露，HTTP/SDK 只做验证与转接。Agent 凭据不能访问这些 Human 查询。Search 默认每页 50、最大 100；精确上下文最多 41 条。游标冻结新增边界，不代表业务对象状态的历史快照；分页时当前权限与状态依然优先。

## 5. 明确剩余边界

1. Raft 服务端全文排序不可见；本地是字面量 exact/prefix/substring 排序，不是 Raft 的相关性算法或语义检索。附件正文不搜索。
2. Search 的范围/日期/排序部分使用原生控件，任务状态调整进入既有 Room 操作链；没有复制所有原版弹层、全局拖拽和行内状态菜单。时间展示仍有差别。不能宣布所有 UI/交互 1:1。
3. 分页时看板分组计数是本页数，标题给总量并明确“本页”；目录候选有 100 项上限。超大目录、百万消息以及完整跨浏览器矩阵未验收。
4. 本批 Search/Tasks/Activity 的 Room/message/thread 深链可用，不表示 general Notifications、Human InputRequest、Artifact/Files 的所有深链已经统一。
5. Thread 关注按钮目前是显式操作入口；初次打开不承诺展示所有自动关注来源。@mention 只在已授权 Room 内生效，这是明确保留的本机权限边界。
6. 没有部署到 4173，也没有签名打包发布；没有据此认证真实 Agent CLI 或全产品收口。

## 6. 最终门禁

最终代码版本（包括定位后继续回复、动态行贴底与用户翻页修正）：

| 门禁                   | 结果                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `npm run check`        | 通过。TypeScript 通过；package 测试 653 项，651 通过、2 跳过、0 失败；Web 单元测试 30/30。 |
| `npm run format:check` | 通过。                                                                                     |
| `npm run build:web`    | 通过；仍有既存大 chunk（>500kB）告警，不声称加载性能已全部收口。                           |
| `npm audit --omit=dev` | 0 vulnerabilities。                                                                        |
| `git diff --check`     | 通过。                                                                                     |
| Kernel 大文件约束      | `room-kernel.ts` 为 6,895 行，未突破 6,925 行上限。                                        |
| 人工真实浏览器         | 上述 1440×1000 双边与 390×844 本地操作、截图及可见区域测量。                               |

两个跳过项是 opt-in 单 CLI / 多 CLI 的付费真实模型 gate。本批没有以 fake Worker 冒充它们通过。完整测试日志为本机 `/tmp/rah-global-closure-check.log`，构建、格式、依赖日志分别为 `/tmp/rah-global-closure-build.log`、`/tmp/rah-global-closure-format.log`、`/tmp/rah-global-final-audit.log`；持久验收依据是本报告、源码测试与 evidence 截图。

结论：**本批核心范围/查询/动态闭环已落地并有运行证据；第 5 节列出的完整 Raft 交互与正式发布边界仍未收口。** 没有提交或推送，也未改动用户原有在途变更的归属。
