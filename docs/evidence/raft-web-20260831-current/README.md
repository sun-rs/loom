# Raft 官方 Web 发布产物（2026-08-31）

来源：已登录官方 `https://app.raft.build/` 页面 DOM 中的入口脚本及其引用。

- 当前入口：`https://app.raft.build/assets/index-BoAC7nSE.js`。
- 其余文件均从 `https://app.raft.build/assets/<本目录文件名>` 下载，仅归档发布的 JavaScript；没有保存账号、cookie、浏览器存储或 API 业务响应。
- 23 个 JS 的哈希和依赖候选见 [机器索引](../raft-interaction-candidates-20260831-current.json)。当前图中仍有13个引用 JS 未归档，不能宣称完整源码包。
- 这些是发布 bundle，不是假称原始 TypeScript/React 仓库或服务端源码。仅用于本项目授权分析；不由正式产品导入或执行，不复制到 Web public/build。
- 保持字节原样，不格式化。语义解释、适配裁决和浏览器结果见 [合同](../../product/raft-frontend-local-contract.zh-CN.md)。

重建候选索引（输出必须是新文件）：

```sh
node scripts/inspect-raft-interactions.mjs docs/evidence/raft-web-20260831-current /tmp/raft-interactions-new.json
```

自动索引只是审计入口；必须人工追踪请求、参数、状态分支和异步回调，不能将候选数量当作行为覆盖率。
