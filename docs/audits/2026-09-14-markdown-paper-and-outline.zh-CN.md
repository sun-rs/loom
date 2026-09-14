# Markdown 报告纸张与大纲

## 来源与结论

授权分析源：Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
WZe（pretty 123297–123349）负责 Markdown 报告；CZe（122287起）负责目录。
CSS `https://app.raft.build/assets/index-DPaRRgFJ.css`，SHA256
`0d658697e96e6569a8a9d29279e0765da20517a7133a2facf708f45af39afbf0`。

| 参数     | Raft 源码                                        | RAH 处理                                |
| -------- | ------------------------------------------------ | --------------------------------------- |
| 报告边界 | card-brutal：2px solid black                     | 原有2px一致                             |
| 报告阴影 | 4px 4px 0 #141111                                | 原为2px，修正为4px，并使用内部 ink 颜色 |
| 大纲断点 | xl：@media(min-width:80rem)，默认1280px视口      | 原1280px一致，保留                      |
| 大纲吸顶 | xl:top-20：80px                                  | 换算本地滚动坐标，实际吸顶在视口80px    |
| 大纲最高 | calc(100dvh - 7rem)，默认减112px                 | 一致，保留                              |
| 双列     | 16rem + minmax(0,48rem)，间距24px；容器最大72rem | 一致，保留                              |
| 窄屏纸张 | 容器最大48rem；md断点768px调整内外边距           | 一致，保留                              |

断点根据浏览器视口计算，不按开启评论栏后的剩余阅读宽度计算：1280px仍显示目录，1279px隐藏。
因此开启评论栏时纸张按现有网格约束缩窄，目录是否显示不随评论栏改变。
Raft滚动容器始于视口顶部；本地共享滚动容器始于58px工具栏下方。因此本地top使用
`calc(80px - var(--rah-file-preview-header-height))`，实测滚动后视口坐标为80px，
初始时目录与报告顶部对齐，避免直接套用80px导致目录向下偏移。
没有修改字体、Markdown内容解析、附件评论权限或持久业务数据。
页面 CSS 是本次布局的单一所有者；硬阴影几何为源码支持的结构移植，颜色复用维护型 token。
通用 shadow-m 当前采用较新的 OKLCH 色值，与本次 Raft card-brutal 的 #141111 不完全相同，
因此这里明确采用4px偏移和 ink，而不改动全局阴影别名。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/attachment-preview-modal.tsx:430` 为圆角 max-w-6xl/shadow-xl 弹窗，
不提供本次 Raft 纸张几何优势，未采用其代码。

## 验证

浏览器门禁先加入实际阴影断言，确认原2px阴影失败，再修改实现。
同一门禁覆盖1279/1280/1440/390px、评论栏开关两种状态、2px边框与4px阴影、
目录隐藏/显示、80px吸顶及纸张宽度和视口边界。
Chrome、Firefox上述专项均通过，截图已目视核查。
`npm run check` 首次在并行修改中的 task-assignee-control 的 avatarKey 类型处中止；
该并行修改完成后，重新 typecheck 通过，并逐项补跑余下检查：核心套件1590通过、17项显式跳过、
Web单测、parity回归、正式浏览器策略及双边截图证据规则均通过。UI规则/目录、
format:check、git diff --check、正式Web构建通过。未把初次中止记为整条命令通过。

正式服务完成空闲检查、备份和优雅重启。备份路径
`/Users/sun/.rah/backups/pre-restart-aeb1dced-5f7d-4419-90c8-eedd1f8365ba`；
冻结构建 `f999571fd2e281742db0cd9e99e1ae25124dd28630d06c4cadb3b6e7a1e35dcb`。
真实浏览器打开现有长Markdown，验证2px边框、4px硬阴影、1279/1280/1440/390px、
评论栏开关、视口80px吸顶、刷新及LAN/Tailnet同一构建；未发送真实消息。
截图 `/tmp/rah-markdown-paper-formal-1440-false.png` 已目视核查。
这是源参数对齐与本地真实浏览器验证，本轮没有执行线上Raft相同内容的双边截图验收。
