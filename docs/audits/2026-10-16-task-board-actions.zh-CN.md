# 任务拖动、卡片状态菜单与关于页组合交付

组合代码 `f8d6823`，最终部署含键盘收尾修正 `23c3b39`。本轮按 owner 要求集中完成多项接线，统一验证、部署；后端协议未改。

## 官方来源

固定源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2 notices 保留。最新锚点 v1.21.16 release bundle `https://app.raft.build/assets/app-shell-L7litFx-.js`，SHA256 `80ccb22db7a9c7afdb5d0f0c9f99802251423ed578f7a3fca4524b5063664d88`。授权本地格式化副本约179607行是 PointerSensor(distance 5) / TouchSensor(delay 200, tolerance 5)，179892行附近为 drop→状态提交；156494行为 About 版本区块。没有宣称经过登录的官网视觉验收。

完整组合链：

- TasksPanel → DndContext / sensors → DroppableColumn → DraggableTaskWrapper → TaskCard → raft-ui TaskBoardColumn / TaskCard 系列。保留原生320px列宽、列高亮、拖动 transform/z-index/opacity、触摸/鼠标阈值与折叠。
- TaskSection / DroppableColumn → TaskCard → InlineBadgeEditor → 原生状态选项与关闭行为；按钮、菜单尺寸、位置、颜色保持。未新建卡片菜单。
- SettingsPanel / AboutSection → SectionHeader / SurfaceListItem。只选择版本区块，产品名换为 Loom，版本由现有 WEB_BUILD_IDENTITY 提供；不搬入 Raft 手机下载、云工作区或反馈服务。

## 已实现

1. 频道与全局看板支持拖到状态列；拖出目标或落回同一状态不提交。可拖卡片和可放列使用已有权限与 protocol 转换选项；不支持的动作不会接到伪成功。
2. 频道及全局列表/看板上的卡片状态徽标可直接打开官方菜单，提交同一任务状态接口；在没有 Loom 上下文的其他原生卡片宿主中仍只读。
3. 成功后以服务端返回的 Task 替换同 ID 行，保留其他行、已有分页窗口和滚动容器；不为一次状态变更重新加载整页。未知结果保留原卡片并锁定操作/路由，以既有 slot 核实原请求。拒绝保留原状态，提供重新读取；读回不伪造成功。
4. “设置 → 关于”显示官方版本卡，当前构建如未注入正式发布版本，就准确显示开发版本，不把 Raft 的版本当成 Loom 版本。

## 所有权与差异

`TaskBoardClient` 是窄前端 facade：频道页借用既有 ChannelTaskClient 的 Human WriteIntentSlot/RoomSession；全局页只持有一个 slot，按任务所属 Room 建立 causal session。没有第二个业务任务状态或执行队列。`TaskBoardActions` 只持有展示/写入反馈，Kernel 继续负责权限、状态、执行取消和幂等。ChannelTasks 的既有路由所有者覆盖同 slot 的任务状态写入，避免新建与状态操作互相覆盖或未知时卸载。

官方现在允许普通成员改状态；Loom 后端 `requireHumanTaskManager` 要求创建者或频道管理者。本地保留该更严格权限，不能因移植 UI 扩权。状态菜单使用原生 label/order，但可选集由 protocol 的 taskWorkflowTransitionOptions 提供。同 UID 的执行隔离等既有限制不因本批变化。

`task-adaptation.ts` 的构建适配只替换 TaskCard store/controller 和 DraggableTaskWrapper 权限输入，原始官方文件不改。原生 InlineBadgeEditor 仅自带外部鼠标按下关闭，本地卡片宿主另接 Escape 关闭／焦点返回，以满足产品键盘契约；这是17行本地接线，不声称该段是官方直接复用。DndContext 事件/sensors 是官方结构移植；关于页选择源码区块；其余是本地 SDK 接线，不称为整页逐字复制。

## 验证

- TDD：最初 fixture 用了错误的中文列名，修正后用上一已部署不可变构建重跑，确认旧页拖动不能提交/不能进入核实；关于页未接入前找不到版本卡。
- 首次核实测试有时点击被吞：定位到原生 dnd-kit 在 drag end 后50ms才移除 document click capture。fixture 在松手后等待75ms；产品手势不改。另一次完成状态检查早于响应，改为等实际响应后断言。保留初始核实超时与中间失败记录，不作为通过。
- Node strip-only 不支持测试导入类的参数属性写法，改用普通字段声明，未改变业务语义。关于页构建适配首次未接到 Vite transform，构建拒绝缺失导出；修正后最终构建通过。
- 第一轮正式截图发现 Escape 后菜单仍在，先加入独立重现断言（红），再接关闭回调与焦点返回；桌面/手机回归通过。修正后重新备份、重启并在真实页面断言菜单已卸载且焦点回到触发按钮，保留 `before-escape-*` 回执。
- 最终92项来源/接线检查通过；受影响类型检查、`npm run build:web:workbench`、格式和 diff 通过。仅有既有 chunk/dynamic-import 警告。
- task-board 窄 gate：1440×1000 鼠标拖动、390×844 Chrome CDP 真实触摸事件长按拖动，DPR1；实际 Core 状态转换、首次已提交后丢响应、原 key/payload/basis 核实、频道列表修改至待确认、全局列表修改至完成通过。
- about 窄 gate：同双尺寸版本卡与注入 build identity 一致，无溢出/页面异常。
- 因频道 slot 路由范围受影响，仅补跑 task-create 窄回归：双尺寸多标题提交、未知暂停并精确核实、403保留剩余项、导航阻止通过。未跑全浏览器/全后端/付费CLI。
- 正式服务活动检查、备份2库/318文件、优雅重启后，18张业务表关键投影保持不变；新进程/端口/构建核对通过。
- 正式双尺寸页面读取9项已有任务，原生状态菜单打开/Escape退出、截图检查通过；About 版本匹配。禁止 task/workspace/profile 写入；room.list 和 task.global.list 前后相同。真实用户 Task 没有被拖动或改状态；写入验收只在隔离 Core。

## 保留边界

- 不支持列内手工排序：本次官方拖动语义是跨列改状态，不新增排序接口。
- 不声称覆盖任务批量改状态、审核/描述编辑或所有筛选器；全局列表仍50条/次、最多500条的既有边界。
- 本批触摸验收为 Chromium CDP，非物理 iOS Safari；键盘拖动不额外发明官方未提供的 sensor。
- 没有新建跨设备任务实时订阅；本页自身已确认的状态修改局部更新，其他来源的变化仍依现有刷新路径。
- 未持久化 unknown 句柄；硬刷新不等于完成核实。

[结构化证据](../evo/evidence/2026-10-16-task-board-actions/summary.json)。原始日志/正式页截图/重启回执：`/Users/sun/.loom/reviews/2026-10-16-task-board-actions/`。
