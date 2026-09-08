# 附件评论与位置跳转：本地前端闭环（2026-09-08）

本批将已有附件评论 owner 接入现有文件预览。评论仍是原附件所在 Room 的 canonical Thread Message；前端不持有第二套聊天记录，不推断 Agent 是否读过评论。本文不代表整个 Raft 产品已复刻完成。

## 来源与采用边界

- 授权发布物：`docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA-256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。`Lw`（字符位置 2367675）提供附件评论读取、表单、引用、定位按钮和 mentions；`Q8e`（字符位置 2296972）提供定位与高亮；`K8e`/`yj` 提供点击/文本选择到锚点的转换。精确 UTF-8 字节位置及片段保存于本批 `source-evidence.json`，字符位置不冒充字节位置。
- 同版 CSS `index-D8Neh8lc.css` UTF-8 byte 4894 给出 `--color-brutal-stone:#c0b9b1`；byte 656173 给出 1.6 秒 ease-out 黄色到透明的定位动画。唯一 token owner 增加 `--attachment-comment-stone`，评论卡片与位置徽标分别消费 10%/25% 混色；没有另建主题。
- 桌面评论栏来源为 `w-80`，即 320px；移动端 `attachment-comments-sheet` 的展开高度为 `45dvh`。本地继续使用原文件预览的 dialog/focus/资源清理 owner，横向预览上限沿用其原 1000px 意图，明确覆盖原通用 dialog 的 520px 上限。
- 上游来源为用户明确授权的闭源发布物；原 bundle 仅分析使用，没有成为生产依赖。本批是结构移植与 RAH glue，不能称为逐字复制。
- 对照了 Multica `packages/views/editor/text-anchor.ts`：其 Tiptap 字符位置桥接属于可编辑文档，不适合已有不可变附件的行、标题和时间点；不引入第二套编辑器或锚点模型。

## 唯一 owner 与行为

1. `AttachmentComments` 复用 SDK `file.comments` / `file.comment`。读分页每次至多 50 条，只持有当前页，使用已有 `useReconciledQuery` 单飞读取、轮询、Abort 与作用域失效；不进行业务 ACK。
2. 发送使用评论响应的真实 `roomId` 创建既有 `RoomSession`，经 `runRoomMutationAtLatest` 同步屏障后提交。body、anchor 与明确 recipients 构成固定重试意图；请求已提交但响应丢失后仍使用原 key 和 recipients，不能重复创建评论。没有乐观虚构 canonical 评论。
3. 后端返回附件原 `messageId` 与实际 Thread 的 `threadRootMessageId`，两者可能不同。打开讨论传真实 Thread 根；浏览器实际发现并复现了“只带 Thread ID 的初始 URL 不打开本地 Thread”，由真实根地址补齐，没有把回复附件所在 Message 当成根。
4. `@Agent` 复用 `WorkspaceEntityContext` 既有 Agent 投影、`room.member.list` 当前成员及 `useComposerMention` / `mentionedRoomAgentIds`。只给当前附件 Room 中匹配的 Agent 发送明确 recipients；没有新建 membership 或 mention parser。IME Enter 不发送，选择菜单 Enter 先完成名字，正常 Enter 才提交。
5. 评论正文复用现有安全 `MessageMarkdown`。位置/作者/引用是实际 button，Markdown 正文放在 button 外，避免链接与按钮形成嵌套交互元素。
6. 锚点解析与 DOM 查询只在当前预览 root 中发生；数字校验、CSS escaping 与最多 201 个行目标沿用 Raft 的有界高亮方式。普通文本新增行节点亦限制为最多 5000 行，保留既有 300000 字符截断，避免行标记把原预览变成无界 DOM。
7. 文件切换卸载旧评论作用域；晚到的旧文件响应不得写入新文件。失败与轮询不清除草稿；关闭/重开评论面板保留当前文件草稿。发送期间新选择的引用不会被旧发送成功回执清空。

