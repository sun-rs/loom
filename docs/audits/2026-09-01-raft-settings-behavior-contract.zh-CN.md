# Raft Settings → RAH OS 行为合同审计（2026-09-01）

## 审计结论

设置页的顶层几何、选中态、页头图标尺寸、卡片和按钮协议已按 Raft 当前登录后
页面统一实现，套餐与账单、应用两个中央商业 Tab 已移除。这里不能据此宣称全部
Tab 功能 1:1：RAH OS 已完成的是真实本地能力映射；Human 与 Workspace 名称/头像、
外观及通知已接入 canonical owner，部分管理能力仍有差距，中央账户、社交登录、
中央邀请、自动翻译和组织计费则属于架构上不适用或未被产品采纳。

## 证据与方法

- 登录后页面：`https://app.raft.build/s/hakasemac/settings/*`
- 线上入口：`index-BoAC7nSE.js`
- Settings 组件：`SettingsPanel-BriyEW4E.js`
- 授权保存的前端证据：`docs/evidence/raft-web-20260831-current/`
- Raft 当前源码入口函数 `Ac`：统一页头 `xi`、
  `data-slock-settings-tab`、`data-testid=settings-panel-header`；内容容器
  `px-5 py-4`。
- Raft 账户与服务器资料页的真实 DOM 都使用 64×64、2px 黑框的上传 label；hover
  是 `bg-black/40` 与 `opacity 150ms`，隐藏 input 精确接受
  `image/jpeg,image/png,image/gif,image/webp`。RAH OS 使用同一交互合同，不再用
  头像预设下拉框替代上传。
- 在同为 1280×720 的登录后 Raft 和正式 RAH OS 页面逐项点击全部保留 Tab，读取
  DOM、计算样式、SVG `outerHTML`、URL 变化和表单可用状态。
- 本地真实交互：12/24 小时制、消息字号和 Workspace 通知静音均完成保存与刷新
  恢复；Workspace 通知静音会抑制该空间 Web Push，但不删除 Activity 记录。
- Firefox 产品门禁通过桌面 1440×1000 和移动端 390×844；两者均无横向溢出且
  浏览器错误为零。

## 顶层几何与视觉合同

| 项目       | Raft 真实 DOM/计算样式                   | RAH OS 合同                           |
| ---------- | ---------------------------------------- | ------------------------------------- |
| 主导航轨   | 64px                                     | 64px，共用现有 rail                   |
| 设置侧栏   | 240px（x=64..304）                       | `--rah-settings-sidebar-width: 240px` |
| 页头       | 62px                                     | `--rah-settings-header-height: 62px`  |
| 页头图标   | 36×36 容器，2px 黑框，18px glyph，黄色底 | `SettingsPageHeader` 唯一所有者       |
| 侧栏行     | 222×32，左右 8px 外边距                  | 32px 高、`padding: 4px 8px`           |
| 选中态     | `#FE7DA8`、2px 黑框、2px 硬阴影          | `var(--pink)`、`var(--shadow-s)`      |
| 内容内边距 | 20px 水平、16px 垂直                     | `.rah-settings-scroll`                |
| 卡片       | 2px 黑框、2px 硬阴影、16px padding       | `.rah-settings-card`                  |

旧实现的 320px 自定义侧栏、黄色选中态和无尺寸约束的通知 SVG 已被这一套共享骨架
替代。左上角主导航、设置侧栏和内容页头只由顶层 grid 与两个固定宽度 token 定位，
各 Tab 不再自行拼边框。

## 源码级图标核对

最初版本有五处使用了“相似 Lucide 图标”，这也是仅看截图复刻造成的偏差。以下
图标已从登录后 Raft Settings 按钮的真实 SVG 路径修正，不再凭名称猜测：

| 位置       | Raft 实际图标        | 已修正的本地 symbol      |
| ---------- | -------------------- | ------------------------ |
| 外观       | `Type`               | `raft-icon-type`         |
| 服务器资料 | `Building2`          | `raft-icon-server`       |
| 管理       | `Shield`（无 check） | `raft-icon-shield-check` |
| 关于       | `BadgeInfo`          | `raft-icon-info`         |
| 文档       | `BookOpenText`       | `raft-icon-book-open`    |

语言与区域的 `Languages` 原本即一致。精确路径与哈希由
`packages/ui-tokens/test/ui-tokens.test.ts` 固定，避免以后再次替换成相似图标。

## 逐 Tab 行为映射与真实完成度

