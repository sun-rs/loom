# 官网双边取证、Search 小批修复与图标来源（2026-09-08）

本批使用真实官网浏览器结果与公开资源定位差异，修复 Search 的筛选清除和零结果文案，并纠正语义错误／缺失的共享图标。没有把整页截图相似度或历史 callback 数量当作功能验收。

## 当前来源

当日 Firefox 的公开 HTML 显示 Raft `release/v1.12.0`，commit `f1a9a6b83add3db8f44320c753d2f8d8b03b8f06`，构建时间 `2026-09-04T11:56:32Z`。已通过浏览器“查看源码／另存链接”保存 HTML、主脚本、样式和 Agent 页面脚本；URL、原始字节与 SHA-256 见[当前官网 manifest](../evidence/raft-web-20260908-current/manifest.json)。没有导出浏览器账户凭据，也没有把原始 bundle 作为生产依赖。

图标采用分别记录真实来源版本：[几何、字节位置、来源哈希及本地 wrapper](../evidence/raft-icon-semantics-20260908.json)。folder-closed、menu、share-2、link、play 使用已冻结来源，globe 使用当日新版来源；不能统一重新贴成“今天官网原始代码”。

## Search 行为与修复

当日官网 `index-BVfbaScj.js` 的 Search 组件：`Kn=V7({senderId,channelId,timeRange,scopes})` 控制清除筛选按钮，query 本身不算筛选；`$a` 清除筛选但保留查询及排序。`search.clearAll` 渲染位置约 UTF-8 offset 3498091；零结果分支约 3501927，按非空 trim query 选择带查询词文案。原始源码哈希见上述 manifest，定位字符串比格式化后的行数可靠。

- 无实际筛选时不显示“清除筛选”。设置时间等筛选后显示；清除后保留查询词和用户选择的排序。
- 零结果区带上查询词及官方提示；仅按筛选查找时使用“没有匹配的消息／试试其他筛选组合”。
- 继续使用现有 `useFilters`、查询 owner 和共享 EmptyState，没有新增浏览器业务状态或搜索后端。

官网与原正式本地 Search 使用同一零结果查询 `qzxvnb873619efc204a`，1440×900、DPR 2、缩放 1。官网为原生 Firefox 155，本地为隔离 Playwright Firefox 150.0.2，浏览器版本差异明确保留。初始图片同时暴露了额外清除按钮和空态文案差异；不能把不同数据量的 Computer／Agent 全页图片称为同条件通过。

另有可见差异仍保留：本地结果计数标为“条消息结果”，官网为“条结果”且包含已展示实体；左右栏用户数据、帮助入口及其它页面族仍需各自行为对照。本批没有据此宣布整个 Search／全产品完整复刻。

## 可重复证据

证据根：`/Users/sun/Code/reviews/rah_os/2026-09-08-parallel-closure/`。

- `search-empty-red.log`：查询本身导致错误清除按钮的真实浏览器 RED；`search-empty-green.log`：首次修复四组合通过。
- `search-sort-red.log`：独立 review 发现清除筛选误清排序，真实浏览器 RED；`search-sort-green.log`：修复后 Chrome／Firefox × 1440×900／390×844 全通过，验证实际搜索、时间筛选、清除、查询与排序保留、刷新、无横向溢出。已人工查看实际桌面及移动截图。
- `root-search-regression.log`：已有搜索参数／响应式合同及比较工具测试通过。`root-web-unit.log`：本轮 Web 单元测试通过；后续代码变化的最终全仓检查由总集成另记。
- `icons-red-confirmed.log`、`icons-green.log`、`play-red.log`、`play-green.log`：图标路由及真实符号存在的 RED/GREEN。早期 `icons-red.log` 是测试准备失败，不能当行为反例。

新脚本 `render-ui-bilateral-captures.mjs` 接收真实 PNG 和显式条件 manifest，校验文件哈希与视口／DPR尺寸，输出并排及差异图。`notes` 为字符串数组。不同视口尺寸不生成伪差异图；未知缩放条件保留未知；没有像素门禁，默认始终等待人眼 review。它不登录官网、复制凭据或改写官网数据。

原始截图与输出在 `bilateral/`；`manifest.json` 保留各截图来源、时刻、浏览器、构建及条件，`comparison/report.json` 保留不一致条件。正式候选构建、服务重启和新正式页面的证据由总集成报告给出，本文件中的隔离浏览器成功不替代部署验收。

## 最终集成补记

正式服务已切换最终构建，修后 Search 的同条件并排图已人工查看；具体 build、备份与六个正式浏览器结果见 [总集成审计](./2026-09-08-parallel-closure-integration.zh-CN.md)。图标来源登记的 offset 已统一校正为 UTF-8 字节位置并标 `offsetUnit`，没有变更源文件哈希；测试直接从该位置提取官方 array，比对几何与 wrapper。旧 sprite 原哈希保留，独立验证同一行注入未知 symbol、修改 viewBox、同时修改 manifest 与本地图形而不改上游均会失败。
