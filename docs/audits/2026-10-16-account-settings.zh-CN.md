# 官方个人资料接线

代码 `c3c27a3`。本批接通账户页的显示名、只读用户名和头像上传，不新增后端协议。

## 来源与采用范围

- 固定源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`；FSL-1.1-ALv2 notices 保留。最新锚点 v1.21.16 的 `https://app.raft.build/assets/app-shell-L7litFx-.js`，SHA256 `80ccb22db7a9c7afdb5d0f0c9f99802251423ed578f7a3fca4524b5063664d88`，格式化副本约148830行包含相同账户资料字段/原生组合。没有经过登录的官网视觉验收。
- 组合链：SettingsPanel / AccountSection → SettingsProfileCard → FormField / Input / PrefixedInput / Button；头像 Tooltip / 上传 label → AvatarSlot(profile-tile) → GravatarAvatar → raft-ui Avatar / AvatarFallback。
- `account-settings-adaptation.ts` 从官方 AccountSection 选择资料卡 JSX，保留标题、用户名、输入框、原生头像 hover、按钮和排版；省略 Loom 不支持的邮箱/验证、密码、社交绑定和退出区块。不是把完整云账户服务搬进来。
- 本地调整：输入最大长度120，未决与冲突时禁用编辑；缺省显示名使用既有 handle。所有原始官方源码文件保持不变。
- 官方 GravatarAvatar 只认 Raft 上传图片路径；构建别名将它的上传地址 guard 换为 Loom 根路径 `/v3/client/profile-images/content/upload_<type>_<hash>`，不接受任意外站、协议相对地址、query 或 data URL；原生渲染/样式/失败回退保留。内置非上传 avatarKey 不生成伪上传 URL。

## 保存与未知结果

本地 controller `AccountSettings.tsx` 读取 `principal.me`；名称保存走 `principal.update`，附带 expectedProfile（显示名、头像、简介）防止旧表单覆盖其他编辑。保留已有头像/简介，不开放额外非官方字段。

名称和头像操作共用一个既有 WriteIntentSlot。头像使用 SDK profileImages.upload 后将返回的 avatarKey/uploadIntentId 交给 principal.update；5 MB 和四类 MIME 的本地检查与现有协议一致，文件内容验证仍在服务端。头像更新使用已保存的名称，不把未提交名称草稿顺便写入；草稿仍留在表单。

该接口没有 Room 型幂等键，所以页面不提供通用重发按钮。未知结果时锁定编辑和导航，显示“读取当前资料”：用户选择后成功读回才放弃核实原提交，以当前资料替换草稿，不重复保存/上传，也不把“当前值一致”当作本次请求成功证明。读取失败保留未决状态。明确冲突拒绝同样要求重新读取后再改。

上传成功但绑定失败的对象按已有上传意图/媒体生命周期处理；本批未新建清理机制。丢上传响应可能留下待清理对象，不能自动重试。页面硬刷新不恢复内存 intent；仍保留既有离开提示。

## 验证

- TDD：未接入前找不到官方显示名输入框；头像上传成功但官方 URL guard 不接纳 Loom 路径，浏览器等待图片失败，已保留失败日志；guard 接线后通过。
- 最初图片等待未设短超时，手动终止隔离门禁后设置10秒上限，复现到同一问题；不是付费 CLI 超时，不计为通过。
- 89项来源/接线检查、受影响类型检查、`npm run build:web:workbench`、格式/diff 通过；既有 chunk/dynamic-import 警告未扩大验收。
- `LOOM_BROWSER_SLICE=account-settings`，1440×1000 / 390×844，DPR1：只读用户名；改名提交成功后丢响应；读取恢复且没有第二次写；另一编辑改名后的 CAS 拒绝；头像真实上传和显示；头像不保存名称草稿；刷新后头像和已保存名称保持；无页面异常/溢出。
- 正式服务检查活动工作、备份并优雅重启；真实双尺寸页面只输入草稿/恢复原值、头像 hover 与截图检查，不上传、不保存。principal.me 与 room.list 前后相同。正式用户资料更新没有被当作测试数据。
- 本批不覆盖全应用每处 Human 头像/名称的即时刷新；现有消息等投影是否展示头像是后续接线问题。没有跑全后端、全浏览器或 paid gate；没有重测全部图片清理生命周期。

[证据摘要](../evo/evidence/2026-10-16-account-settings/summary.json)。本地原始日志/截图：`/Users/sun/.loom/reviews/2026-10-16-account-settings/`。
