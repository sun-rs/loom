# Agent 目录断网恢复（2026-09-13）

用户截图包含 `NetworkError when attempting to fetch resource` 和 Agent 0。正式 daemon 持续监听 loopback/LAN/Tailnet；新 Chromium 页面能读原 Agent，因此没有证据表明 Agent 数据被删除。

在正式 Firefox 页面仅模拟浏览器断网，恢复后人类目录错误消失，但 loopback/LAN 的 Agent 行仍缺失。原因是 App 的 `agent.list` 是一次性 effect，请求失败即清空目录，没有自身重试；`workspace.human.list` 则用共享 `useReconciledQuery` 定期恢复。短暂断网能留下只恢复人类的页面。用户截图那次底层网络失败的具体原因仍需设备、浏览器与地址证据，不能由本次复现推断为 Surge 或 Tailnet 故障。

修复复用现有共享查询所有者：`agent.list` 同样按可见性轮询，失败不冒充空目录，scope/client 切换或权限不可用仍清理/隔离旧投影。Agent 管理后的现有本地回写与刷新保留，后端权限、身份和状态不变。不新增浏览器持久缓存，不改 Provider 或重写 Room 恢复状态机。本次属于本地恢复缺陷修复，不声称复制了 Raft 后端或做过在线双边验收。

`test-agent-directory-recovery-browser.mjs` 在临时 Kernel/假 Provider 中阻断第一次目录请求；解除阻断且不刷新/不点击后仍无法看到 Agent，先复现失败，再验证自动恢复及后续失败期间保留已知目录。没有执行付费 CLI。

完整 `npm run check` 的核心套件通过；Web 的一条旧源码断言仍要求被替换的一次性 effect 依赖数组。改为核对共享查询的 controlRoom 身份与刷新输入后，407 项 Web 测试及余下 parity、formal-browser-policy、bilateral-captures 均通过。未重复无变化的核心套件。格式、diff、正式构建及定向浏览器回归通过。

确认工作台空闲并完成备份后安全重启原持久状态。正式构建 `b99f236cec3c680c66b8db86214cd886a7940c3007d852e82a614375e1bda7e0` 的新 Firefox 页面在 loopback、本地 LAN、Tailnet 三个入口均通过真实离线/恢复模拟：网络错误出现后无需刷新或重试按钮，错误自动消失，原四个 Agent 与 Human 行完整恢复。已检查恢复截图。只切换测试浏览器网络，没有修改 Mac 网络、Surge 或 Agent 配置；此结果不代表用户设备的外网链路已查明。
