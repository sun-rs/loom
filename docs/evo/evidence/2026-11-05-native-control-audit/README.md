# 六家 CLI 持续机器接口审查

2026-11-05。**六家都有持续机器接口可用；Codex、Claude、OpenCode 已在 Loom 使用，Pi／Kimi 的原生持续控制探针通过，Agy 新增 ACP 已握手但未进行认证后的生成。** 本批只做隔离研究，正式驱动、服务、账户、Role／实例配置均未改变。没有执行 Claude Code，没有付费或远端模型调用。

RPC／ACP 可以只是一个长期子进程，通过 stdin／stdout 通信，不要求新增网络服务器或让 Herdr 成为上层框架。Loom 继续拥有原有业务账本与执行围栏。

## 当前调用与候选

| CLI             | Loom 当前默认                 | 当前原生持续接口                     | 本批证据与建议                                                                                          |
| --------------- | ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Codex 0.166.0   | warm app-server               | app-server RPC，stdio／Unix socket等 | 已采用。核对当前 help、官方文档和现役源码，没有新跑生成。此前工具宿主预检失败仍保留，不宣称已修复       |
| Claude          | warm print + 双向 stream-json | 持续 stdin／stdout会话               | 已采用，不因带有 print 参数而改造；本批不启动 CLI                                                       |
| OpenCode 1.19.5 | warm serve                    | 本机 HTTP API＋事件流                | 已采用。核对当前 help和现役源码，没有新跑生成                                                           |
| Pi 1.5.0        | 每轮 print-JSON               | 原生 RPC／官方 RpcClient／SDK        | **优先候选**。真实 CLI＋本地假模型通过8项控制探针                                                       |
| Kimi 2.4.0      | 每轮 ACP                      | 同一 ACP 进程可持续处理多轮          | **第二候选**。真实 CLI＋本地假模型通过8项控制探针                                                       |
| Agy 1.5.0       | 每轮 print stream-json        | 新增 ACP；另有持续 stream-json 输入  | **第三候选**。ACP初始化成功；隔离环境没有账户，新建会话返回认证要求。宜先验证≥1.5.1候选，不自动升级本机 |

