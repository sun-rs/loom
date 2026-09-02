# Search 多词相关度与空关键词筛选合同

状态：`C/A/L/D` 完成（P6.5；`R` 仅覆盖可观察前端合同）  
日期：2026-09-02

## 目标与单一所有者

本批只收口 Raft 已经可以从官网前端和登录后页面证明的 Search 行为：

1. 没有关键词、但存在发送者／范围／频道／时间筛选时，仍执行消息查询；
2. 空关键词筛选固定按最新排序，相关度控件禁用；
3. 多词查询按空白切词、逐词匹配和逐词高亮；
4. 同时命中更多查询词的消息优先于只命中部分词的消息；
5. 分页、ACL、Room/Thread deep link 和冻结查询边界保持不变。

所有权链保持单一：`protocol request -> Kernel GlobalDiscovery.search -> client SDK -> Web Search projection`。浏览器不聚合 Room 历史、不计算权限，也不持久化消息全文。

## Raft 证据与复用边界

固定证据包：

- `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`
- SHA-256：`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`

可直接复刻的前端合同：

- `X8`：发送者、频道、时间或范围任一激活即视为筛选查询；
- `dlt`：空关键词强制 `recent`；
- `Ga/xn`：`query.trim()` 为空但筛选激活时仍请求 `/messages/search` 并显示结果页；无关键词且无筛选才显示 Search home；
- `Clt`：`query.trim().split(/\s+/)` 后逐词、不区分大小写高亮；
- 结果请求采用延迟与取消旧请求，空结果显示“没有匹配的消息／尝试其他筛选”。

登录后官网双边实操证据：

- 空关键词 + “今天”返回 14 条消息，排序“相关度”禁用；
- 查询“任务 认领”返回 7 条消息，DOM `<mark>` 同时出现“任务”和“认领”；
- 同时命中两词的消息先于只显示单词命中的消息，证明不是整句字面量限定。

Raft 服务端相关度公式没有随网页包公开。本地实现不得宣称复制其内部 ranker；只复制可观察合同。RAH Kernel 使用本地 SQLite、逐词字面量匹配与确定性整数 rank：完整正文、完整前缀、完整短语、全部词、部分词，组内再按 canonical `message_order` 倒序。这样既保持游标稳定，也不把模型或浏览器变成搜索所有者。

Multica 本批无更完整的、可证明优于 Raft 的 Search 产品合同，不引入。

## 安全与回滚

- 查询始终先受 Workspace、Room membership、归档状态和非 control Room 约束；
- 每一页重新应用 ACL；
- 查询 token 数有上限，避免构造无界 SQL；
- 新 rank 版本进入游标 binding，旧算法游标失败关闭，不跨算法续页；
- 无 schema migration、无写路径、无外部副作用；回滚仅需恢复 Search query/rank 与 Web projection。

## 验收

- Kernel：多词 OR、全词优先、recent 顺序、分页无重复、旧游标失效、空关键词筛选；
- Web：筛选可激活空查询、空无筛选仍为 home、逐词高亮、摘要定位最早命中；
- 浏览器：桌面与 390x844 验证空筛选、多词顺序、逐词 `<mark>`、排序禁用、分页、Escape/focus、无控制台错误；
- 完整静态、单元、构建、Firefox gate、离线备份、正式 4173 单实例重启和正式页面只读复验。

## 施工与发布记录（2026-09-02）

- failure-first：Web 旧实现把多词当作一个完整短语，摘要与 `<mark>` 均无法逐词命中；Kernel 查询“任务 认领”返回 `0` 而非夹具中的 `3`；空关键词筛选没有统一的 activation owner。以上反例先由定向测试固定，再做最小修改。
- single owner：`searchShouldRun` 只拥有前端查询激活判定；`GlobalDiscovery.search` 只拥有 ACL 后的 token OR、确定性 rank 与冻结游标；`highlightParts/searchExcerpt` 只拥有可见摘要和逐词标记，不参与检索真相。
- 自动化：Web 定向 `12/12`、Kernel Global Discovery `19/19`；全量 packages `799` 项中 `797` 通过、`2` 个真实付费 Provider 用例按规则跳过，Web `205/205`、回调 parity `34/34`。typecheck、格式、diff、产品构建与 `npm audit --omit=dev` 均通过，依赖漏洞 `0`。
- 隔离浏览器：Firefox 150.0.2 在 `1440×1000` 与 `390×844` 均通过。空关键词 + 今天进入结果页且相关度禁用；清除筛选回到 Search home；“任务 认领”返回 `3` 条且首条同时命中并逐词标记；移动端无横向溢出，浏览器 error/warn 为 `0`。
- 正式部署：active-work 审计为零；保留一条既有 `submitted` 业务 Task，没有误清理用户状态。两个 SQLite 数据库均 `quick_check=ok` 且外键检查为空；一致性离线备份位于 `/Users/sun/.rah/backups/pre-p65-search-offline-20260902Cj6HDN`。4173 已由项目正式启动命令单实例运行，健康状态为 `online`。
- 正式浏览器：空关键词 + 今天实际返回 `16` 条消息，相关度禁用；“报数 机制”实际返回 `4` 条，首条同时包含并逐词标记两词；页面 `clientWidth=scrollWidth=1280`，console error/warn 为 `0`。
- 证据结论：`C/A/L/D` 完成。`R` 证明筛选激活、空查询排序、逐词标记及可见结果顺序；Raft Server 的内部 ranker 未公开，RAH 不宣称复制其不可见算法。
