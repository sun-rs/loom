# 手机复杂表单采用官方 Sheet（2026-10-27）

产品提交 `7f967956`，`@botiverse/raft-ui@0.35.1` 版本不变。

## 源码与采用边界

官方包 `DialogSheetContent`、`DialogCommit`（`raft-ui/wip`）原样调用；没有复制或重写其布局、Portal、焦点、visualViewport、错误滚入视区逻辑。
`MobileFormDialog.tsx` 是多字段表单场景的薄组合：Dialog + DialogSheetContent + DialogHeader/Title/Close + DialogBody；唯一业务参数是标题、busy和关闭回调。多字段表单不允许点击遮罩退出，关闭由原草稿/写入状态决定。

原生行为参考 https://github.com/botiverse/mobile 的 `eff04722b5904a0d001115d90d3ec49d59fb4f03`，`compose/designsystem/src/commonMain/kotlin/build/raft/designsystem/components/RaftDialogSheet.kt`；原始文件已加入不可变reference、哈希和原LICENSE/NOTICE，source-diff无漂移。

| 场景 | 采用组件 | Loom边界 | 验证 |
| --- | --- | --- | --- |
| 新建角色 | Sheet + Commit | Role保存/可选实例添加仍是原独立写入；草稿确认保留 | 手机真实页面、运行时picker、关闭/继续/放弃 |
| 新建实例 | Sheet + Commit | 角色/频道选择，原ManagementClient | 手机真实页面、禁用提交、焦点返回 |
| 编辑记忆 | Sheet + Commit | 修订校验、未知写入核实保留 | 手机与桌面真实页面，未执行保存 |

RoleEditor/MemoryEditor的表单使用稳定 `useId`；DialogCommit明确绑定form，移到顶部后仍提交同一表单。提交按钮的busy/disabled条件沿用原路径。
简单确认仍使用原Dialog/AlertDialog，不将所有弹窗一律改成Sheet。运行时编辑原生成容器及其他长列表选择尚未全部迁移，不宣称全站完成。

## 验证证据

- 4项React DOM：手机顶部提交绑定原form、busy不可关闭/提交、桌面footer提交、visualViewport从844缩到480再恢复时面板随之变化。
- 10项相关Form/Role/runtime源码测试通过；typecheck、正式build通过。没有全盘后端或付费测试。
- 正式服务390×844：面板759.59高（90dvh），顶部56高；确认草稿退出、运行时选择、实例关闭后焦点回新建实例按钮。截图create-role.png、create-instance.png、memory.png。
- 1440×1000：同一记忆表单448×505居中，保存回到footer，输入内容未丢失。console error为0。
- 安全备份2数据库/325文件后重启，20业务表、推送配置不变。没有创建角色、实例或修改记忆；临时角色草稿已放弃。

键盘证据是DOM viewport事件模拟，不是物理iOS输入法/触摸验收。下一批继续运行时配置和长列表弹窗分类，然后与手机实际键盘、安全区及导航手势核对。
