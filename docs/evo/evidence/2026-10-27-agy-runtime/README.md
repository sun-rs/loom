# AGY 原生运行时接入

Owner 要求：顶层仍是 Loom，仅学习已有项目的 AGY 调用经验，接入运行时管理。当前 `agy 1.4.8` 使用用户已登录的本机账号；不安装 CLI、不修改账号或全局配置。

## 边界与实现

- `local-cli-runtime-spec` / inventory 发现 `agy`；`agy models` 的制表符目录生成精确模型绑定。effort 从原生 ID 后缀取得，只发布对应档位，未伪造 Fast。
- 新增 `agy-print-json/v1` adapter 和 `agy-cli/v1` catalog。Kernel、Room/Inbox/Activation、Role/Instance、Worker 业务所有者不变。UI 沿用现有官方运行时表单，无新页面。
- 使用普通 `agy -p ... --output-format stream-json --model ... --effort ...`，`--conversation` 精确续接，不使用 `--continue` 猜测会话。cwd 是既有 Channel home，附加目录由 Host 传入 `--add-dir`。初次输入携带冻结角色指令，续轮仅增量 wake/协议通知，不重复灌入 standing prompt。
- Host 通过原生 init 的模型/会话和本轮 `user_input` 事件登记投递证据。`SUCCESS` result、完整流、退出状态、当前 launch/session/turn 的私有 proof 一致后，沿既有 `WorkerFinalOutput` 发布到唯一目标。不从旧日志捞答案，不以退出码 0 代替完成证据。未知流、替换 session、截断、取消均不能发布。
- `step_update.usage` 按 conversation/step 去重计量。真实续轮证实 `result.usage` 为累计会话账，绝不能再次相加；`num_turns` 及 `duration_seconds` 也不能当作本轮统计。输入口径包含缓存读取，输出不重复叠加 thinking。上下文占用未知；子代理/压缩覆盖未证明时留用量缺口。

## 参考来源与采用程度

参考 [Multica antigravity.go](https://github.com/multica-ai/multica/blob/2de89ff46e87ec42171e2273e1adb75178654887/server/pkg/agent/antigravity.go)，文件 SHA256 `1433ba4c26c5a8549595187b40ba1d084b4d820fc9bff2b95d12508050a9143e`；仓库许可证为带附加条件的 Multica License，并非无条件 Apache。仅学习 CLI 调用/流语义；没有复制 Go 源码、日志恢复或其上层调度。新增 Node driver/parser 为 Loom 实现，生命周期和最终回复路径复用本仓库 Pi adapter 的既有实现。当前 CLI `--help` 优先于旧上游注释（例如 print timeout 0 的行为）。

## 验收

- TDD 首次发现/流/driver 均先失败，再通过；另补附加目录与缺失 result 的用量缺口回归。
- 34 项定向 adapter/注册/协议/bootstrap 检查、另一次 26 项目录/inventory 检查通过（有重叠，不合并成 60 个独立测试）。根类型检查和产品前端类型/构建通过。
- 原生探针：最初一次错误 cwd 导致额外找文件，保留失败设置事实；随后正确 cwd 的 driver 读文件、同 session 无工具复述、同 session 附加目录读取均通过。见 `summary.json`。
- 正式服务已出现 Antigravity 运行时及 13 个实际目录条目。创建 `Gemini AGY` Role 和独立的 `AGY 运行时验收` Channel。真实三轮（含 daemon 最终重启后）各一条回复、各一个 completed Activation、exit 0、同一个 provider session；用量逐步骤入账而非累计重复账。
- 正式桌面频道显示回复、Role 资料和编辑运行时表单核对通过，见截图。390×844 模拟视口等待切换动画稳定后，配置弹层 x=0、width=390、height≈759.6，无横向越界；不等于真机验收。浏览器自动化首个 Chrome connector 不可用，改用独立 Playwright 浏览器；初次截图等待不足捕获了旧角色/加载中，重做等待当前角色与 combobox 后取得正确截图，不把加载态误判为通过。
- 服务先检查无活动执行、SQLite 及状态备份核验，再仅重启 `com.loom.evo`，保持数据 home。第一次重启前校验脚本因 SQLite null-prototype 与 JSON 对象原型不同中止，业务值未变；改为序列化值精确比较后重启，无强杀。

## 保留限制

Fast、native Fork/Side、SEA 打包均不可用；只实测 Gemini 3.8 Flash Low，其他目录模型不宣称实测通过。自动记忆禁用尚未证明，因此本批不是效率 gate，也不声明 token 倍率或订阅成本。输入 argv 上限 128 KiB，超限明确失败，不截断。停止经过假 CLI 进程验收，未额外消耗真实模型验证取消；真机移动端没有新增验收结论。AGY 自身模型质量、后台会话策略与原生调度工具并不成为 Loom 的业务调度所有者。
