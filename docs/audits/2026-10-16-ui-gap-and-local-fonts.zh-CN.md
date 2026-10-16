# 官方前端低难度缺口复核与字体本地化

本次按 owner 同意的顺序完成“核对剩余缺口＋字体本地加载”。范围是当前产品接线，非重新审计后端，也不宣称所有官方功能已完成。

## 接线清单与顺序

| 功能                       | 官方组合／本地证据                                                                                | 当前结论与下一步                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 字体与主题                 | raft-ui 0.5.64 `fonts.css` → 官方 `src/index.css` → AppearanceSection                             | 本批完成本地字体，不改变主题参数、字体、字重或字符范围                                                                                    |
| 聊天列表、分组、拖动与菜单 | Sidebar → ChannelSidebar／sidebar-state                                                           | 已接；这轮未重跑既有全部交互，见此前部署证据                                                                                              |
| 搜索、动态与跳转           | SearchOverlay／MessageSearchPage／Activity → DiscoveryPage                                        | 已有筛选、常用项、续页、返回窗口与消息定位；独立历史菜单及浮层拖动仍缺官方 Web 宿主证据，不造按钮                                         |
| 消息表情回应               | 官方 MessageItem／reaction 组件；SDK `discovery-operations.ts` 的 `message.react`                 | 后端有接口，`ChannelTimeline` 仍传 `readOnlyProjection`；优先下一刀接权威投影、按钮与未知结果处理，尚未实施                               |
| 消息转发                   | 官方 MessageItem／转发选择与内容展示；SDK `message.forward.targets`、`message.forward`            | 后端有接口，`channel-client.ts` 当前对 forwardedBundle 显示未接提示；排在回应之后，必须贯通目标权限、提交、转发内容和跳转，不能仅添加菜单 |
| Task                       | 官方 TasksPanel → TaskBoardActions／TaskCreate／TaskProperties                                    | 创建、状态拖放、指派已有接线；“多标题创建”不是任意批量操作，后者本轮未证明可直接搬入                                                      |
| 附件                       | GalleryImageItem／AttachmentChip／DocumentAttachmentPreviewModal → Attachments                    | 图片、文本、Markdown和文本批注已接；PDF独立origin、表格／HTML／音视频及图片批注仍未接，不归入零成本按钮接线                               |
| 账户、外观、管理、关于     | SettingsPanel → SettingsPage对应组件                                                              | 已接；更新日志没有 Loom 发布内容来源，不能展示 Raft 发布记录冒充 Loom                                                                     |
| 语言与区域                 | SettingsPanel.LanguageRegionSection → translationStore及locale                                    | 整页包含服务端翻译偏好、时区和时间格式；不能以单个locale开关冒充整页对接。UI语言子项可拆为后续窄切片，当前未接                            |
| 通知设置                   | NotificationsSection → WebPushNotificationsCard／desktop native bridge；protocol `client-push.ts` | 后端有Push协议，但当前LAN／Tailnet HTTP非安全上下文不满足浏览器Push条件；已接的系统通知中心与OS推送是两项能力，不能混称                   |
| 用量、轨迹、启停           | InstanceInspector → RunUsageDialog／InstanceTrajectory／RuntimeControl                            | 已接既有实例路径；不扩写为全工作区用量总览已完成                                                                                          |
| Fork／Side／频道记忆       | 后端已有，正式 UI 尚未有等价完整替代                                                              | Loom专属接线，排在消息回应／转发之后；保留console直到能力被产品UI覆盖，不能提前删除                                                       |

此次结论纠正“低难度已全部接完”的笼统判断：消息回应／转发仍有明确前后端对应关系。应先完成这两个纵向切片，再进入 Fork／Side；不启动新一轮后端设计或成本实验。

## 字体来源与实现

保留官方源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`、原许可及owner复用授权；没有修改官方文件。`raft-ui` 0.5.64 的 MIT primitives 与字体 SIL OFL 分别保留。

使用该包原 Google Fonts 请求取得 Geist、Geist Mono、Hanken Grotesk、Inter 的 WOFF2子集及原 `Raft Quote Glyphs` 文件，共23份不同资源，约454KiB原始字体数据。来源URL、SHA256和四份OFL见 `frontends/raft/loom/fonts`。不采用旧Space Grotesk冒充当前官方字体。

`local-fonts.ts` 在原Tailwind PostCSS处理后，仅替换Google Fonts import和字体资源URL；保留官方主题变量、font-face权重／display／unicode-range。Vite正常生成同源哈希资源，无运行时外网依赖，无构建时下载，不放宽CSP。不识别的新Google字体依赖拒绝构建。

## 验证与边界

新增测试先因缺少实现失败；随后验证官方变量尾段不变、字族／范围保留、资源摘要、URL替换及未知依赖拒绝。首次生产构建遇到Tailwind将 `@import url(...)` 规范化为 `@import "..."`，补充这一形式的回归并修正；没有削弱未知来源拒绝。最终正式构建、前端类型及104项源码检查通过。

隔离Core、无provider执行，在1440×1000和390×844、DPR1通过真实主题卡点击切换Elegant／Brutal；浏览器FontFaceSet验证四字体及引号字形成功加载，零外部字体请求、零页面异常、无横向溢出。没有运行全后端或完整浏览器套件。正式重启与新页面证据见[部署记录](../evo/evidence/2026-10-16-local-fonts/summary.json)。中文仍按官方字体栈使用系统回退，未自造中文字体；不声称所有操作系统像素完全一致。

## 后续 owner 裁定

2026-10-16 owner 明确不需要对外分享。上述转发候选不再作为分享项目推进；内部消息转发与公开分享不同，但当前也不因既有接口而启用。下一批先接表情回应，之后推进 Loom 专属能力。
