# Files / Artifact 预览对齐审计

日期：2026-09-03

## 结论

RAH OS 已关闭本地产品范围内的 Room Files 与消息附件预览主链：一个已发布附件继续由
Message/Room/Task evidence 持有同一身份，Files 只是聚合投影；桌面行内直接提供原消息定位与下载，
窄屏复用可键盘操作的溢出菜单；图片、Markdown、HTML、diff/patch、CSV/TSV 与白名单文本进入同一个
有界预览框架。预览没有建立第二份 blob、ACL 或文件元数据。

本批没有把“存在下载能力”包装成所有媒体都能安全内嵌。PDF、音频、视频仍可下载和 Range 续传，
但在 Authorization-header 保护的本地 URL 尚无单文件短期 capability 前，不直接交给
`iframe/audio/video`。Finder reveal 也不适用于内容寻址且不保留原路径的 Room Artifact。

## 固定来源与复用裁决

| 来源               | 固定版本                                                                                                                                        | 采用                                                                                                                      | 未采用                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Raft 授权 Web 快照 | repo `286c3c5d99b56d8be5e3339510de310b4b7fe727`；`index-BoAC7nSE.js` SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` | Channel Files 聚合、50 条分页、桌面直接跳转/下载、消息附件多 renderer、同一 Attachment/原消息身份                         | 中央对象存储、签名 URL 与未知 Server 实现                     |
| Multica            | `11861145abc59a0d39c8c8f24ad837d4584e664f`                                                                                                      | `file.go` 的 2 MiB 文本上限与响应安全头；`preview.ts` 的类型分派；`attachment-preview-modal.tsx` 的单框架；有界 UI 思路   | Go/PostgreSQL/云代理实现文本、其前后端重复白名单              |
| RAH OS 本地适配    | 本批工作树                                                                                                                                      | protocol 单一分类 owner；现有 Kernel Room ACL/O_NOFOLLOW fd；Application Service 纯文本预览端点；SDK；React 安全 renderer | 浏览器路径、Provider 日志、当前 Git working tree 作为附件真相 |

## 实现与安全审计

```text
protocol classifyAttachmentPreview（前后端唯一分类/白名单）
  -> Kernel RoomFiles.download（既有 membership、immutable metadata、fd owner）
  -> Application Service /v3/client/files/preview/:attachmentId
       <= 2 MiB, text/plain, nosniff, no-store, restrictive CSP
  -> Client SDK previewText
  -> Web FilePreview
       image Blob URL | sanitized Markdown | opaque HTML sandbox
       bounded diff | bounded CSV | bounded raw text
```

- 未认证预览是 `401`；已认证但不属于 Room 的 Human 是 `403`，且在授权成功前不泄漏文件大小。
- HTML 与 SVG 从不以 app-origin 可执行 MIME 返回。HTML 经纯文本取回，进入没有
  `allow-scripts/allow-same-origin` 的 sandbox，并注入禁止网络、脚本、对象和表单的 CSP。
- 文本响应最多 2 MiB；前端最多物化 300,000 字符、5,000 行 diff、200 行 × 50 列 CSV。
- 未知二进制、超限文本和当前未支持的媒体显式提示下载，不停留在无限 loading，也不显示空白成功。
- 原消息跳转继续使用冻结的 `messageId + roomSeq`；文件名、DOM 顺序和当前列表位置都不是定位依据。
- 下载仍保持 `attachment + application/octet-stream + nosniff + no-store`，Range 的
  `200/206/416` 合同没有被预览端点改变。

## TDD 与自动验证

失败优先阶段分别得到：协议分类 export 不存在、预览 URL 为 404、Files 行没有 Raft 桌面直接动作。
实现完成后的证据：

- 定向协议、Application Service/SDK、Web 合同测试：3/3；HTTP 测试同时覆盖 401、跨 Room 403、
  2 MiB 上限、415、原始 MIME、安全头及既有 Range 矩阵。
- `npm run check`：851 个 package 测试中 849 通过、2 个真实付费 Provider opt-in 跳过；246 个 Web
  测试、34 个 parity regression 全绿。
- `npm run typecheck`、`npm run format:check`、`git diff --check`：通过。
- `npm run test:web:browser`：真实 Chrome 通过；覆盖桌面行内原消息动作、文本附件预览、Escape 关闭，
  以及最终 `390×844` 旅程；并继续覆盖真实上传、下载和 Range。

## 正式 4173 复核

待 1 小时 daemon soak 完成后，按 active-work audit、SQLite 在线备份、精确进程退出、重启、数据库
`quick_check`、桌面与 390px 冷开顺序补录。完成前不把隔离 fixture 门禁等同于正式用户实例发布。

## 保留边界

1. PDF/音频/视频安全内嵌需要 capability URL 或同等安全传输合同，当前只完成下载与 Range。
2. `.diff/.patch/.log` 作为显式 Artifact 已有专用 viewer；自动从 Git/build 捕获证据仍需独立、冻结的
   producer 合同，不能读取“当前工作区状态”冒充 Task 当时证据。
3. Room Artifact 是内容寻址副本，没有可信原始本机路径，因此 Finder reveal 当前判定为不适用；Agent
   Workspace 文件浏览是另一条有路径约束的功能，不能混为一谈。
4. Raft Server 未公开，不能声称后端逐行复制；可证明的是 Raft 可见产品合同、Multica 成熟安全结构与
   RAH OS 本地单 owner 的等价结果。
