# 官方附件支持核对与 HTML 接线

核对的是已取得并采用的官方源码 a98ae003246a0360872a77d76dec2fccd0347ef7（不是只按 PDF、MD、HTML 三个例子推断，也不声称代表未取得的后续线上版本）。来源：[raft-source](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2；owner 已另行授权非商用复用。

## 官方支持范围

| 类型         | 官方展示与限制                                                                                     | Loom 本批之后                                                         |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 图片         | image/* 图片画廊与灯箱；SVG 必须已有缩略图或栅格预览，不能直接当普通图片预览；实际解码取决于浏览器 | PNG/JPEG/GIF/WebP/AVIF 原生画廊；不宣称全部 image/* 与 SVG 转换已接通 |
| Markdown     | .md/.markdown、Markdown MIME；原生排版、选区及评论                                                 | 已接通，已做 Worker 发布 → Human 评论 → 作者显式回复闭环              |
| 纯文本与代码 | text/* 及 JSON/XML/YAML/TOML/shell MIME；常见代码、配置、日志扩展名；原生文本与评论                | 已接通文本预览与评论；不是 IDE 或代码执行器                           |
| CSV          | 原生表格、行定位评论；5 MiB 上限                                                                   | 尚未接表格解析和原生表格；当前下载                                    |
| XLSX         | 工作表切换、表格与评论；10 MiB 上限；不等于旧 XLS 或所有 Office 文档                               | 当前下载                                                              |
| Diff / Patch | 附件卡显示文件数、hunk 数、增删行统计，点击下载；不是完整 Diff 编辑器                              | 当前下载，尚未接统计摘要                                              |
| HTML / HTM   | 官方沙箱预览、交互脚本、外链确认；桌面区域评论；触屏只普通评论，官方主动隐藏框选层                 | 本批接通；本地沿用 2 MiB 预览上限，超限仍可下载                       |
| PDF          | 官方跨源 PDF frame（浏览器原生阅读器）；源码明确关闭评论，等待受控渲染器                           | 当前下载；不可声称已有 PDF 批注能力                                   |
| 视频         | MP4/WebM/MOV，原生播放器与时间点评论；实际编解码支持由浏览器决定                                   | 当前下载                                                              |
| 音频         | MP3/WAV/M4A/AAC/OGG/OGA/OPUS/WEBA/FLAC 及对应 MIME；原生播放器，没有附件评论入口                   | 当前下载                                                              |
| 其他         | 未看到 DOCX/PPTX/旧 XLS/压缩包等通用文档阅读器的接入证据                                           | 下载，不伪造可预览                                                    |

核对位置：`frontends/raft/packages/shared/src/attachmentPreview.ts`、`packages/web/src/components/message/attachmentPreview.ts`、`urlImageFallback.ts`、`MessageItem.tsx`（Diff 分支）、`attachmentPreviewSurfaces.tsx`、`MediaPreviewHost.tsx`。代码扩展名清单包括 txt/text/log/ini/conf/cfg/properties/toml/yaml/yml/json/xml/sql/gradle/sh/bash/zsh/kt/kts/java/swift/ets/ts/tsx/js/jsx/mjs/py/rb/go/rs/c/h/cpp/hpp。

## HTML 完整组合链

附件卡 → 官方 mediaPreviewStore → Loom HtmlPreview 数据组合 → 官方 HtmlAttachmentPreviewModal → AttachmentPreviewShell / HtmlPreviewBody / SandboxedPreviewFrame / AttachmentCommentsPanel。官方页面组件保持逐字节不变；尺寸、字体、桌面侧栏、移动端底部评论面板、关闭/下载/模式切换沿用原生实现。

浏览器向同源 gateway 请求 HTML；ApplicationService 先走既有 Human downloadFile 鉴权及附件访问检查，再以流式 transform 注入官方 reporter。普通下载返回原始字节。Reporter 来自同一官方提交的 `packages/server/src/services/attachmentPreviewBridge.ts`，两处仅为本仓库严格类型检查补非空断言，运行时不变；原始及采用后 hash、许可证位于 `packages/application-service/vendor/raft/`。不是重新编写 reporter。

CSP 从同提交官方 `routes/attachments.ts` 的 buildHtmlPreviewContentSecurityPolicy 结构移植：sandbox allow-scripts，无 same-origin/forms/popups，connect-src none，frame-ancestors self。Loom 使用已有同源认证代理，不引入 Raft 中央服务/签名令牌；gateway 保留服务端 CSP、no-referrer、Content-Disposition。允许官方 HTTPS 脚本/图片等资源，不能把此策略声称为阻止所有外网请求。nonce、document epoch、source frame 校验仍由原生 bridge 负责。

Room/附件评论仍只有 Kernel 一个所有者；显式附件回复与普通线程消息区分。没有增加自动提取模型本地文件、自动把普通 final 当附件回复或新调度路径。

## 验证及边界

接口测试先证实旧实现 HTML route 404，再接入鉴权、访问权限、GET-only、错误格式、大小限制和 CSP。接入后浏览器验证桌面 1440×1000 与手机 390×844、DPR 1：官方脚本就绪、HTML 按钮可交互、下载字节不变、桌面区域锚点、Human 评论唤醒作者、Worker 显式回复、刷新保留；普通线程回复不混入。手机保留官方无框选规则。源码摘要测试证明 reporter 的运行逻辑未改；逐字节流测试覆盖 UTF-8 与 CSP meta 前插入。

夹具使用真实 Kernel/ApplicationService/Gateway 和 fake Worker 执行，不调用付费模型，不证明模型自己会发布附件。正式部署只做只读页面检查，不往用户频道写入测试附件。证据见 [本批记录](../evo/evidence/2026-10-17-html-preview/summary.json)。

后续按纵向切片：视频/音频已有原生播放器与 Range 传输可直接接线；再接 CSV/XLSX 的解析数据；PDF 单独处理跨源阅读器约束，保持官方关闭评论；最后补 Diff 摘要和图片栅格化。不能把这些未接线项算作已完成。

后续状态：CSV/XLSX/Diff 已在[表格接线批次](2026-10-17-table-preview.zh-CN.md)实现；owner 取消音视频预览需求，前述顺序不再适用，PDF 保持待接入。
