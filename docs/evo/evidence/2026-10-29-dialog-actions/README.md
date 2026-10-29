# 弹窗操作顺序核查与高清头像调查

## 结论与修改

官方 `@botiverse/raft-ui@0.52.0` 的 DialogFooter/AlertDialogFooter 使用
`stacked-actions`：DOM 为次操作取消在前、主操作保存／确认／删除在后。
横排为取消在左、主操作在右；宽度不足时原生 `flex-col-reverse` 将主操作放在上面。
官方 AgentProfileEditDialog、保留的 ConfirmDialog 源码也是这个顺序。
移动端 DialogSheet 表单隐藏 footer，DialogCommit 自动进入顶栏右侧，关闭在左。
这些行为都交给官方组件；没有增加 Loom 的按钮排序 CSS。

发现并修复两处真实反序：`RoleFieldEditor`、`MemoryEditor`。
计算机资料的行内保存／取消不属于弹窗；其顺序与原生 MachineDetailPanel 相同，保留。
未修改官方不可变源码、生成文件、按钮样式或后台业务。

## 覆盖与验证

`audit-dialog-actions.mjs` 递归扫描 Loom 适配层和保留 Web TSX，记录原生 footer、
可识别的同层取消／主操作，分开记录非弹窗操作行。保留源码中也有未接线页面，
因此扫描文件／行数不能解释为已上线功能数；动态组件封装不能仅靠 AST 证明完整运行时覆盖。
共享 ConfirmDialog 的破坏性确认、Role 运行时表单、新增实例、文件选择、频道 Drawer、
创建任务、恢复、脏稿及单主操作表单均保留其原生组合。

- 先以两处反序重现失败，交换 DOM 后测试通过；前后清单见 JSON。
- 8 项定向源码／场景检查、5 项UI所有权检查、Loom 类型检查及产品构建通过。
- 临时 Core/Fake 目录，1440×1000、390×844：两处弹窗按钮位置正确、取消可关闭；
  原生窄 footer 将保存置于取消上方，手机表单使用左关闭／右提交。
- Role 两个铅笔的焦点、返回焦点及双字段单次修订同时通过。
- 不启动付费 Provider，不创建正式环境测试 Role、实例或记忆；不跑全系统长验收。

截图是模拟尺寸，不能当作实体手机验证；扫描与构建也不是全站最新 UI 对齐认证。
部署与真实页面核验记录在后续 `deployment.json`、`formal-page.json`。

## 高清头像

调查结论、实际取样尺寸及来源见 [avatar-research.md](avatar-research.md) 和
[avatar-samples.json](avatar-samples.json)。**本批只完成搜索、取样和方案，尚未替换产品图库。**
样图下载到临时目录检查，没有把第三方素材打包进产品或改写已有头像 key。