## 可呈现范围

| 类型                     | 本批行为                                           | 本地实证                                                                            |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 文本 / diff              | 点击或选择行生成 lines；评论 button 滚动定位并高亮 | Chrome / Firefox 指针点击、真实上传与发送，文本离开目标后再点击验证目标回到可见范围 |
| CSV / TSV                | 已渲染表格行生成 csv-rows                          | CSV 两引擎真实发送与高亮；TSV 共享现 delimiter owner，未单独浏览器运行              |
| Markdown                 | 标题/段落选择生成 md-section；标题跳转             | 两引擎真实发送、Markdown 正文与标题高亮                                             |
| Video                    | 暂停且 currentTime > 0 时评论时间点，回跳暂停视频  | 两引擎真实生成并上传 WebM，0.2 秒记录、改到别处再回跳并验证 paused                  |
| PNG / PDF / WAV / HTML   | 整文件评论与 Thread 跳转                           | 两引擎真实文件 bytes、评论 API、Markdown 正文                                       |
| html-region、未知 anchor | 保留数据，准确显示当前预览不支持定位               | 未知 anchor 两引擎实际后端记录与不可定位状态                                        |

Markdown 标题 ID 使用不可变本地附件渲染器中的稳定顺序编号，是本地适配；没有证明可导入任意 Raft 外部 headingId。HTML 继续使用原 `sandbox=""` 与 CSP，不为 html-region 新增可执行脚本桥。PDF、图片、音频没有本批已证实的位置选择契约，不能声称所有 Raft anchor 类型已对齐。

## 验证及其界限

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-attachment-comments-ui/`。

- `anchors-red.log` → `anchors-green.log`：行/CSV 数值与范围、heading/video 白名单、未知 metadata、排序输入不变等规则 3 项。
- `browser-red.log`：真实前端缺少评论入口的失败。`browser-expanded.log`：Thread 链接实际不打开的失败。`browser-expanded-2.log`：Chrome、Firefox 各完成文本及上述八文件场景；包含指针命中、viewport 中目标与高亮、刷新持久化、390×844、真实回执丢失后只产生一条评论、读取失败保留草稿、未知位置、真实 Thread 打开。
- `mentions-red.log` → `mentions-green-final.log`：两引擎实际点击 `@Alice` 候选并发送；隔离 daemon 的 SQLite **只读**检查证明该评论同一 event 的 Agent Inbox 行存在，状态可为 pending。IME 不发送；原门禁切文件之间有 reload，因此该日志仅证明重载后的隔离。独立审计去掉 reload，Chrome 在同一 SPA 内保持旧读取、打开新文件并输入草稿后释放旧响应，仍维持新文件空态及草稿，见 `independent/no-reload.log` 与 `independent/review.zh-CN.md`；Firefox 未单独跑无重载变体。
- `tokens-red.log` → `tokens-green.log`：精确原始 byte offset 值、单一 token、两处引用、动画与栏宽。
- `targeted-final.log`：23 个受影响的预览资源、mention、身份投影与 anchor 测试通过。`web-typecheck-final.log`：Web 类型检查通过。
- 已人工检查桌面文本高亮、视频评论、HTML 沙箱及手机截图。PDF 评论截图仍显示原预览解析中，本批证明其整文件评论链，不能把该截图当作 PDF 渲染完成验收。双边官网同条件截图、全仓检查、最终 bundle 与正式部署重启由 root 集成验收；本子批没有独立执行，不能由本地 fixture 截图推导其通过。
- UI 的更早/最新分页接了既有后端有界合同，但本批未单独跑超过 50 条评论的浏览器翻页场景；源对应的移动收起手势、HTML region、逐页面双边视觉仍是明确的未验项目，不以已有回调数宣称全量完成。

未运行付费 CLI、未提交 Git、未重启正式实例、未添加 Task 删除按钮。