| Raft Tab   | 官方点击结果/数据                                                  | RAH OS 当前真实能力                                             | 判定                                                        |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 账户       | 头像、显示名、用户名、邮箱、社交账号、密码、退出                   | Human 显示名与 JPEG/PNG/GIF/WebP 头像上传、保存和消息投影       | 适用的本地资料完成；中央用户名/邮箱/社交/密码/退出不适用    |
| 语言与区域 | 语言、翻译模式、时区、12/24 小时制                                 | 固定本机区域语义；该 Tab 已移除                                 | 不复制中央翻译/区域账户偏好                                 |
| 外观       | 消息字号、实时 Agent 活动                                          | 两项均为真实设备偏好并作用于页面                                | 适用能力完成                                                |
| 通知       | Push 开关、测试、服务器静音、保存                                  | 真实 Web Push 订阅/测试、Workspace 静音持久化与服务端过滤、诊断 | 前后端完成；仍需有授权的真实系统通知终端验收                |
| 服务器资料 | 头像、名称、slug、删除                                             | 名称与头像走 canonical Workspace 更新；slug 只读                | 本地适用资料完成；删除服务器不适用/未伪造                   |
| 管理       | owners/admins、角色、系统频道、邀请、入组协议、onboarding Agent 等 | 展示本机 owner、Agent 数及管理边界                              | 显著功能差距；中央邀请/组织入组部分不适用                   |
| MCP 服务器 | 列表、新增、推荐、凭据、工具、Agent 分配                           | 既有 typed managed MCP daemon/canonical mutation                | 代码能力存在；正式空间当前无 executor，无法完成新增双边验收 |
| 局域网设备 | Raft 无此 Tab                                                      | RAH OS 本地安全扩展，显示“本地”标签                             | 产品扩展，不计 Raft 偏差                                    |
| 关于       | 版本、移动端、Workspace                                            | 本地版本、PWA、Workspace                                        | 本地语义映射完成                                            |
| 文档       | 打开 `docs.raft.build`                                             | 产品内说明 `docs/README.md`                                     | 尚非等效文档站入口                                          |
| 反馈       | 中央反馈列表与新反馈                                               | 复制本地健康诊断入口                                            | 非 1:1；中央反馈不适用                                      |
| 更新日志   | 内部 `/s/:server/release-notes`                                    | query deep link 的本地静态更新页                                | 路由完成；内容不是 Raft feed                                |
| 套餐与账单 | 中央订阅/收费                                                      | 产品无关                                                        | 已移除                                                      |
| 应用       | Raft 中央应用商店                                                  | 产品无关                                                        | 已移除                                                      |

## 通知的后端语义

- 默认尝试申请浏览器通知权限；权限已拒绝时不会循环打扰用户。
- 订阅、退订和测试使用真实 Service Worker / Web Push 路径，不用页面内 toast
  冒充系统通知。
- “静音此协作空间”由 daemon 持久化到该 Human 的通知偏好；内核在投递边界过滤
  Workspace 的 Web Push，Room、DM、Task 等 Activity 仍保留，恢复后继续投递新
  事件。
- 本次 in-app 浏览器权限状态为 `denied`；Codex 的 Chrome 控制连接不可用，因此
  没有把真实 Chrome/Firefox 系统横幅冒充为已验收。Firefox 390×844 门禁验证的
  是页面、Service Worker 允许启动和零错误，不等于人工看到系统横幅。

## 头像上传的前后端语义

- Web 只负责选择文件与预览；原始字节经认证的
  `PUT /v3/client/profile-images/content` 进入 daemon 的 owner-private media store。
- daemon 流式计数并限制 5 MiB，校验 MIME 与 PNG/JPEG/GIF/WebP magic bytes，使用
  SHA-256 内容寻址、0600 文件和 0700 目录；同内容去重，未知/格式错误/过大分别返回
  typed 4xx，不把用户输入错误伪装成 500。
- 上传成功只产生不可变 `avatarKey`；点击“保存资料”后才把 key 绑定到 Human 或
  Workspace canonical profile。读取同样要求认证，不提供下载 disposition。
- Human 头像投影到账户页与 Room 消息；Workspace 头像投影到设置页和左上角切换入口。
  无头像时左上角显示当前 Computer/Workspace 名称的首字母。

## 点击、关闭与键盘合同

- 设置行点击更新 `surface=settings&settingsSection=<typed-id>`，使用 history
  `pushState`；浏览器前进/后退由 `popstate` 恢复对应 Tab。
- 设置页不是浮层，没有 Escape 关闭语义；回到聊天由 rail 导航负责。
- Raft `SettingsPanel-BriyEW4E.js` 的 `Ac` 组件把当前页交给统一 PanelHeader，并以
  `onMobileBack` 返回设置根页。RAH OS 同样在 390×844 使用“设置目录 → 当前页 →
  返回设置目录”，不再显示自编的横向 Tab；数据与表单仍复用桌面组件，没有第二条
  功能路径。
- 表单按钮只在本机 canonical 能力真实可用时启用。Workspace 名称修改在写入前
  读取 control Room baseline，避免静默覆盖并发修改。
- 设备偏好写入 `localStorage`；Room/Task/Agent canonical 数据不进入浏览器持久化
  缓存。

## 本批额外发现：Firefox CSP

设置移动端门禁最初暴露出每次加载都会出现的 CSP 错误。根因是入口文件先静态导入
Zod，再调用 `z.config({ jitless: true })`，因此 Zod 在配置之前已用
`Function("")` 探测 JIT。现在入口先写入共享 `__zod_globalConfig.jitless`，然后才
动态加载协议和应用模块；未放宽 `script-src 'self'`，Firefox 门禁已恢复零错误。

## 下一批适用缺口优先级

1. 管理页中适用于本地空间的 owner/admin、系统 Room 可见性与 onboarding Agent
   配置；排除中央邀请和组织收费语义。
2. 用具备 MCP executor 的隔离空间完成“新增—配置—分配—删除”的真实浏览器闭环。
3. 独立文档入口和本地反馈记录；优先级低于聊天室、Agent、任务与通知主链。
