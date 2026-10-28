# 源码部署原生回复默认化

Owner 授权“开始第一项”：把已有实际 CLI 证据支持的回复路径变成新安装默认，避免有效选择仅留在本机 launchd 变量里。此次是 daemon 配置兼容收口，不重做 Kernel 调度，不新增付费实验。

## 实现

`reply-transport-policy.ts` 是唯一产品选择点，按入口、打包形式和既有显式变量返回 Worker / structured final / native-final 三者之一。源码 Node 默认推广 warm Codex、Claude、OpenCode 及 cold Kimi、Pi；AGY 原样保留。冷 Codex exec、未知入口、SEA、远端接线和低层构造器不随之推广。Claude 默认选其支持的 warm 入口；显式冷配置及准确关闭变量仍有效，预热默认不变。完整矩阵和回滚见[运行说明](../../native-final-defaults.zh-CN.md)。

不改 Role、实例、模型、effort、session generation 或数据库。实际回复仍须原生终态、匹配的当前投递登记及原身份；保留 Worker 业务回退、取消、新鲜度、幂等和不明结果不重发规则。已有 session 读取同一 ProviderSessionStore；不能因更换传输静默创建新 session。

## 定向免费验证

先在旧默认上确认两个预期失败：没有开关时 Claude 缺少 warm 入口、Pi 工厂收到 `nativeFinalText=false`。实现后通过以下检查，详见[汇总](summary.json)及 `test-logs/`：

| 检查                                                             | 通过数 | 证明范围                                                               |
| ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| 默认选择、实际工厂参数、严格开关、SEA/未知入口、基准显式隔离     | 9      | 无变量新安装、关闭与兼容组合；工厂在该测试中被捕获，不冒称调用实际 CLI |
| daemon warm 配置、全关闭及保留清理池                             | 5      | 默认 Claude、独立 opt-out、schema 配置及并发上限                       |
| Host 原生回复、回退、凭据、取消、Human 新鲜度、自动交回、Pi 驱动 | 64     | 真实 Kernel / Host / HTTP / 驱动，Provider 进程为假 CLI                |
| Codex / OpenCode warm 原生回归                                   | 28     | final 证据、传输切换同 session、截断 Worker 回退及正常后续             |
| ProviderSessionStore                                             | 10     | 跨配置 / Host 重启保持绑定，丢失或歧义拒绝，generation 隔离            |
| Claude idle 崩溃 / 回收续接                                      | 2      | 假进程重新启动并 resume 原 session                                     |
| 长任务与跨频道实验入口                                           | 17     | 默认臂开关清零、继承隔离、计划模式不启动 Provider                      |

共135项通过；后端类型检查、变更格式及 diff 检查通过。归档的测试日志仅规范行尾空白，原始输出保留在本机同名 review 目录；不改测试结果或 Provider 原流。没有运行全套无关测试，没有新增真实模型调用，也没有新成本或全模型质量结论。代表性的旧真实证据由[运行说明](../../native-final-defaults.zh-CN.md#基准与验收)链接，失败和未知计量不补判。

### 同步发现的旧实验指纹夹具遗漏

第一次运行17项入口测试，16项通过，一项旧 smoke 指纹失败。隔离导出修改前 `da03de57` 的 scripts/packages，单独复现同一个断言；先前不完整隔离目录的准备错误保留在本机 review 日志，不当作产品运行失败。

根因为 `ead15510` 给两臂各补六个 `NATIVE_FINAL_TRIAL=0`，但 smoke 预期值仍是旧的 `79958d6b…`。当前完整 identity 为 `961da547…`；从 identity 只删除上述六个字段可精确还原旧 hash，其他任务、模型、原生子代理政策均未变。只修正测试预期并增加子代理 / 全关闭断言；实际 runner 和历史付费证据未重写。[字段证明](baseline-identity-correction.json)，[旧失败](test-logs/benchmark-isolation-tests.log)，[父版本复现](test-logs/parent-smoke-identity-red.log)，[修正后](test-logs/benchmark-isolation-fixed-tests.log)。

## 正式部署

部署按空闲检查、在线备份校验、准确服务优雅停止和重新启动执行；保留原不可变 Web 快照，不为后端选择修改重建前端。本机仅删除四个与新默认相同的冗余 `=1`，其他显式配置保留。具体 PID、备份、文件摘要及账本比较记在 `deployment.json`；真实浏览器页面验收单独记在 `browser-verification.json`。这些收据在完成后写入，不以健康探针代替页面或 CLI 工作验收。
