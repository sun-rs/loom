# 双轨复刻审查与托管 MCP 退役交付

2026-09-08，仅 rah_os 当前工作树。用户先要求两个 Agent 分别核对后端源码和官网/本地浏览器行为，随后明确移除 RAH 自有 MCP 功能模块。本批先保存差异证据，再完整退役该模块，没有同时重做 Task、Search 或附件。

## 审查结果

- [后端当前报告](/Users/sun/Code/reviews/rah_os/2026-09-08-two-track-parity/backend-review.zh-CN.md)与[75条去重映射](/Users/sun/Code/reviews/rah_os/2026-09-08-two-track-parity/backend-route-inventory.zh-CN.md)：根基已存在，仍有 Task amend/delete、Agent 本人频道静音、附件评论、Worker 搜索/跨Room寻址/公开资料字段及上传能力查询等具体差异。附件-only转换仍待官方补证；权限与删除副作用不从未公开Server实现猜测。既有历史读取、普通附件、任务分配/转换、AgentHost不重新列为缺失。
- [前端双边报告](/Users/sun/Code/reviews/rah_os/2026-09-08-two-track-parity/frontend/frontend-review.zh-CN.md)：同原生Firefox、1440×900、DPR2取证29张。确认全局Task卡片打开路径/详情形态、Search总计口径、Computer Runtime chip参数差异；非空工作区已能双方展开，旧官网离线阻塞解除。未完成全状态/移动/写操作的全面双边验收。
- [主审独立记录](/Users/sun/Code/reviews/rah_os/2026-09-08-two-track-parity/root-review-notes.zh-CN.md)：重新解析75个route key，无缺漏/重复，抽查源码与实际图片。证据支持部分Human/Worker入口覆盖不同、导航上下文与局部组件参数未齐；**不支持将全部差异归为一个统一协议bug或据此重写架构。**

浏览器审查曾误触本地个人收藏，随即移除恢复；原操作与恢复证据保留，不能称审查绝对零写入。没有发送模型消息或修改Task状态。MCP退役前的官网截图只是历史证据，不再产生待复刻要求。

## 已退役的完整边界

依据[用户产品决定](../product/managed-mcp-retirement.zh-CN.md)：

- 移除 Settings MCP、Agent MCP 页签、页面读取和专用样式/组件；旧Settings链接回账户，旧Agent链接保留同一Agent并回资料页。LAN复用样式保留并改为自身命名。
- 移除11条Human及2条Worker托管接口、SDK/CLI入口、daemon executor配置与runtime proxy注入、相应专用依赖；没有保留能成功调用的隐藏接口。
- 不读取旧 managed-mcp.json；版本化daemon配置中的旧字段只接受后丢弃，不解析秘密引用。旧Runtime manifest可解析以读取历史，但不再注入托管工具。
- 保留旧数据库表、历史Activity和迁移兼容，不清理用户CLI自有工具配置、Room Worker HTTP/CLI、任务、附件和记忆。旧pending托管记录不能永久阻塞Agent操作，真正active Run仍受执行围栏约束。

[后端作者记录](/Users/sun/Code/reviews/rah_os/2026-09-08-managed-mcp-retirement/backend-closure.zh-CN.md)、[前端作者记录](/Users/sun/Code/reviews/rah_os/2026-09-08-two-track-parity/frontend/mcp-retirement-closure.zh-CN.md)、[独立复核](/Users/sun/Code/reviews/rah_os/2026-09-08-managed-mcp-retirement/independent-frontend-review.zh-CN.md)。独立复核发现历史 `authorization_lost_after_execution` 类型遗漏，可令Activity读取失败；已通过历史记录反例修复，不恢复任何调用能力。

## 实际验收

证据根目录 `/Users/sun/Code/reviews/rah_os/2026-09-08-managed-mcp-retirement`。

- 后端29项退役/相关专项、49项关联回归，前端24项专项和完整Web回归通过；各作者保留RED/GREEN与界限。
- `integration-check.log`：npm run check exit 0，包测试1041通过、5个opt-in跳过，Web373、既有回归34、浏览器策略11、双边工具3通过。未运行付费CLI。
- `format-check-final.log`及git diff --check通过；`formal-build.log`构建成功。源码/测试/资产1193项冻结摘要验后无变化。
- `browser-green.log`：Chrome/Firefox × 1440/390，旧URL、同Agent身份、刷新、无托管请求及无溢出通过，主审查看图片。
- `chrome-business.log`、`firefox-workbench.log`：Chrome主业务与冻结Firefox持久工作台通过；原Agent身份/刷新/键盘测试改用仍保留的页签，未随MCP场景删除。
- `local-help-browser-final.log`：双浏览器桌面/移动恢复指南、反馈及Computer恢复入口通过。首跑因测试文件格式变化被源码冻结检查拒绝，已在最终冻结后重跑；未削弱保护。
- 首次新退役浏览器探测的移动URL缺Agent ID，是测试输入缺陷；修正为选择实际fixture Agent后构造旧链接。该失败不算产品TDD RED。

## 正式交付与数据核对

正式地址 `http://127.0.0.1:4173`；构建 `14b33a6a3bad8b42a75a8b1cae4816365c275f9a659f3ca01eb94b3db1c715b2`。
空闲检查与备份通过，原PID79469优雅退出，后继PID93651；备份
`/Users/sun/.rah/backups/pre-restart-1e45f0f1-1b0f-4174-95f4-38243b8e9d04`。
未强杀或以fixture替换正式实例。

`formal-browser.log`与JSON确认冻结build：Firefox真实新页面在1440/390检查Search、Agent资料、Computer、旧MCP设置回账户共8项，0拒绝请求、0页面错误，图片已查看。

**完整数据库摘要不是全部相等。** 正式启动给四个Runtime各追加一个移除managedMcpAdapter的版本，继而给四个策略和Agent追加对应引用修订，产生4个policy.revised与4个agent.revised事件。主审比较备份与现库：Runtime manifest唯一业务差异是删除该字段；策略仅Offer版本引用与修订元数据改变；Agent仅策略引用与修订元数据改变。

`formal-integrity.json`、`restart-revision-diff.json`、`restart-policy-diff.json`及独立校验脚本证明：既有历史事件/修订逐行保持，43条消息、2个Task、身份/成员、用户配置文件与37个私有记忆文件摘要不变；旧MCP记录保留。没有把必要版本迁移冒称所有表字节不变。

本批未提交或推送Git，HEAD仍为672c596；上述结果对应当前未提交工作树及正式冻结构建。MCP不再属于剩余缺口；其它源码差异与双边未验证项仍按审查报告逐条保留，不宣称完整Raft复刻。
