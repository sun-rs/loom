# 计算机最新布局与 Role 恢复（2026-10-22）

## 根因：Git 源码与官网发布不是同一版本

本日公开源码 HEAD 仍为 `db5e399f017d584e49597e3a28757645d6807893`。该版本 sidebar 范围是180–320、默认240；当前官网 [app-shell-EHP4m3Or.js](https://app.raft.build/assets/app-shell-EHP4m3Or.js) 发布注册表已是200–400、默认240。

Loom原来正确引用了旧源码参数，却不等于对齐当前官网。这是右侧详情无法通过拖动压得更窄的直接原因。已逐字提取官方注册表到 `frontends/raft/upstream/published-2026-10-22/panel-layout.ts`，完整资源及声明SHA256在同目录manifest；既有共享panelBounds桥接只采用该注册表的sidebar，其余thread参数保持原锁定来源。没有改动旧官方原件；没有推断或自创数值。

实际验证：1440桌面拖动到400；780宽度下右侧实例区的动作组换到标题下方；390手机无横向溢出。各侧栏共享同一边界，所以Settings等门禁也改为读取同一官方边界入口，不另存旧数值。

当前官网 [MachineDetailPanel-DxO99SzZ.js](https://app.raft.build/assets/MachineDetailPanel-DxO99SzZ.js) 仍然采用：

- 正文`flex-1 overflow-y-auto bg-layer-canvas`，没有stable scrollbar gutter。
- 检测运行时`flex items-center gap-1.5 flex-wrap`，没有固定宽度上限；版本是usage chip参数，而不是标签正文字符串。
- 实例区SectionHeader `mb-3 flex-wrap gap-y-2`；动作组 `flex items-center gap-1.5`，由标题行整体换行。

本批移除上一批的stable gutter；运行时标签只显示运行时名称/不可用状态，版本和执行路径移到原生Tooltip。回到原生滚动意味着经典滚动条仍可占用系统决定的宽度；不能承诺任意边界宽度下永不换行。本次在受测视口展开列表时标签区高度保持稳定。

npm当前最新`@botiverse/raft-ui`为0.21.0（2026-10-22），Loom仍锁定0.10.5。0.21包含消息节奏与组件尺寸别名等变化；本批只采用已核实的页面参数，**未宣称整个依赖升级至0.21或全站对齐最新官网**。下次升级要比较实际发布物、包版本与Git源码三者，不能只用Git HEAD作为官网最新的证据。

## Role与计算机的真实绑定

Role不是运行实体，但其runtimeOfferId和exactBindingIds来自具体Host发布的目录；当前没有跨Host自动重新解析与放置能力。因此现有执行配置具备机器约束，创建表单已把计算机放在首行。本机MVP只展示当前计算机，不虚构远端选项，也不 silently substitute runtime/model。

## 已删除区与恢复

Owner要求的已删除区默认折叠；`role.list`新增可选deletedRoles，只通过原Human管理权限读取保留Role定义。包括没有实例的已删除Role；不再用某个实例当前名字反推Role名称。

新增`role.restore`，沿用Human control-room-manager权限、expectedRoleRevisionId、basedOnRoomSeq、事务与幂等键。恢复原Role ID、生成新不可变Revision并清除deleted_at；名称采用原有NFKC/case唯一性校验，冲突时要求用户输入新名称。既有实例的名称、配置、会话、Inbox与执行不变；同名重建Role不合并。操作记录为role.restored事件。没有数据库版本迁移。

UI使用原生SidebarSectionDisclosure及角色行，恢复使用原生确认/表单组合。默认显示原名称；拒绝可修改再提交；未知结果只能通过原key核实。管理写入同时注册路由阻断，不能以丢弃草稿绕过pending/unknown写入。

## 仍欠缺：完整运行时表单与启动能力

这不是已完成项。现有RoleEditor使用官方Dialog/StableField/Select等组件，但没有完整复用官方RuntimeConfigFields或runtime-form数据模型。

已核对官方：

- `CreateAgentDialog.tsx`将envVarEntries传给RuntimeConfigFields，envVarsMode=advanced，再编码到创建配置。
- `packages/daemon/src/drivers/claudeLaunch.ts` Fast通过`--settings`传入`{fastMode:true}`。
- `packages/daemon/src/drivers/codex.ts` Fast通过app-server的threadParams.serviceTier="fast"，并读取运行时发布的tier能力。

Loom缺口：RoleConfiguration没有environment快照字段；RuntimeGuide已有环境变量是另一个配置所有者，不能冒充Role字段。Codex exec适配器明确拒绝非默认serviceTier，Claude启动链也没有对应Fast映射。

后续应按单条纵向路径补齐：Protocol配置 → 不可变Role/实例快照 → Host启动环境与tier能力 → 官方RuntimeConfigFields的薄适配 → 用假运行器验证实际参数、保留/采用修订及保护环境变量。真实Fast付费效果须另行记录，不能用勾选成功证明。无需引入Raft账户/云server或第三方MCP管理。
