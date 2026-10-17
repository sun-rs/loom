# CSV / XLSX / Diff 官方附件接线

Owner 本轮明确不需要音频与视频预览；保留普通附件下载，不继续播放器接线。PDF 保持待接入：官方 CrossOriginPdfFrame 要求独立来源，当前 gateway 仅有同源文件传输，不能删除官方检查、使用 blob URL 或在同源 iframe 中冒充完成。下一独立切片处理 PDF 传输与来源隔离；官方 PDF 评论仍禁用。

## 采用来源和所有者

来源仍为 [Raft a98ae003246a0360872a77d76dec2fccd0347ef7](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，owner 已授权非商用复用。

- `packages/server/src/services/attachmentPreviews/providers/{csv,xlsx,text,diffPatch}.ts` 解析逻辑直接采用；shared 类型原样采用。只改模块引用，三处补严格索引类型断言；单测反向移除这些调整后核对上游 SHA-256，证明未改解析逻辑。来源与采用后摘要在 `packages/application-service/vendor/raft/previews/provenance.json`，许可证沿用上层 LICENSE。
- XLSX 依赖与官方完全相同：SheetJS 0.20.3 官方 tarball，Apache-2.0，根 lockfile 锁定完整性。保留 ZIP 条目、展开大小、CRC 与重叠检查；不执行公式、宏或脚本。
- ApplicationService 唯一负责鉴权后读取原始附件，按官方 stream/payload cap 生成可重算预览；未建新的数据库、文件副本、任务或队列。新只读 `/v3/client/files/data-preview/:id` 复用 `downloadFile` 的成员/附件访问检查，拒绝 PUT，no-store。
- 前端采用官方分类器、DocumentPreviewStore、DocumentAttachmentPreviewModal、CsvPreviewPane、XlsxPreviewPane、AttachmentPreviewShell 和 AttachmentCommentsPanel；Loom 只接数据与既有 Kernel 评论写意图。
- Diff 卡片的 `DiffPatchStatsLine` 从官方 MessageItem 提取至本地组合（结构移植，非逐字节拷贝），样式、原生 raft-ui 组件及文案 key 保留；仅请求数据。卡片点击仍是下载，没有自编 Diff 编辑器。

## 行为与边界

CSV 上限 5 MiB，解析前缀 128 KiB，最多 200 行、12 列，返回数据上限 32 KiB；XLSX 上限 10 MiB，最多 20 个工作表、每表 200 行/20 列，保留官方 cell/payload 限制及截断提示。显示是有界预览，完整原文件仍可下载。空白、损坏或不支持的表格回退下载，不显示伪造成功。Diff 只显示文件数/hunk/增删行摘要，最多解析 256 KiB 前缀，维持官方行为，不声称全文件统计。

选中后发起的表格请求沿用跨消息取消所有者；先前慢请求不会覆盖新选择。评论继续使用官方 UI 与既有附件 Thread，Human 首次评论唤醒作者；作者显式关联附件回复才会进入评论列表，普通线程消息不混入。未新增角色 prompt 或调度规则。

## 验证

TDD 首先因缺少 structured preview 实现失败，再接入官方解析。定向测试覆盖 CSV 引号/二进制伪装/200 行截断、真实 XLSX 双工作表/无效 ZIP、Diff 统计、源码摘要以及 API 未认证/非成员/只读方法限制。浏览器在 1440×1000、390×844、DPR 1 下使用真实 Kernel/ApplicationService/Gateway、fake Worker 发布 CSV/XLSX：表格展示、工作表切换、评论唤醒作者、显式回复、刷新保留；Diff 显示 +1/-1 并下载。HTML 双尺寸回归保留。

不运行全仓套件，不调用真实或付费模型。正式页面采用只读 smoke，附件交互证据来自隔离夹具，不向用户频道写入测试数据。[证据](../evo/evidence/2026-10-17-table-preview/summary.json)。

后续状态：PDF 独立来源与原生阅读器已在 [PDF 接线批次](2026-10-17-pdf-preview.zh-CN.md)实现，评论仍禁用。
