# Composer @ / # 候选匹配对齐

Owner：`apps/web/src/composer-suggestion-ranking.ts` 负责纯展示匹配排序；
`composer-mention.ts` 提供 Agent／频道字段映射和消息列最近参与者排序。
权限、成员资格、消息发送和历史提及绑定仍归既有协议／应用服务 owner。
搜索大页不在本次修改范围。

## 来源与采用方式

Raft `https://app.raft.build`，2026-09-16 留存发布包 `web-index.js`，
SHA256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
核对 `Ytt`、`Yce/FJe/zJe`、`UJe…KJe`、`f7/WJe/Qce`、`Jtt/t9/Xtt`。
该发布源码是行为分析证据，不作为生产依赖；本次为本地具名 TypeScript
结构移植，非逐字复制，不引入发布包压缩字典或声称获得其开放源码许可。

同时检查 Multica revision `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/extensions/pinyin-match.ts`：采用 pinyin-pro，但其
混合拼音前缀算法不同，未采用其匹配规则。生产新增 `pinyin-pro@3.29.4`
（MIT，Copyright 2022-present zh-lx；[上游](https://github.com/zh-lx/pinyin-pro)），
经 npm 锁定完整性和版本并保留包内许可证。逐字转拼音以接近 Raft 的单字查表；
未验证两份字典全部多音字读音相等，不能宣称字典逐字一致。

## 行为

- @：账户名 priority 0、显示名 1、描述 3、适用的来源标签 4。
  当前单机 WorkspaceAgentView 无来源服务器标签，不伪造该字段。
- #：频道名 priority 0、描述 3。已归档频道继续可引用，私聊不作为频道候选。
- 忽略大小写；字母数字分词与紧凑串用于完整／前缀／分词前缀／包含匹配。
- 再尝试全拼包含、首字母、受限子序列、原始文本包含；模糊匹配限定名称字段，
  拼音包含／首字母最少 2 字符、子序列最少 3 字符，跳过字符数最多 max(2,2×查询长度)。
- 排序按匹配档次、字段优先级、命中位置、间隙、原顺序；有查询截取 30 条，
  空查询保留所有候选，不再把 @ 截成 8 条。
- 消息列在匹配后优先最近发言者，重复身份只取最近一次；不增加新候选。
- RAH 继续只接收既有权限／成员候选输入，因而没有可唤醒的非成员分组。
  这是保留执行边界，不照搬 Raft 跨服务器／非成员入口。
- 同名或仅大小写不同的账号不会合并，保留原对象、participantId、handle。
  插入仍保留账户名大小写，最终发送继续使用既有身份绑定校验。

Raft 的大目录 Worker 是执行优化而非匹配规则。本次同步纯函数没有跨查询异步
返回，因此没有旧请求覆盖新结果问题；不复制 Worker 失败时降级为简单匹配的
退化行为。单次本地 2000 候选探针约 17ms 首次／4–5ms 热运行，只是本机诊断，
不等于低端设备性能保证；未改变任何业务队列或持久状态。

## 验证

先运行新字段／数量测试，旧实现失败；后补最近参与者测试，缺少函数时失败。
单测覆盖匹配字段、排序、全拼首字母、模糊间隙、大小写身份、归档频道、30条
上限与空查询；浏览器门 `test-composer-ranking-browser.mjs` 使用真实 composer
组件和隔离数据，覆盖桌面／390px、Chromium／Firefox、键盘／指针、滚动和重载。
接收人回归另运行 `test-thread-mention-recipients-browser.mjs`，防止过滤修改
重新导致所有频道成员被加入关注。当前线上 Raft 双边逐项验收未执行。

本批结果：8 项单测、双浏览器／双宽度候选匹配门、既有频道候选门、消息列／
任务审批接收人门及 typecheck 均通过；正式 bundle 构建通过。
全仓 check 仍在既有 `/v1/worker/message-present` 未登记处阻断，format:check
仍报告此前五个非本批文件；本批文件格式和 git diff --check 通过。
完成持久状态备份与正式实例安全重启，新正式浏览器页验证 @ 大小写保留、

# 目录、桌面／390px 与重载通过；没有发送消息或调用付费模型。
