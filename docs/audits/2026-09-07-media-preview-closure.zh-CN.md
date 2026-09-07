# 本机附件 PDF／音频／视频预览的限定收口

范围：单 Human / 单 Mac 的消息附件及 Room Files，沿用现有 Attachment、Room ACL 和 Files
下载 owner。该报告更新[前一批缺口](2026-09-07-real-cli-and-computer-closure.zh-CN.md)，
不宣称完整 Raft 媒体编辑／评论／所有编码与所有 PDF 特性均已复制。

## 方案与实际变化

- Protocol 的 `attachmentMediaPreview` 是唯一 media 类型和安全 MIME 映射 owner；
  PDF、mp4/webm/mov、Raft 列出的常见 audio 扩展名/MIME 不再一律 unsupported。
  HTML 伪装为媒体时也只交给对应二进制解码器，不以 active HTML 返回。
- 最大 20 MiB 的媒体按需通过现有 `files.download` 认证读取；Blob URL 只属于当前预览，
  不写浏览器存储、不携带 token、不绕过 ACL。预览前拒绝超限元数据，取回后复核长度，
  晚响应关闭后不能创建 URL，正常关闭会释放。大文件仍可完整下载，尚非大文件流式播放。
- 音视频采用 Raft 的 native controls / metadata preload / video playsInline，无自动播放。
  解码失败准确显示错误并保留原下载动作；支持哪个 codec 仍由实际浏览器决定。
- PDF 使用本地、固定版本的 PDF.js 逐页 canvas 渲染，最大单页画布约 400 万像素。
  前后页操作按实际页数禁用，换页使用新 canvas；关闭取消 render 并销毁 document worker。
  不执行 PDF scripts/actions、不接入外链/表单；密码 PDF 提示下载后打开。当前没有复制
  原生 PDF viewer 的文本选择、搜索、缩放、打印及批注整套能力。
- PDF.js core/worker/CMap/标准字体/ICC/decoder 资源与 LICENSE 随本地冻结构建提供；无 CDN。
  禁用 wasm 与 FontFace，保留正式 CSP 的无 unsafe-eval 策略。复杂编码、扫描 PDF 和特殊字体
  未由本次小样本认证；这些限制须保留，不用普通 PDF 成功推断所有文件成功。
- 两个正式网关允许受控 Blob image/media/connect，frame 仍只允许 self。
  `.mjs` 静态资源返回 JavaScript MIME，修复 native worker 在严格 nosniff 下被拒绝的问题。
  文本 preview API 继续拒绝 PDF/audio/video（415），下载头、Range、Room ACL 不放宽。

## 来源与采用性质

1. 授权 Raft `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
   `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：
   Ott/mle/fle 为 PDF/video/audio 判型；xle/Nb 为预览打开及下载回退；音视频 renderer 的 native
   controls 参数和 video 的黑底、16px padding、2px border 用于结构移植。
   iframe PDF 在本地 Blob + sandbox 条件下实际失败，因此没有复制一个不可用的结果。
2. Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`（Apache-2.0），
   `packages/views/editor/hooks/use-inline-media-url.ts`，SHA-256
   `33e31910394978afe4dd14e33ef95e40e089a6eb676c580e7b9f686c8d49e5e6`：
   参考 authenticated Blob fallback 与 object URL 生命周期，不采用 signed URL/query cache。
3. Mozilla [PDF.js 官方示例](https://mozilla.github.io/pdf.js/examples/) 的
   getDocument/getPage/render/cancel 所有权；固定 npm `pdfjs-dist@6.3.289`（Apache-2.0）。
   core SHA-256 `495588717f62303a839e91a5343deebf1b41f52e2f9f6361e73dee6ea6a4355e`，
   min worker `8ab0e5e30031b4a06ecfddd5ae9562f0227f830ee7ec9ed1a968b134243d2386`。
   优势是本地严格 CSP 条件下实际可渲染，canvas 不包含活动 PDF 动作；为明确的额外依赖，
   lockfile 固定，LICENSE 随包保留。本地分页框架和认证 glue 是 RAH 实现，不标记为 Raft 原样复制。

## 行为登记与验收口径

| 稳定子行为           | 成功出口                                     | 失败／关闭出口                               | 本地 owner                                |
| -------------------- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| FILE.MEDIA.AUDIO     | WAV 元数据可解码、controls、完整下载字节一致 | 损坏音频准确报错；关闭释放 URL，焦点返回     | protocol → Files → AttachmentMediaPreview |
| FILE.MEDIA.VIDEO     | WebM 可解码、native controls、无 autoplay    | 损坏视频准确报错；关闭释放 URL，保留下载     | 同上                                      |
| FILE.MEDIA.PDF       | PDF 文字实际绘制；两页切换产生不同画布       | 无效 PDF 报错；取消 render/worker，释放 URL  | 同上 → PdfAttachmentPreview               |
| FILE.MEDIA.LIMIT     | <=20 MiB 经认证读取并核对长度                | >20 MiB 读取前拒绝；长度不符不分配 URL       | file-preview-resource                     |
| FILE.MEDIA.TRANSPORT | 正式 CSP 与 .mjs MIME 能加载本地 worker      | 不借 text preview 放行二进制，不移除 nosniff | Local/LAN gateway、application-service    |

来源修订相同；每个行为都以同一 FilePreview dialog 的点击/Escape/焦点协议进入退出。
下载独立 pending/error owner 保持；不因关预览而取消用户已明确请求的下载。

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-media-preview`。