官方依据：[Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Claude流式会话](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[Agy ACP](https://antigravity.google/docs/cli/acp/)。Kimi检查了与本机2.4.0对应的[原始发布源码](https://github.com/MoonshotAI/kimi-code/tree/f26e4d91ef8d5d233f6c20b42a150f96924d4f5e/packages/acp-server)，没有将主分支的新行为当成本机事实。详情见[sources.json](sources.json)。

## 原生探针结果

Pi和Kimi各自完成以下检查，成功样本各12次localhost假模型请求、6个真实文件读取回执：

1. 启动持续接口，读取实际会话及模型／配置元数据。
2. 同进程、同session连续执行两轮真实读取与最终回复。
3. 不替换session地切换两个明确的假模型；Pi并设置thinking off，Kimi从low切到high。后续实际请求使用新模型；控制调用本身不生成模型请求。
4. 取消一次慢流式生成，取得原生aborted／cancelled证据。
5. 取消后，下一轮正常完成，没有被上次取消误杀。
6. 未发布模型被拒绝，没有静默换模型。
7. 进程退出后恢复精确原session，并保留修改后的模型；Kimi也保持high。
8. 续接后再次真实读取和完成；成功样本的两个进程均有exit0。

机器记录分别见[Pi成功样本](attempt-2.json)、[Kimi成功样本](attempt-8.json)及其两份原始frames。8项check包括两次连续轮次；上面的列表按操作含义说明，不是额外增加测试数量。

Agy 1.5.0的真实initialize返回protocol1、图片／嵌入上下文、会话load／resume／list／close及additionalDirectories等能力。没有发送session/prompt，没有测试认证后的模型／effort选择、取消和恢复。隔离环境的Authentication required不是用户现有账户登录失败。见[Agy握手与认证门槛](attempt-6.json)。

[官方1.5.1更新记录](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)列明：模型不再仅对指定编辑器完整开放；修复取消影响下一轮、prompt结束后仍发update，以及close／reload／resume与活动prompt交错的问题。这些直接影响Loom使用，故不能只凭1.5.0握手就上线。持续stream-json输入虽然也能多轮，但[官方说明](https://antigravity.google/docs/cli/headless/)不接受control_request／control_response，且/model等CLI命令不能混进该流；因此它不是完整控制协议的等价替代。

## 失败与接入要求

全部8次原生尝试都留在[台账](attempts.json)，包括失败，不只保留最后成功样本。合计54次localhost模型请求、27个实际读取回执；真实provider调用0。固定的假token数不能用于成本、缓存命中或质量结论。

- **Pi配置一致性：** 首次重启仍传初始--model fixture，正确地覆盖了RPC改成的fixture-alt。后继探针移除这项显式覆盖，原session正确恢复。产品接入时须由已有配置owner同步实际模型／effort；不能只改CLI内存，更不能修改整个Role或默默覆盖冻结实例。
- **Kimi完成判定：** 首个夹具把“无off_effort的推理模型”设成off，原生引擎报错且没有HTTP请求，ACP却返回end_turn。探针因为没有工具回执而失败。见[原生错误证据](kimi-error-evidence.json)。持续驱动必须验证当前轮的完整final与错误事实，不能仅看stopReason。
- **Kimi恢复协议：** session/resume的响应只有configOptions／modes，不返回新sessionId。原探针对此要求错误，后继按协议核对原ID、唯一会话列表、模型／effort及恢复后实际执行；原失败保留。
- **Kimi退出：** 最初研究工具的2.5秒EOF等待过短，出现TERM／KILL。这些不算clean exit。按现有原生关闭边界给35秒后，成功样本两次均exit0；没有关闭清理或把被杀退出改写成成功。
- **Agy启动：** --app-data-dir虽然help称路径，底层语言服务要求目录名而非绝对路径。首次参数错误不是认证错误；原始记录的错误标签在台账中明确纠正。后继使用隔离HOME下的相对目录，握手后准确停在认证要求。

## 后续最小施工顺序

1. **Pi纵向接入原生RPC。** 优先复用官方RpcClient／SDK，挂到现有RuntimeAdapter和进程池。只替换传输与控制，不新增业务队列或重写调度。每轮以agent_settled及当前final／工具终态为边界，不能只用agent_end。
2. **Kimi保持ACP进程。** 复用现有ACP接线；改造目前绑在“本轮CLI退出”上的完成和用量收口，保留独立RunAttempt、Worker凭据、取消隔离、会话绑定及真实清理证明。不能只是删掉关闭stdin。
3. **Agy选择≥1.5.1候选再验证ACP。** 独立取得与校验，验证Loom真实client身份下的完整模型／effort目录、认证后生成与取消／恢复。不伪装为编辑器身份绕开目录，也不把握手当作完整验收。

暂不调整已有Codex／Claude／OpenCode路径，不依赖Herdr，不增加模型判断层。界面控制必须经过Human命令与现有执行围栏；原生队列不能成为新的Channel／Inbox账本。

尚未完成：产品Core／Channel／Worker接线、权限交互、Human忙时指令、全部后代静止、Fork／Side兼容、真实模型质量、缓存／token／延迟对照及Agy认证后执行。此次没有正式部署，不宣称后端功能已增加。

## 复现与证据

脚本为scripts/runtime-interface-audit/pi-rpc.mjs、kimi-acp.mjs、agy-acp.mjs，各须显式--run-free。JsonLinesProcess仅为隔离研究工具，不是新产品协议库。TDD验证关联ID、乱序响应和快事件；共享本地夹具新增明确模型白名单及原生Read工具名，旧默认不变。定向11项夹具／协议／证据测试通过，未运行无关全套。

原始完整文件按[manifest](raw-manifest.json)留在本机临时目录；Git保存所有尝试、成功原流和关键失败证据。[清理](cleanup.json)未发现匹配本批目录的残留进程；失败中的强杀记录仍保留，不能外推为所有子进程静止测试通过。
