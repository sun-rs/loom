# 任务原生拖动与 Side 隔离验收

产品提交 `cf6f57a4`。本轮固定Web1.21.34资源，直接使用已安装0.35.1官方TaskDnd组件，不再由任务页自己组合Pointer/Touch传感器。卡片/列组合由生成器结构移植，非原封不动的最新版完整页面。来源登记在 `published-2026-10-26/manifest.json#taskDnd`。

## 行为与证据

- 键盘空格拾起、方向键移列、空格放下：真实临时Kernel保存todo→in_progress；成功播报后焦点回到同一任务，刷新仍保持新状态。
- Escape取消：保留原状态，焦点回原卡片。
- 普通编辑者投影禁止todo→in_review：官方空列显示“不能从待办移至待确认”，中文读屏提示不能放置；放下不移动、不播报成功。
- 390×844：看板横向滚动限定在内部390px容器，document宽度390；列表切换通过。
- Side使用同一产品构建、真实临时Kernel，fake native-copy创建；桌面宽度400→键盘416→鼠标496→双击400。手机单栏390px，“返回频道”关闭Side并返回源对话。

[禁止转换截图](task-blocked-fixture.png)、[成功移动截图](task-success-fixture.png)、[Side桌面](side-desktop-fixture.png)、[Side手机](side-mobile-fixture.png)均明确为隔离测试证据，不是用户产品数据。可用 `node --experimental-strip-types scripts/official-web/task-side134-fixture.mjs` 启动临时环境，Ctrl-C清理；该脚本不执行浏览器自动化和真实CLI。第二次测试的全局列表只覆写canManageAnyTask以呈现普通编辑者规则，后端合法操作仍走真实Kernel；不是多Human系统验收。

16项定向测试、受影响类型检查、产品构建、格式与diff检查通过。类型/权限/未知结果仍由原有board owner处理，不新增队列或业务状态。TaskDnd只负责拖动展示；同列拖放不提交、不实现用户未请求的任务重排。

安全备份后重启正式服务；20项业务表、推送状态未变化。正式页仅作展示回归，没有拖动或修改用户任务，没有启动付费模型。详见 [summary.json](summary.json)。

## 保留边界

手机浏览器尺寸模拟不等于真机触摸验收，长按与滚动冲突还需物理设备。当前正式库没有Side样本，本批补的是隔离真实Kernel前端链路，不宣称重新验收各CLI原生复制。整站其他未核对表面与新增概览/批量换模型不因此自动完成。
