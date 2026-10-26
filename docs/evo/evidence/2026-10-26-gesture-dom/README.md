# 手势 DOM 集成检查（2026-10-26）

运行 `npm run test:official-web:gesture-dom`。需要已安装 `frontends/raft` 的锁定依赖。测试位于独立 `loom-tests`，不修改官方原文、不进入产品构建，也不加载真实后端或调用模型。

此前的原生函数/事件测试保留。本层使用真实 React、原生生成的 Ht 手势hook、Loom撤销hook及raft-ui ToastProvider，覆盖原生异步收尾导致行卸载后，官方toast仍能取消/提交正确操作的整条组件生命周期。

4项通过。几何、media及ResizeObserver为隔离夹具，触摸事件为合成PointerEvent；不能将其称为真机、像素或原生浏览器手势验收。完整ActivityMessageRow的次级动作仍由已有接线/假接口测试与正式页面无回归检查覆盖。

产品实现和部署版本未变，本批只有测试与证据，不重启服务。下一步应是实际手机触屏验收，而不是继续增加无新证据的生产补丁。
