# Role 运行时表单复用（2026-10-22）

Owner 本轮要求运行时选择和配置复用官方完整表单。已去掉 RoleEditor 中分别拼装的运行时、模型、推理强度选择器，创建和编辑统一交给官方 RuntimeFormV2Fields。Loom 的 RoleRuntimeFields 仅把 Host 发布的绑定目录映射为官方表单字段、选项和提交值；联动由官方 applyRuntimeFormV2Change 执行。保留 Loom 精确绑定要求，不接受目录外臆造模型。

## 来源与边界

官方仓库 https://github.com/botiverse/raft-source ，revision db5e399f017d584e49597e3a28757645d6807893。
原始 RuntimeConfigFields.tsx、SHA256、FSL 许可证保存在 frontends/raft/upstream/published-2026-10-22/runtime-form。
该目录名沿用本日证据目录；本文件明确来自 Git source release，不是网站 bundle。

RuntimeFormV2Fields、RuntimeDisclosureToggle、RuntimeSelectControl、RuntimeEnvVarsField、RuntimeFormV2StringMapField 五个函数逐字采用原始源码；定向测试锁定函数一致性。更新了此前兼容端口里仍然手写的高级折叠按钮。其余依赖继续使用已记录的官方兼容端口及 raft-ui 0.10.5，不能称为完整官网最新版依赖闭包或全站原样复制。

## 环境变量业务链路

环境变量属于 Role 配置与不可变修订；实例创建/显式采用新修订时复制到 AgentDefinitionRevision。修改 Role 不改变既有实例。普通重启保留当前快照，显式采用才更新。Daemon 从本次 Activation 的定义修订取值，覆盖全局/per-agent 的同名用户变量；凭据/平台通信 lease 和执行身份栅栏仍由原 owner 处理。

复用 RuntimeLaunchEnvironmentSchema（名称、数量、容量、NUL 及保护键校验），运行边界再次解析。没有另外写全局配置，没有新增数据库表或迁移。高级环境变量不用于覆写 PATH、HOME、RAH_、LOOM_ 等受保护项。

## Fast 链路（本日后续批）

同一个官方 boolean 卡片显示快速模式；不另造开关。Host 读取原生模型能力，Role 保存 modelIntent.serviceTier，实例仍冻结原修订；修改 Role 不影响既有实例。

- Codex 0.163.0 原生目录实际把 Fast 发布为 priority；也保留目录明确发布 fast 的兼容路径。普通 exec/resume 通过 service_tier 配置传入，app-server 冷/暖请求传入原生 serviceTier。关闭或未选时显式 default，不继承用户全局 Fast。
- Claude 2.1.303 的无推理 initialize 返回 supportsFastMode；只有 true 的绑定提供 Fast。冷/暖进程通过 --settings 的 fastMode 布尔值设置，普通模式明确 false，不写用户配置文件。暖进程拒绝档位不同的后续 turn。
- 不支持的绑定保存/启动拒绝；通用 argv 适配器缺少可执行档位映射时拒绝，不能静默忽略。该泛型路径不宣称支持 Claude Fast，正式 Claude 专用 driver 负责翻译。
- 原生能力目录/配置解析探测没有发起模型请求。自动化使用隔离假 CLI 证明传参、同 session 恢复和保存链路；未做付费 Fast 推理，也不保证账户额度、实际提速或提供商最终应用档位。

[Codex service_tier 配置](https://learn.chatgpt.com/docs/config-file/config-reference)；[Claude Fast 文档](https://code.claude.com/docs/en/fast-mode)。Claude 在不支持模型上开启 Fast 可能自动切换模型，因此必须以当前精确绑定的 supportsFastMode 为门槛，不能仅按 CLI 名字显示。

浏览器发现官方表单 boolean 在当前固定组件依赖下引用了空 Field label，补充 aria-label={field.label}；此为非视觉兼容补丁，已记录 rui-v6-ports，未改变官方尺寸或重写控件。

## 定向证据

- 原始函数一致性与创建/编辑共用渲染器检查。
- Role 环境变量冻结、受保护键拒绝；实例重启 keep/adopt 测试。
- Daemon 真实环境 lease 到隔离 Node 子进程，验证收到实例快照值而非全局同名值；没有调用付费模型。
- 隔离浏览器 1440/390：计算机/Agent 共用创建表单，高级变量保存，默认不创建实例、单独确认入频道、失败保留 Role、已删除恢复。
- 根/前端类型检查、生产构建、UI contract。各项运行结果以本轮执行输出为准，不代替真机或付费模型证明。
