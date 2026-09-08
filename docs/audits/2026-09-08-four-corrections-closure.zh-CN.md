# 四项纠偏：实施、分页验收与用量接线梳理

后续核实：[官网 HTML 有效跨段落选框与发布后回跳已实证](./2026-09-08-html-region-official-verification.zh-CN.md)，下文的官网待核实边界由该记录更新；本地精确行为差异尚未修复。

本批范围是用户确定的“移动折叠 → HTML 定位 → 本地分页验收 → 单独梳理运行器用量接线”。第四项完成的是来源与方案梳理，不能写作用量功能已经上线。

## 已完成的代码与本地验证

| 项目         | 结果                                                                                                  | 边界                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 移动评论折叠 | 标题栏保留、展开／收起、草稿保留、点击锚点后收起；390×844 Chrome／Firefox 实操                        | Raft 的点击折叠，不是自创拖动手势；真机软键盘和中间宽度尚未逐点验收。                                                |
| HTML 区域    | 点击／拖框选区、随评论持久化、点击评论按文字／坐标定位、高亮；专用桥接、opaque origin、来源与数值校验 | 官网实操只到引用生成；发布后回跳依赖冻结源码，本地通过不冒充该段官方双边实操通过。跨段落精确 quote 尚有差别。        |
| 本地分页     | 115 条评论分三页、每页最多 50，无重复／遗漏；旧页查看期间插入新评论保持旧页稳定，返回最新及刷新可恢复 | 是 RAH 有界读取验收。官网集合排序与本地按时间分页后页内位置排序仍有显式差异。                                        |
| 运行器用量   | [来源、单一 owner 与最小接线方案](../product/runtime-account-usage-wiring.zh-CN.md)完成               | Codex／Claude／Kimi 采集器、认证 API 与浮层尚未接入；OpenCode 无可靠对应来源。没有编造用量、重置资料或触发付费采集。 |

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-four-corrections/`。mobile-red 复现缺少折叠按钮；html-red 复现无区域选取；对应后续浏览器结果包含媒体回归、评论提交回执丢失后幂等重试、断网保留草稿、HTML 沙箱／伪造来源检查以及分页记录。

`final-browser/results.json` 为开发服务的 Chrome／Firefox 隔离真实浏览器结果，数据真实进入临时 Kernel，CLI 为明确 Fake，不是正式用户地址或真实 Provider 验收。截图包括折叠动画完成后的 40px 标题条，不能用过渡中的截图判断最终布局。

## 安全与来源

行为来源为[官网核实记录](./2026-09-08-raft-remaining-live-confirmation.zh-CN.md)中的 Raft `XR/Lw/TYe/vYe`；来源版本、bundle 哈希及官方实操边界沿用该记录。检查 Multica 的编辑器附件与用量汇总后，没有用它们的可编辑文档／费用统计体系替代当前需求。本地桥接是安全适配，不是上游代码原样搬运。具体所有权和刻意差异记录在[UI 集成边界](../architecture/raft-ui-product-integration.zh-CN.md)。

保留原有认证、附件权限、评论幂等和 Room mutation owner；没有更改 memory、Task 状态或 provider 调度。Task 删除前端、中央订阅、多 Human、远程计算机仍不加入本批。

## 发布验证

- `npm run check`、`npm run format:check`、`git diff --check` 通过；Web 正式构建 `npm run build:web:workbench` 通过。
- `production-browser/results.json`：冻结生产包＋正式 LocalWorkbenchGateway 安全策略下，Chrome、Firefox 的移动折叠、HTML 点击／拖选／定位、沙箱和 115 条分页场景通过，页面错误为空。不是只验证 Vite 开发环境。
- 冻结 build：`18fcd16f1b48bef28faa069b566677b63f7ddef8d39e2bebb9d3884f3a5c1041`。
- 正式实例在空闲、备份及重复状态检查通过后，由 PID 53002 优雅更换为 PID 68965；`http://127.0.0.1:4173/` 的 build 响应头与冻结包一致。
- 新建真实浏览器页面打开正式 Computer，显示已连接、四家 CLI 和四个 Agent，截图 `formal-computer.png`，页面错误为空；保留为用户可查看页。正式数据中没有新增测试评论或运行付费模型。
- 与备份逐行比较：43 条消息、6 个 Room、16 条 Membership、4 个 Agent 定义、48 条 Agent 修订一致；5 个 MEMORY.md／notes 文件字节一致。回执见 `formal-state.json`；备份为 `/Users/sun/.rah/backups/pre-restart-db944bef-68da-4710-bff4-886bb5f5e4c3`。
- 本批没有 Git 提交、推送或付费 CLI 测试。已存在的工作树修改保留，未触碰旧 rah 项目。

剩余不能合并为“全部复刻完成”：HTML 跨段落 quote 的精确一致性、官网发布后回跳的双边实操、真机软键盘，以及运行器用量实际采集和展示接线。第四项是已明确边界的后续施工方案，不是隐藏的成功占位。
