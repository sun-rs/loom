# Worker 公开资料与运行器观察

`worker-visible-profile.ts` 是 `profiles/get`、`room/members` 和
`server/info.runtimeContext` 的唯一资料投影。WorkerReadService 先验证当前
Run、原 Activation 与所选 Room 成员资格；读取既不 ACK，也不推进工作或
control Room 的写入 cursor。人员参数不能覆盖 authenticated Agent。

## 数据来源与语义

- Principal/AgentDefinition 提供名称、头像、描述和创建时间；首个定义修订的
  `created_by` 提供原始创建者。资料编辑者不是新的创建者。创建者和创建的
  Agent 只在当前可见 Room 的成员关系内展示；tombstone 不绕过该限制。
- `membership` 显式标记 `scope: room`，提供真实 role/joinedAt，不能冒充
  Raft 中央 Server 身份。`createdAt/deletedAt` 来自定义/原始 tombstone 事件。
- `availability` 复用 `agent-presence.ts`，只暴露 activity、reason、activityAt
  和本次 observedAt。心跳过期、Host 停止、Agent 停用及运行观察沿用既有
  判断，不从任意错误正文猜额度、复位时间或提供商账户状态。历史 Agent
  没有定义时返回 null。它也不证明模型可无限调用。
- `configured` 是当前执行策略；`actualRun` 是当前可见 Room 中最新 Run 的
  冻结 Placement/model。注册的可选模型不意味着实际执行了这些模型。
  当前策略、默认模型和冻结实际运行必须分别表达。

## 只读本机 metadata port

`WorkerProfileMetadataPort` 仅接受 Kernel 已经确认的 Host、RuntimeProfile
和不可变 revision 标识。daemon 返回严格 schema 白名单中的资料；未知 Host
或 revision 不返回猜测。真实 CLI 标识来自 manifest 的 modelCatalogProbe
类型，显示名称来自该精确 revision，不解析 executable/PATH 名称。
`byoc` 仅用于 daemon 能证明属于本机的已注册 runtime，不能与工具权限模式混用。

`buildLocalComputerObservation` 从原有 Human inventory 提取后由两条读取路径
共用；它使用 canonical Host 心跳。daemon 只创建一个
`LocalComputerProfileStore`，并传入 Human 编辑入口及 Worker port，所以页面
修改名称/描述后 Worker 立即读取同一个 revision。`connection.observedAt`
记录本次时效判断；`observedState/observedAt/reportedBuildVersion` 保留 Host
最后报告的状态、时点与版本，不能把陈旧心跳叫作实时在线。

不传递 workspacePath、可执行文件路径、env、凭据、role/instructions、private
memory、完整诊断或隐藏 Room 的运行记录。port 不执行 CLI 探测，也不保存第二份
业务状态。直接构造 Kernel 或未配置该 port 的 service 保持兼容：字段缺失表示
没有来源，不填伪 Computer 或 runtime。

## 有界列表

`profile-show` 的 `--created-agents-limit` 范围 1–50，默认 50；
`--created-agents-cursor` 续读 `createdAgentsNextCursor`。分页复用
`discoveryPage`，绑定 authenticated Agent、Room 和原始创建者，冻结 Principal
上界；下一页重新检查当前成员资格。冻结后新建的 Principal 不插入该序列；既有条目的资料和成员关系仍按当前投影读取，非法或
异域 cursor 返回 403。此 cursor 不授予发送消息或 Task 执行权限。

创建的 Agent 条目有当前状态和可信 configured runtime 摘要；单条至多 16 个
配置目标，超出保留 `runtimesTruncated`。全资料保持完整 UTF-8 行预算，按条数
或字节提前停页，cursor 只越过已经返回的条目。`server/info` 的 self
runtimeContext 只带首个创建 Agent 及其 continuation，避免和成员列表重复放大；
成员分页再为完整 envelope 预留字节。普通读取的 512 KiB 上限没有放宽。

## 来源与验证边界

依据授权发布的 `raft-computer@1.0.18` `agentApiContract.ts:470–532,607–642`
和 daemon `chunk-ZHWD6VKE.js:2506,2509,2511,33850–33863`，属于结构化合同采用和
RAH owner 接线，不是 Raft 未公开 Server 的源码复用。Multica 的 Workspace
Agent 查询仅作边界比对，不复制其 SELECT * 或 runtime_config/custom_env。
源 SHA、完整 RED/GREEN 与适用差异见
[本批证据](/Users/sun/Code/reviews/rah_os/2026-09-08-profile-field-completion/closure.zh-CN.md)。

本批不新增 UI、MCP、多 Human 身份、Server capability 云账户语义或私有路径公开；
Raft prompt 提及 Agent 被阻塞时 error string 携带原因及限额重置时间，
不能据此认定 reason/resetAt 是独立结构化资料字段。本地尚无对应可信 typed owner，
没有猜测填充。本机运行器账户用量浮层及上游采集来源已经另行
[实操确认](../audits/2026-09-08-raft-remaining-live-confirmation.zh-CN.md)，
不可与 Raft 中央订阅额度混为一谈。CLI 与 HTTP 的字段结构保留 RAH 明确的 configured/actualRun
区分，不宣称 Raft wire schema 字节兼容。
