# 频道交接与原生子代理等待的边界

源码 `57299f8a`，修复真实任务中Codex两次调用原生wait_agent等待频道同伴的指引缺口。共用 `withWorkerMcpGuidance` 增加简短说明：向频道同伴发表请求后结束当前轮，Loom在后续唤醒中交付回复；原生子代理等待工具只用于自身原生子代理，不能等待频道成员。

该共用入口由Codex warm、Claude stream及Kimi ACP的MCP通路使用，仅在Host MCP启用时添加。不改变native-final、公开tool schema、final参数、业务调度、实例lane或原生子代理许可；其他通路不宣称因本次改动全部覆盖。没有硬拦截wait工具，也没有把正常内部子代理一并禁用。

新增指引断言先失败后通过；MCP指引、stdio入口和native-final回归共8项通过，类型检查通过。范围只证明指引文本、开关和已有通路，不证明模型必然遵循。每轮短指引增加输入，未测定净节省；没有新增付费调用。

正式服务空闲检查、状态备份核验、Room事件数与逐Room序号一致检查后，对精确launchd服务SIGTERM正常重启。新进程及真实网页频道列表、正文和composer正常；Web产物不变。详见[部署及验收记录](summary.json)。
