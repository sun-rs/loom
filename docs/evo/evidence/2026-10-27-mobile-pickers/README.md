# 运行时与长列表手机面板、首页标题（2026-10-27）

当前部署 `eeccaf3d`（面板提交 `2cb426db`）。沿用 @botiverse/raft-ui@0.35.1；原生参考Mobile eff04722不变，未修改官方原文件或手写generated产物。

- RoleProfile运行时编辑从历史生成Modal组合改为现行官方DialogSheetContent薄组合；containerRef直接指向官方容器，运行时/模型下拉层仍使用原portal与状态。DialogCommit已有form绑定，桌面与手机不创建第二套表单。保留脏草稿确认、busy与旧绑定不可用提示。
- 文件选择直接使用DialogSheetContent、DialogCommit、DialogFooterNote：手机顶部引用、正文末尾上传，桌面仍在footer；关闭使用DialogClose。旧512px手机高度覆盖不再覆盖data-sheet，树目录授权/取消加载/上传检测不变。
- AddInstanceDialog兼容入口同样采用Sheet；本次从频道设置进入的实际入口是ChannelMembers原生全屏搜索选择页，保持不变。不要把这个实际入口验收冒充兼容入口的点击验收。
- owner本轮更正：移动首页标题Loom，桌面聊天不改；任务统计恢复到标题下方。动态原本已经上下排列，实际测量确认，无需再另写布局。

## 验证

先复现containerRef未透传、运行时仍用旧容器、文件无Sheet/Commit、首页名称和任务横排的定向失败，再修改。
5项React DOM、18项相关source tests、typecheck、正式build通过；无付费或全后端测试。
正式390×844检查运行时及其选择浮层、文件入口、频道设置成员列表；1440×1000文件选择器448×512居中，footer包含上传/取消/引用；无console error/warn。
任务标题y=5.25、说明y=25.25，二者x=16；动态标题y=5.5、说明y=25.5，二者x=16。首页Loom标题可见。截图tasks.png、runtime.png、files.png。
安全备份2数据库/325文件，20业务表及推送状态不变。只浏览，没有修改角色、添加实例、上传或发送消息。

## 限制与后续

这一批不等于全站所有弹窗迁移完。低频权限编辑、用量等弹窗仍需按“多字段/长列表用Sheet、简单确认留Dialog”分类。真机iOS软键盘、安全区与侧滑仍未实测；现有keyboard证据来自上一批DOM visualViewport模拟。
