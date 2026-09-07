# PDF 基本阅读操作限定收口

本批沿用既有认证附件预览、PDF.js 文档生命周期及内存上限，补齐缩放、适合宽度与页码跳转。
没有增加后端状态、下载通道或 Provider 调用。100% 表示适合当前阅读区宽度；高倍率达到
400 万像素预算后仅继续视觉放大，不承诺无限清晰度。单边尺寸另限制为 16384 像素。

## 来源与 owner

Raft 来源、授权 bundle hash、原生 iframe 在本地受限条件失败的依据见
[媒体预览审计](2026-09-07-media-preview-closure.zh-CN.md)。本次控件为 RAH 适配，
不能标记为官网原样复制或完整原生 PDF viewer。

已比较 Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/utils/zoom-transform.ts`，SHA-256
`81bdfc89cb95a1e42862a92546de6d73efcf468f5e0251c7af5be434f0cab562`。
该模块面向图像/图表的 transform 平移缩放；不为分页 PDF 新增第二套手势状态。
采用已固定依赖 `pdfjs-dist@6.3.289` 的 `web/pdf_viewer.mjs` / `PDFViewer.updateScale`，
SHA-256 `e48aa528d626b49b70705245c22646cf41b59c54f77243d8612dcffdc366b823`：
1.1 倍步长、方向取整及 0.1–25 边界的结构移植，Apache-2.0，既有构建保留 LICENSE。

`apps/web/src/pdf-reading.ts` 拥有纯计算；`PdfReadingControls` 拥有输入与反馈；
`PdfAttachmentPreview` 继续拥有文档、页与取消；内部 media-preview.css 拥有布局。
所有操作均不改变 Room、附件或 Task。

| 行为                     | 验收出口                                         | 边界                                 |
| ------------------------ | ------------------------------------------------ | ------------------------------------ |
| FILE.PDF.ZOOM            | 连续放大、画布宽度变大、可横向滚动、适合宽度复位 | 单画布不超过 400 万像素，10%–2500%   |
| FILE.PDF.PAGE.JUMP       | 输入页码 Enter 跳转、实际绘制目标页、首尾禁用    | 空值、零、越界、小数拒绝，当前页不变 |
| FILE.PDF.CONTROLS.LAYOUT | 桌面和 390px 工具栏紧凑显示                      | 不继承通用 Dialog 表单的单列网格     |

## 验证

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-pdf-reading`。

- `unit-red.log` → `unit-green.log`：先复现缺失，再通过缩放、页码与画布边界测试。
- `browser-red.log` 在旧冻结包复现缺少页码输入；初版功能通过后，人工截图发现工具栏
  被通用表单 grid 覆盖。第一次仅检查 flexDirection 的断言不足，`layout-red.log` 不证明布局正确；
  `layout-display-red.log` 正确复现 grid/flex 冲突，修复后重新验收。
- `browser-final.log`：Chrome/Firefox × 1440×900/390×844 × 7 文件，共 28 场景通过。
  保留绘制非空文字、双页不同画布、图片与音视频解码、损坏文件错误、下载字节、Escape 焦点
  和 Blob URL 释放回归。收据 `rah-media-preview-1AvokM`，桌面/窄屏缩放截图已人工检查。
- `check.log` 全量检查通过；`build.log` 正式冻结包构建通过。

本地成功不等于官方同前置双边验收。PDF 文本选择/搜索/打印/批注、复杂字体与大量页样本、
大文件流式预览、实体设备验收仍未收口；Computer 服务管理及 Settings 的剩余范围不受本批改变。

## 正式交付

`format.log` 与 `git diff --check` 通过。idle 检查后已备份至
`/Users/sun/.rah/backups/pre-restart-68bc8bb7-4961-4909-9832-1968665d2105`，
优雅重启正式 `http://127.0.0.1:4173`，新 PID 36546（后续需重查），冻结 Web build
`39c509bfc4bcae149ee0155a44c42f6cb2ac9a93b759403fae0d4095f69d9b11`。
`formal-browser.log` 的 Chrome/Firefox 新页验收通过，收据 `rah-discovery-formal-EQlSyd`，
已查看正式截图。PDF 操作本身在隔离生产包验证，没有向正式 Room 写入测试附件。
重启前后持久数据及记忆内容 hash 一致：6 Rooms、43 Messages、2 Tasks、380 Room events、
4 Agents、36 Agent revisions、37 memory files。没有提交或推送。
