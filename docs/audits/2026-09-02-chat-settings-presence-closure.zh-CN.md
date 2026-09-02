# Chat / Settings / Presence 十二项收口审计（2026-09-02）

## 裁决

用户本批列出的十二项缺陷均已落到明确 owner，并完成代码、自动门禁和正式
`4173` 新构建中的真实浏览器复核。这里的“完成”只指本报告列出的合同，不扩大为
RAH OS 全站、Raft 所有权限组合或所有服务端错误态的 100% 等同。

实现遵循两个边界：视觉与交互先取当前 Raft 登录后页面和 bundle；状态、资料、未读
和文件字节仍由 RAH OS 本地 daemon/canonical store 负责，不复制 Raft 的中央服务器
拓扑，也不把浏览器缓存当业务事实。

## 证据方法

- 上游：登录后的 `app.raft.build` Chat、Search、Account、Appearance、Notifications、
  Server profile 页面，结合当前入口 chunk、设置 chunk 和真实 DOM/computed style。
- 本地：正式 `http://127.0.0.1:4173/` 新构建只读操作；上传、hover、拖动和
  390×844 用隔离状态的 Firefox 产品门禁，未调用真实付费 Provider。
- 判定：静态 DOM 只能证明显示事实；hover 延迟、Escape、滚动按钮、分栏拖动、刷新
  恢复和上传必须由真实指针/键盘/浏览器结果证明；canonical 状态另以 kernel/daemon
  测试证明。

## 十二项逐项矩阵

|   # | Raft 事实与预期                                                                                                          | RAH OS 单一 owner / 修复                                                                                                               | 双边结果                                                                                                    |
| --: | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
|   1 | Composer focus 不产生第二层黑框，外容器边框始终稳定                                                                      | `apps/web/src/product.css` 的 `.composer-box textarea:focus-visible` 只移除浏览器 outline/box-shadow，不改 Composer 外框               | 正式 Room 中点击、键盘聚焦实测均无内框                                                                      |
|   2 | 普通 input/textarea 的 focus 是右、下方 `4px` 位移硬阴影，并非左、上加粗                                                 | 共享 `.input:focus` / `.input-wrap:focus-within` 使用 `--shadow-m`，不在各表单复制 focus CSS                                           | Account 与 Channel settings 实测为右/下阴影；截图和 computed style 一致                                     |
|   3 | Channel settings 抽屉标题栏为 54px，与 Chat 头部分割协议齐平                                                             | `.rah-channel-settings-header` 唯一持有 54px 高度；抽屉不再复用 62px Settings 页头                                                     | 正式页左右分割线齐平，切换窄屏仍使用同一组件                                                                |
|   4 | Search 的 `Esc` 是键盘提示文字，不是可点击按钮；Escape 返回                                                              | `components/global-discovery.tsx` 用普通文本节点展示 `Esc`，document key handler 负责关闭                                              | DOM 角色不是 button；真实按 Escape 回到 Chat                                                                |
|   5 | Chat 有本地日历日分隔、成员加入系统提示、离底后按钮；消息三按钮在黑框 hover 后以约 150ms opacity 出现                    | `chat-timeline-presentation.ts`、`conversation-panes.tsx`、`message-social.css`；成员提示来自 `membership.added`，不伪造 Message       | 正式历史出现“昨天/今天”和成员加入提示；Home 后出现“回到底部”；真实指针量得 opacity `0 → 过渡值 → 1`         |
|   6 | 可用且未工作 Agent 保持绿色在线/ready；DM 左下显示最近活动提示，不因前端计时器快速变灰                                   | `packages/kernel/src/agent-presence.ts` 产出 canonical presence，`attention-presentation.ts` 与 `.rah-direct-activity-footer` 只投影   | 正式四个 DM 稳定显示绿色在线；DM 底部显示头像、状态点和最近活动                                             |
|   7 | ready/idle 为绿点；thinking/working 为黄点并仅在工作时呼吸；offline 为灰点                                               | `agent-status-dot.tsx`、`attention-presentation.ts`、kernel presence query；pulse 只允许 thinking/working                              | 无用户输入时不再持续黄闪；完成后回绿，Host/Agent 不可用才灰                                                 |
|   8 | Account 可改本地适用的姓名/头像；语言与区域不属于本地中央账户；Appearance 实时状态开关必须真实生效                       | `settings-pages.tsx` + `principal-profile.ts` + profile image store；语言 Tab 已移除；实时状态是设备偏好并控制共享 presence 展示       | 姓名和上传可保存/刷新；Appearance 开关真实改变状态点；不伪造邮箱、密码、翻译账户能力                        |
|   9 | Appearance 字号预览包含头像、姓名、时间、mention、频道和 inline code，不是单行阉割样例                                   | `.rah-settings-message-preview` 和 `SettingsAppearancePage` 复刻官方信息层级，字号切换作用于真实预览                                   | 正式 Small/Medium/Large 点击和预览层级实测通过                                                              |
|  10 | Notifications 和 Server profile 共用 62px Settings 骨架、36px 黄色页头图标、粉色选中态和硬阴影卡片；资料头像是真文件上传 | `settings-surface.tsx`、`settings-pages.tsx`、`profile-image-avatar.tsx`；daemon profile image store 负责字节，Web Push owner 负责通知 | 正式页无巨大图标/黄色选中错误；Server profile 有上传、名称、只读 slug，无多余“标识”行；删除中央服务器未伪造 |
|  11 | 左上角显示当前 Computer 名称首字母；已上传 Workspace/服务器头像时显示图片                                                | `workspace-identity.tsx` 优先 `computerName` 取首字母，canonical `avatarKey` 存在时显示认证图片                                        | 正式 Computer `Mac-Studio` 显示 `M`；隔离上传后图片即时并刷新保持                                           |
|  12 | Activity 粉点由未读 frontier 决定，不用短 timeout 自动清除；即便正在 Activity 页也保持至明确处理                         | `packages/kernel/src/human-activity.ts` 的 `read_seq/done_seq` 和 `workspace-navigation.tsx` 的 `keepDotWhileActive`                   | 粉点只随 canonical read/done 变化；轮询、presence 变动和普通页面切换不会自行抹掉                            |

