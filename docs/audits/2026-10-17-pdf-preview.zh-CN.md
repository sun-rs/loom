# PDF 官方阅读器接线

## 官方组合与本地所有者

沿用 [Raft a98ae003246a0360872a77d76dec2fccd0347ef7](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7) 的 DocumentPreviewStore → DocumentAttachmentPreviewModal → AttachmentPreviewShell → CrossOriginPdfFrame。官方源码和组件参数不改；PDF 明确不传 comments，保持无评论入口。来源许可证及授权沿用前端 intake。

CrossOriginPdfFrame 要求初始 URL 是不同 origin 的绝对 HTTP(S) 地址，不能用同源地址或 blob URL，且不加 sandbox（Chromium 的原生 PDF 插件不能在 sandbox iframe 中工作）。本批新增的是本地传输接线，不称作拷贝官方服务端：

- ApplicationService 的只读 `/v3/client/files/pdf-preview/:id` 沿用 Kernel `downloadFile` 鉴权和附件成员权限；校验 PDF 元数据及 `%PDF-` 文件头，返回 application/pdf、inline、nosniff、no-store，保留原有 Range 支持。文件头检查不是完整 PDF 解析器；损坏 PDF 由浏览器报告，不能据此声称所有 PDF 可读。
- LocalWorkbenchGateway 唯一管理额外 PDF listener 的启动/关闭。绑定与应用相同的受信任本机/LAN/Tailscale IP，不绑定公网/wildcard；正式端口使用应用端口 +1（65535 时用 -1），临时 port=0 夹具用临时端口。固定来源避免页面 CSP 在同构建重启后过时。没有新后台进程或数据库。
- 已认证、同源 POST `/_rah/pdf-preview/:id` 先检查附件可读和 PDF 类型，再产生有效期 30 分钟的签名地址。签名只绑定一个附件；文件每次读取仍重新检查 Kernel 权限。启动时密钥只保留在内存，新进程使旧签名失效，重新打开取得新地址。不是公开分享功能，UI 不提供分享入口。
- PDF listener 仅接受签名文件的 GET，可处理 Range；拒绝应用 API/静态页面/写操作/错误 Host，不转发 Cookie、浏览器 Authorization 或上游重定向。仅内部请求携带 Human 权限；返回 headers 固定白名单，不允许 Set-Cookie。PDF frame-ancestors 仅允许对应应用 origin，主页面 frame-src 仅增加该 PDF origin；不加入通配来源。
- 普通下载仍返回原始字节。预览申请不可用时回退下载，已有未决写入/跨消息预览取消逻辑保留。

## 验证与局限

测试先以缺少 PDF gateway 实现失败；接口与 gateway 定向检查覆盖签名篡改、过期、成员权限撤销、同源申请限制、PDF 类型、HTML 伪装、Range、只读端点和重启后新签名。主页面 CSP 测试更新为精确本机 PDF origin，而不是放宽为任意来源。

真实 Kernel/ApplicationService/Gateway + fake Worker 发布一页有效 PDF，在 1440×1000 与 390×844、DPR 1 的完整 Chromium 下查看。实际截图确认正文渲染，原生阅读器可见；测试覆盖独立 origin、Range、无评论、下载、关闭。默认 Playwright headless-shell 不带原生 PDF 阅读器，最初只得到空白框；因此本门禁指定完整 `channel: chromium`，不能把旧空白框算通过。截图来自隔离测试，无用户数据或真实模型。手机尺寸仿真不是 iOS/Safari 真机验收，尚未验证不同浏览器自身的 PDF 工具行为。

HTML 双尺寸协作回归通过。未运行全仓套件或付费模型。真实部署采用只读页面 smoke 和 PDF listener 身份/隔离检查，不注入测试附件。有效期结束或服务重启后，未加载的 PDF 分段可能失败，关闭后重新打开；此处未实现自动续期。当前接线面向现用 HTTP 本机/LAN/Tailscale gateway，独立 TLS gateway 未接此能力，不能声称已验收。用户指定不做音视频预览。

[本批证据](../evo/evidence/2026-10-17-pdf-preview/summary.json)。
