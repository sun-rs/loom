# Pi 1.4.0 的本批隔离与计量前置

检查本机 `@earendil-works/pi-coding-agent@1.4.0` 的 `docs/cli.md`、
`docs/settings.md`、`dist/cli/args.js`、`dist/main.js` 和
`dist/core/settings-manager.js`。CLI参数仍传入资源加载器：
`--no-extensions --no-skills --no-context-files --no-prompt-templates --no-mcp`。
两臂还使用 `--offline --no-approve`，显式 provider/model/thinking/session。
没有宣称任意用户插件自动记忆都已审计；本批排除这些注入源，正常session历史和
原生压缩保留。产品core工具未禁用。不是OS级全局文件拒读。

新版默认 `cacheWarming=streaming`，会产生额外用量；本批复制配置到私有测试
home，明确两臂 `cacheWarming=off`，不编辑用户日常配置，不遗漏该已知潜在来源。
这不是日常插件/默认缓存保温配置的成本结论。

付费前用已安装的实际CLI连接本地合成服务：首轮/同session续接通过
`inspectPiTurn` 和 `piUsageFrames`；随后原生三轮＋完整隔离daemon三轮通过，
每次100input/10output，Kernel与原生流逐项一致。增加累计一致性断言后再验一次。
这些是免费接口/统计验证，不是模型质量证据。

本批明确启用产品已有 `LOOM_PI_NATIVE_FINAL_TRIAL=1`，不改变正式launchd配置。
只读问题、model/effort、会话连续性、usage去重由现有产品解析器及本批外层校验验证。
执行器与原始证据位于私有review目录，摘要保留文件哈希。未知/不完整usage中止，
不填零、不改原记录、不通过补跑凑齐样本。
