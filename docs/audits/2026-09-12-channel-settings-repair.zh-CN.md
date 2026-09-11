# 频道设置：开关呈现与操作收口

## 证据与范围

2026-09-12，Chrome 实景 `app.raft.build/s/hakasemac`，频道
`parity-busy-rework-0911`。检查频道设置、静音开关开/关、公开确认并取消；
恢复原静音值，未实际更改官方频道可见性、发送消息或启动模型。

参考 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，
SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。
定位：`channel-settings-preferences`、`channel-settings-description`、`ig`、
`Mtt`、`Ntt`、`Uqe`、`/notification-settings`。

官方 DOM 实测：操作按钮白色（删除为 rgb(249,114,100)）、高度 48px、
图标 14px；描述框至按钮上沿 18.5px。开关 36×20、14px 方块、
选中位移 16px；仅禁用才变灰。archive/log-out/circle-stop SVG 路径从
官方 DOM 逐字采用，加入内部图标资源；其余是 RAH 原组件的适配，不称为复制组件。

## 原因与修复

RAH 的 `sidebar.patch` 已保存置顶和静音，但开关 CSS 缺少 checked 状态，
并永久 opacity=.45，导致成功操作看起来无效。补全开关选中/禁用/焦点状态；
去掉描述框容器固定高度，固定可测的尾部间距。删除用户不保留的
“通知所有新消息”界面入口，保留历史偏好字段兼容。

可见性改为整行按钮与确认弹窗，仍通过既有 `onUpdate`/Room 服务写入。
取消不写入，失败保持弹窗并可重试。操作按可见性、归档、退出、停止、删除排序，
白底常规操作、珊瑚红删除。移除最后所有者说明的可见文案，权限拒绝保持有效。
本轮没有新增多 Human 权限或成员选择体系。

## 静音语义与验证边界

官方 `Mtt` 把静音的普通未读从 loud badge 转为 quiet count；`Ntt`
控制静音图标，直接提及仍是独立提示。静音不是仅关闭操作系统弹窗，
也不能承诺所有粉红提示都保持。官方本轮未制造新消息验证服务端推送。
本地已有 Kernel 测试覆盖普通 Activity 被静音、准确提及保留、侧栏安静计数保留，
以及普通通知 opt-in 与静音的关系。本轮没有重写这些后台规则。

## 验证

`scripts/test-channel-settings-browser.mjs` 先在旧构建失败：开关已选中但
opacity=.45。修复后验证置顶/静音重载保持、可见性取消/失败重试/成功重载、
按钮颜色、18.5px 间距、390×844 无横向溢出；桌面 1440×900 截图人工复核。
Kernel sidebar/discovery 21 项通过。正式实例重启与构建信息以本轮交付为准。

全仓检查仍受在途 UI spec ratchet 未提交和 matched-rules 旧 CSS hash 阻塞；
不放宽约束、不将其冒充全仓通过。格式检查另有在途 ui-catalog.html 与
build-ui-catalog.test.mjs 问题，未覆盖其他工作的文件。
