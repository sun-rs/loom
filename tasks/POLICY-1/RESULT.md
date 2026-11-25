# POLICY-1 交付记录

- 示例策略新增 `roles.leader.maxActiveWorkers`、角色模型和 effort 指引、长提示缓存 TTL 偏好及 `keepAlive: false`。加载时校验新字段。Worker 启动默认上限为 3，可配置为 1–5。CLI 在 loomd 串行启动处理内按同项目、同父地址统计未退出的 Worker，席位满时返回 `worker-capacity`。
- Loom skill 明确 Leader 仅由事件唤醒、每次一个决定。Auditor 默认静默自助取证，合入前单次复核，红色事实只读核查，可复现的阻断缺陷才中断。每次介入只发一条汇总结论，两轮仍阻断时报 Super 裁决重设计。升级沿用 daemon 支持的 `blocking-disagreement`。
- `loom cost --project DIR` 输出角色 token 汇总、缓存读写、Worker 原始 token 占比、Leader 唤醒数和各 Worker 轮次验收后的模型调用数。唤醒以首轮之后可观察的根轮启动为代理，验收以证据卡规则识别的通过结果为准，模型调用按原生用量时间戳计数。无相应证据时返回 `null`。试运行文档记录 Worker／Leader／Auditor 的模型支出目标 80%／15%／5%。

## 验证

- `node --test cli/loom.test.mjs` 的 7 项测试通过，覆盖默认及硬上限、父地址与项目隔离、退出释放席位、策略校验和三家提供方的缓存与验收用量。
- 通过真实 daemon RPC 和模拟 TUI 终端并发启动 4 名 Worker，3 名获准，1 名被拒。停止一名后可启动替补。验证使用隔离 HOME 及显式绝对模型 CLI 路径。

STATUS: done
