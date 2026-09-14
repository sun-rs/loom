# 聊天侧栏分组与会话归属

## 来源与范围

Raft 发布包 `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本机审阅副本位于 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。

- pretty 133605：FD 标题 `mt-3 mb-1 h-6`。补回包装层造成失效的 12px 分组间距。
- 133645–133735：Nat/Xx/Jx 使用 sortable、vertical list strategy、transform/transition；行拖动透明度 0.12、分组 0.6，标题是分组拖动手柄。
- 135910–135940：分组顺序独立保存，移动会话清除旧归属。
- 136533：已保存选中态粉底、黑框、固定阴影。
- 136730–136747：自定义分区为空时显示“暂无会话”。
- 133284–133378 / 137412–137431：新建与编辑分区复用 Z8 / pat 表情选择器。沿用已有源代码对齐弹窗。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`，
`packages/views/layout/app-sidebar.tsx:179` 同样使用 dnd-kit sortable；其置顶列表不是完整的混合频道/私信分区模型。
本次为结构移植与 RAH 接线，不是逐字复制。dnd-kit 使用 MIT 包依赖，保留包内许可。

## 单一所有者与行为

HumanSidebar 仍是 Human × Workspace 侧栏偏好的持久所有者；协议新增可选迁移字段
`sectionOrder`，旧数据读取默认空列表，前端补齐系统组与新自定义组。顺序通过原有版本栅栏命令保存。
会话移动同时清除 pinned 与其他 customSections 的归属；channelOrder/dmOrder 仅是排序记录。
频道只能回频道组，私信只能回私信组，两者均可移入置顶与自定义分区。
删除自定义分区只移除分区偏好，会话回到对应系统组；不删除 Room。

分组右键支持新建；自定义分区另有重命名/更换图标与删除。频道、私信、置顶保留系统身份。
按用户要求不提供隐藏空分区。自定义分区保持手动顺序，现有系统组的手动/最近/A–Z 选项保留。
拖动动画使用共享 sortable，写入仍等待已确认偏好；失败保留原确认快照并显示原有错误。

## 验证

`apps/web/test/sidebar-order.test.ts` 先复现自定义移动缺失，再验证单一归属、混合移动、类型边界与无效分区。
协议测试覆盖旧字段迁移、重复分组拒绝和单字段 patch；Kernel 测试覆盖持久化、版本栅栏、鉴权与幂等。
`scripts/test-sidebar-groups-browser.mjs` 用真实鼠标验证跨区移动、组间与组内顺序、刷新、空分区、重命名、删除归位和已保存选中边框；390×844 验证弹窗。
既有 `test-chat-context-browser.mjs` 验证表情、保存失败草稿和右键会话菜单回归。

此证据是源码对照与隔离浏览器验证，不宣称线上 Raft 同条件双边验收。

完成结果：`npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建通过。
新增浏览器场景在 Chromium、Firefox 通过，既有聊天右键场景通过。
正式状态已备份后由 guarded restart 重启，冻结资源标识
`1dce8d2c4a8de43cd55943d4d08ce4fe13723c02f0e218cc0edcdc59c750107c`。
重启后在 localhost、LAN、Tailnet 三个正式入口的新浏览器页面验证了资源标识、间距、系统菜单、表情、现有空分区 111 与编辑、已保存边框及窄屏弹窗。
真实拖动写入验证仅使用隔离状态，未改动用户的分区归属。
