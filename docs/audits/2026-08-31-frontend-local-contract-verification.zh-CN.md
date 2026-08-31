# 本地映射合同与消息键盘核验

## 结论

落实用户的架构边界：沿用 Raft 的可见交互合同，由 RAH 本地 daemon/AgentHost 完成请求，不要求 Raft 的中央服务器或官方 Computer 在线。[设计与首批源码映射](../product/raft-frontend-local-contract.zh-CN.md)是后续施工依据，尚不代表全站语义覆盖。

本轮确实修复了一个先前漏测的基础问题：Room/DM 与 Thread 输入框原来没有 Enter 提交处理。现在共享 `handleComposerKeyDown`，通过当前 form 的 enabled submit button 进入原提交函数；没有第二条消息 API 路径。Shift+Enter 保留原生换行，IME/229 确认不发送，重复 keydown 不重复提交，已有禁用状态不能绕过。

## 真实浏览器操作

隔离环境：multi-agent fixture，Web 4193，临时 daemon/数据库/目录，Fake CLI Alice/Kimi；1280×720、DPR2。未使用或修改用户正式 Room，未调用付费 CLI。以下是实际键盘操作，不是点击 Send 的替代测试。

| 操作                                                                          | 实际结果                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Room 填入 `Keyboard contract Room Enter only` 后仅按 Enter                    | 一条 Human canonical 消息与一条 Alice Fake CLI 回复；输入清空                      |
| Room 填入 `Line one` 后 Shift+Enter                                           | textarea 值为 `Line one\n`，没有对应已发消息                                       |
| 切 Alice DM，填入 `Keyboard contract DM Enter only` 后 Enter                  | 一条 Human 消息与一条 Alice Fake CLI 回复；输入清空                                |
| 从 DM Human 行打开消息列，填入 `Keyboard contract Thread Enter only` 后 Enter | 侧栏出现一条 Human 回复，根消息预览变为1条回复；Thread 输入清空；不污染主 composer |
| 关闭 Thread，返回 Room                                                        | 草稿仍为 `Line one\n`，没有因导航丢失或误发                                        |
| 清空 Room 输入，按 Enter                                                      | 空草稿保持，原测试消息未重复，无空白消息                                           |

截图已实际查看；本轮未保存截图文件。频道 fixture 自带 Markdown/大图/图表样本，本轮没有用该样本判定长消息渲染或图表正确性。键盘输入、消息写入和草稿的判定同时检查实际 DOM 与页面消息。

反例与重验：第一次使用自动化 `fill("")` 后立即 Enter，旧 `Line one` 草稿实际被发出，不能记为空输入通过。单独重复 `fill("")` 观察到 textarea 的 value/defaultValue 仍为旧草稿、Send 未禁用。改用真实 Meta+A、Backspace，确认 value/defaultValue 都为空且按钮 disabled，再 Enter；即时和后续读取均保持5条 article（含 fixture 原消息和前次误发），清空探针没有写入。这次结论来自真实删除和复核，不以工具返回成功认定清空。

原生中文输入法候选确认、权限拒绝/上传中的真实键盘路径、Firefox/PWA、官方发消息均**未在本轮实测**。IME、repeat、disabled、已消费事件以及两处组件接线有单元测试，不能把单元测试写成原生 IME 实测。

## 源码研究与审计纠正

- 从已登录官方页面 DOM 取得当前入口，并归档23个发布 JS。没有保存登录态、令牌或私有 API 响应，没有修改官方数据。
- AST 候选索引包含1,836个位置；全部初始 `untraced`，其中有库代码。13个引用 JS 尚未归档，无法据此计算业务完成率。
- 手工追踪了当前 Agent 工作区树的请求/路径、展开、读取、刷新、隐藏、拖宽、复制与 RefText 的解析/导航；记录本地差异，没有把追踪到的行为冒充移植完成。
- 撤回旧报告“Raft 动态目标完全不是从文本解析”的推论。正确事实是候选解析后经目录/context resolver 导航；本地仍不能把任意诊断文字当业务状态或访问授权。
- 删除的是本轮刚生成的旧版初步候选 JSON；保留当前有哈希/缺失项的新索引，以及历史源码和审计，没有删除用户业务数据。

## 门禁与交付边界

先有失败测试再实现：共享键盘模块缺失、AST chunk过滤/CLI重复输出分别有失败复现。

- 最终 `npm run check`：TypeScript通过；packages671项（669通过、2跳过、0失败）；Web69/69通过。
- `npm run build:web`：通过；保留已有大 chunk 警告，主组件 chunk约1.08MB（gzip约315KB），不据此宣称性能或长聊天验收完成。
- `npm run format:check`、`git diff --check`：通过。
- 23个原始发布文件逐一校验 SHA-256，与候选索引一致。

当时没有重启正式进程、不启动官方 Computer、不提交或推送。但“页面键盘修改只是待部署代码”的判断已被后续独立审计纠正：运行服务直接读取仓库 `apps/web/dist`，本轮普通 `npm run build:web` 已覆盖该目录，且缺少可信代理构建flag；正式4173新页随后实际显示Human token表单。**没有重启不代表没有影响正式资产。** 原测试结果仍是隔离环境结果，不能当成正式交付通过。完整证据与修复方向见[第三方主审结论 P1-R0](./2026-08-31-third-party-parity-final-review.zh-CN.md#p1-r0普通验证构建覆盖正式资产影响新开页面交付阻断)。