- `classifier-red.log`、`csp-red.log`、`resource-red.log`、`worker-mime-red.log` 是相应预期失败。
  对应 green 的协议、HTTP 与资源生命周期测试通过。
- 初版 iframe gate 只证明 iframe 存在，虽打印 passed，截图显示 Chrome 错误页、Firefox 空白；
  `browser-render.log` 不算 PDF 通过。强化为实际 canvas 绘制后，`pdf-render-red.log` 复现缺口。
- 初期 gate 的 cookie/Origin fixture 设置失败单列保留，未当作产品失败；正式网关的 CSRF
  检查没有被绕过或删除。一个失败启动遗留的隔离 fixture 已精确 TERM 清理，不涉及正式进程。
- `media-matrix.log`：Chrome/Firefox × 1440×900 / 390×844，6 文件共 24 场景通过。
  包含有效双页 PDF、WAV、WebM，三种损坏文件，刷新、页切换、非空画布、解码 readyState、
  逐字节下载、Escape/焦点以及精确 Blob URL 释放。截图已人工查看，PDF 正文实际可见。
  临时证据 `rah-media-preview-pNK1QX`，测试使用真实生产 bundle 和 LocalWorkbenchGateway，
  后端是隔离 daemon（经既有 Vite API proxy 注入 fixture 身份），不是正式用户数据。
- 无付费模型调用；上一批四家模型实测无需为媒体 UI 重复付费。

## 尚不能归入本次完成的事项

大于 20 MiB 的流式媒体、原生 PDF 完整工具栏、复杂字体/编码/大量页样本、官方同条件非空
媒体双边验收以及实体设备 PWA 播放仍未完成。Computer 剩余管理动作、Settings 适用行为和
全产品双边/实机/soak 缺口仍见主线审计。不能由此宣称五项全产品或全部 Raft 功能完成。

最新 `matrix-frozen.log` 将 PNG 也加入正式 CSP 矩阵（7 文件 × 双浏览器双尺寸），
并将构建资产插件本身加入输入 hash；不把早期 iframe 的 passed 当作成功。
`text-regression.log` 的既有 9 文件 × 双浏览器双尺寸回归也通过。

## 正式交付

`check-final.log` 全量 check、`format-complete.log`、`git diff --check` 通过。
`matrix-frozen.log` 最终 28 场景通过，收据 `rah-media-preview-gQ8JrU`；
`text-regression.log` 的 36 场景通过，收据 `rah-file-types-z9oAat`。

2026-09-07 idle 检查后备份至
`/Users/sun/.rah/backups/pre-restart-adf00496-1edf-4a24-9903-eda0258b762d`，优雅停止旧实例，
以冻结 Web build `c5458bea3542fdce71266faafba997590b6dba1b52b47d8b3b24fa739704af2a`
启动正式 `http://127.0.0.1:4173`，当时 PID 19131（后续操作需重查）。
正式 Chrome/Firefox 新页验收通过：`formal-browser.log`，收据 `rah-discovery-formal-MvlxCn`，
截图已检查。该正式只读 gate 检查新包及已有页面；媒体上传和破坏性输入留在隔离生产包 gate。
重启前后内容 hash 完全一致：6 Rooms、43 Messages、2 Tasks、380 events、4 Agents、
36 Agent revisions、37 memory files。无提交、推送或发布。