## 头像上传后端合同

Account 与 Server profile 的上传不是前端 data URL：认证的
`PUT /v3/client/profile-images/content` 把原始字节交给 daemon。daemon 流式限制
5 MiB，核对声明 MIME 与 PNG/JPEG/GIF/WebP magic bytes，以 SHA-256 内容寻址，目录
0700、文件 0600，同内容去重；未知、格式错和过大返回 typed 4xx。上传只生成不可变
`avatarKey`，用户保存资料后才绑定 Human/Workspace canonical profile。

## 自动与真实浏览器门禁

- `npm run check`：退出码 0；package 733 项中 731 通过、2 项 opt-in 跳过，Web
  151/151，Raft parity regression 34/34。
- `npm run typecheck`、`npm run format:check`、`npm run build:web:workbench`、
  `git diff --check`：通过；build 只有既存 large-chunk 警告。
- Firefox：桌面 1440×1000 和移动端 390×844 通过；真实 pointer 验证消息按钮
  150ms、真实文件 buffer 验证上传/渲染、侧栏和资料页验证默认/最小/最大拖动。
- 正式浏览器：Account、Appearance、Notifications、Server profile、Search Escape、
  Channel drawer、DM presence/底部提示、跨日分隔、回到底部和切 DM 自动关闭旧 Agent
  资料页均已复核。
- Web Push：向已注册的本机设备走真实认证测试接口，结果 `delivered: 1`。当前 in-app
  浏览器权限为 `denied`，Chrome 本次没有运行，因此没有把“看到 Chrome/macOS 横幅”
  记作完成；这里只证明服务端投递链和设置页合同。

## 正式发布状态与保留边界

正式服务已在完成构建、等待 Activation/RunAttempt 归零后重启；重启前备份位于
`/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-012522`。
重启后两份 SQLite `quick_check` 均为 `ok`，没有未完成 Activation 或 RunAttempt。

仍不得据此宣称“全部 Raft 页面完美适配”：Raft 中央用户名/邮箱/密码/社交登录、组织
邀请、套餐、账单、中央应用商店、服务器删除和自动翻译不属于 RAH OS 当前产品；
Chrome/macOS 可见横幅和 iOS 仍需对应终端人工设备证据；本报告以外的页面、权限组合、
异常态继续按行为登记逐项验收。
