# WORKER-REAP-2：做完的 worker 永远不释放

用户 2026-11-27："问题很严重，为什么 loom project 没有主动释放已完成的不用的 worker？"
实况（pilot-cell @a55fd9cc）：15 个 worker 长期停在 idle-warm（最久约 9 小时），`loom state` 显示 retention.idleSince=null、remainingMs=null，TTL 计时从未开始；`loom release` 一律被拒："Worker has pending deliveries or its final result has no native delivery receipt"。多数是旧 release 下启动、热升级后接管的；不少 lastResultTag=BLOCKED。pilot-2 则因长期跑在不含 WORKER-REAP-1 的分支 release 上，积了 35 个。

## 要做
1. 找根因：为什么最终结果拿不到原生投递回执就永远不进入空闲计时；热升级接管的旧 worker 为什么没有 idleSince。写 RED 复现（含热升级接管、BLOCKED 结果、回执缺失三种）。
2. 修复：最终结果一旦被父级（Leader）确认读到（或 loomd 已把结果落盘并通知），就开始空闲计时；回执缺失超过一个上限（例如 10 分钟）时，结果标为"未确认"上报 Leader，但计时照常开始，TTL 到期照常下线（原生会话保留可 resume）。热升级接管时补齐 idleSince。
3. 兜底：worker 处于 idle/idle-warm 超过 TTL 的 2 倍仍未下线，向 Leader 与 Super 发显式通知（不静默）。Status 页显示"超时未释放"计数。
4. 测试先行；全量 `npm test`、`npm run lint` 通过。分支 infra/worker-reap-2，工作树 /Users/sun/Code/repos/loom-worker-reap-2，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。不往 pilot 终端输入，不读凭据。
