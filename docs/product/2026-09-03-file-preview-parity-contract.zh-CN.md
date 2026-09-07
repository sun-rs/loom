# Files 与 Artifact 预览收口合同

日期：2026-09-03

## 结论

本批把两个容易混淆的 Raft 产品面分开实现：

1. **频道 Files 聚合面**：文件卡片、图片预览、下载、跳转原消息；桌面直接显示
   “跳转/下载”图标，窄屏收进同一个可键盘操作的菜单。
2. **消息附件富预览面**：Markdown、HTML、diff/patch、CSV/TSV 和受控文本预览。
   它复用同一个 Attachment 身份和下载 owner，不建立 Artifact 副本或第二套 ACL。

PDF、音频和视频的大文件流式内嵌预览不在本批伪装完成。RAH OS 的客户端鉴权使用
Authorization header，不能直接把受保护 URL 交给 `<iframe>/<video>`；在没有短期、
单文件 capability URL 或同等安全传输前，它们继续走可恢复下载。

## 来源与取舍

### Raft 产品合同

- 来源：授权留存的 Raft Web build
  `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，以及 2026-09-03
  登录后页面实测。
- Channel Files 的事实：`GET /channels/{id}/files`、50 条分页、距底 320px 继续加载；
  桌面每行直接显示 28px 的“跳转原消息/下载”动作；受特性开关影响时合并为溢出
  菜单；图片使用全屏灯箱，非图片取得 URL 后打开。
- 消息附件的事实：Raft bundle 分别存在 diff/patch、CSV、Markdown、PDF、文本、
  视频、音频和 HTML renderer；文本预览返回 `kind` 与 `truncated`。
- 不复制：Raft 的云端签名 URL、对象存储和中央 Server 路由不适合本地 daemon。

### Multica 结构复用

- 来源提交：`11861145abc59a0d39c8c8f24ad837d4584e664f`。
- 参考：`server/internal/handler/file.go` 的 2 MiB 文本上限、严格白名单、
  `text/plain + nosniff + no-store`；`packages/views/editor/utils/preview.ts` 的类型
  分派；`attachment-preview-modal.tsx` 的单一全屏框架。
- 本地改造：判型与白名单只在 `@rah-os/protocol` 保留一个 owner，Server 和 Web
  共同调用，消除 Multica 当前前后端手工同步的漂移风险。实现按 RAH OS 的
  Kernel/Application Service/SDK/React 边界重写，不复制 Multica UI 文本。

## Single owner 与安全不变量

```text
protocol classifyAttachmentPreview（唯一判型/白名单）
  -> Kernel RoomFiles.download（现有 Room ACL、immutable metadata、O_NOFOLLOW fd）
  -> Application Service /files/preview/:id
       text/plain; charset=utf-8
       X-Original-Content-Type
       no-store + nosniff + restrictive CSP
       <= 2 MiB
  -> Client SDK previewText
  -> Web 单一 FilePreview 框架
       image Blob URL
       Markdown sanitized renderer
       HTML opaque sandbox + script/network-blocking CSP
       bounded diff/CSV/text DOM
```

- 预览与下载每次都重新检查 Room membership；未发出的 staged upload 不可预览。
- HTML/SVG 永不以 app-origin 可执行 MIME 返回。HTML 只作为 `text/plain` 取回，
  再进入无 `allow-same-origin`、无脚本权限且注入限制 CSP 的 `srcDoc`。
- 文本响应最多 2 MiB；前端对 diff/CSV/日志再做渲染条目上限，避免小字节数制造
  过量 DOM。
- 任何不支持或过大的预览都保留下载，不把失败包装成空白成功。
- 原消息定位继续使用冻结的 `messageId + roomSeq`，不按文件名或当前列表位置猜测。

## TDD 与验收

1. 协议测试覆盖 MIME、扩展名、无扩展构建文件、HTML/SVG 和未知二进制。
2. HTTP/SDK 测试覆盖成功、2 MiB 上限、415、认证与 Room ACL，并确认下载安全头
   和 Range 行为不回退。
3. Web 合同测试覆盖桌面直达动作、窄屏菜单、单一预览框架、Escape/焦点恢复和
   有界 renderer。
4. 全量 `npm run check`、格式、diff、Web build；真实浏览器验证桌面与 390px
   的 Files、消息附件、预览、下载入口、跳转及刷新。
5. 通过 active-work audit 后安全重启 4173；只在正式实例做无写入复核。

## 2026-09-07 resource-lifetime repair

`apps/web/src/file-preview-resource.ts` extracts the existing image Blob resource
lifetime from FilePreview. Its AbortSignal owns cleanup; a late successful
response after closing must create no URL. This is RAH lifecycle glue, not copied
Raft source. The existing Raft/Multica comparison above still governs renderer
selection. It adds no MIME types, streaming grant or download policy. Tests first
reproduce the old allocate-after-cleanup behavior, then cover cancellation before
response and exactly-once release after a completed response.
Public attachment reads now use the current content-reader policy from the
public-Channel design; unpublished uploads and private Agent files remain separate.

## 2026-09-07 download recovery

FileCard remains the single download owner for its direct/menu/preview actions.
Its in-flight guard prevents overlapping requests; the preview receives pending
and error state instead of starting another transport. While the dialog is open,
download failures appear inside it, with the existing button available for retry.
Closing the preview does not cancel an explicitly requested download. This is local
recovery glue, not a copy of Raft's signed-URL transport. See the
[download repair audit](../audits/2026-09-07-file-download-recovery.zh-CN.md).

## 2026-09-07 shared menu

FileCard now composes the internal ActionMenu over pinned Base UI 1.3.0. The old
page-owned positioning, document key listeners and outside/focus logic are removed.
The existing download/source callbacks and adopted menu CSS remain the same; popup
position belongs to the shared positioner. Keyboard ArrowDown opens the menu and
Escape restores the trigger. This follows Raft `_it`'s shared trigger/menu/item
composition; it is a structural port with local glue, not byte-exact source reuse.

## 2026-09-07 bounded binary preview rollout

当前新增 <=20 MiB PDF/audio/video 认证 Blob 预览，替代上文对所有二进制内嵌预览均不可用的
历史描述。大型流式预览仍不在此能力内。判型在 protocol，原 Files ACL/download owner 不变；
text-preview 继续返回 415。AbortSignal 管理 Blob 生命周期，长度不匹配不分配 URL。
PDF 采用随包 PDF.js 6.3.289 的逐页 canvas，脚本/表单不执行；保留严格 CSP 和明确错误。
native 音视频无 autoplay，失败保留下载。具体来源、差异、PDF 工具栏限制及证据见
[媒体预览审计](../audits/2026-09-07-media-preview-closure.zh-CN.md)。
