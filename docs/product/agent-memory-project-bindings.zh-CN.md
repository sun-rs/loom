# Agent Memory：轻量项目目录绑定（M2a）

状态：M2a 可选目录提示已接入；按 [Raft 基线优先合同](./agent-memory-raft-baseline.zh-CN.md)修订为配置错误不阻断 Agent。默认完整原索引读取，无文字选择算法；未部署到用户在线实例。补充 [ADR-0026](../adr/0026-compact-agent-memory-and-project-hints.md)。

## 范围与 owner

现有 Workspace 是协作容器，WorkspaceMount 是执行位置证据；没有可直接当成 Git 项目的 canonical 实体。本切片先实现 **Computer 本地、操作者显式配置的目录提示**，不新增项目数据库、Room 事件类型、记忆分区或共享记忆权限。

`packages/protocol` 拥有配置、短提示与运行来源结构；`packages/agent-host` 是唯一配置读取/路径解析/快照 owner。Kernel 继续拥有 Agent、Workspace、RunAttempt、Memory Home 和权限。未来网页配置与跨 Computer canonical 项目管理属于 M2b；本地提示键不能冒称跨机器全局项目 ID。

## 配置

可选文件位于既有 Computer memory 根目录的 `.project-bindings.json`，与各 Agent 的私有目录并列。操作者提供 JSON；程序不自动创建/猜测配置、不修改 Git、不改写任何 Agent 记忆。文件必须为当前 OS 用户所有的私有普通文件，拒绝符号链接和硬链接，最大 256 KiB。

本机正式 daemon 的准确位置为 `<stateDirectory>/supervisors/agent-memory/.project-bindings.json`；独立 remote Computer 为它自己的 `<supervisorDirectory>/agent-memory/.project-bindings.json`。这是维护者文件配置入口，尚无网页编辑器。使用本机实际状态目录，不要把示例路径写进运行实例；已有文件应编辑而非覆盖。key 应长期保留，目录搬迁改 roots、展示改 label，不把旧 key 重用于无关项目。文件变化仅对新 Run 生效，无需 Agent 重新建库；修改正在使用的 RunAttempt 的配置会触发冻结来源冲突。

```json
{
  "schemaVersion": 1,
  "projects": [
    {
      "key": "rah-os",
      "label": "RAH OS",
      "roots": ["/work/rah_os", "/work/review/rah_os"],
      "relatedKeys": ["raft-ui"]
    },
    {
      "key": "raft-ui",
      "label": "Raft UI",
      "roots": ["/work/raft-ui"],
      "relatedKeys": []
    }
  ]
}
```

这些路径是示例，不会自动写入本机。首版支持 macOS/Linux POSIX 绝对路径。每份配置最多 128 个项目、每项目 16 个根目录/8 个直接关联；键最多 64 个 ASCII 字符，短名称最多 96 UTF-8 bytes。关联是有向的直接提示，不递归扩展、不同步笔记、不改变授权。

## 解析规则

1. 同一个 key 的多个 roots 表示操作者确认的同一项目。basename、同一个 remote、相邻目录都不是自动合并依据；暂不运行 Git 探测器。
2. 对实际启动 cwd 和存在的根目录解析 realpath；相同物理目录若属于两个 key，则拒绝歧义，不按数组顺序选择。
3. 按目录边界匹配，取最长的显式根目录；允许将 monorepo 子项目/submodule 显式单列。`/work/app` 不匹配 `/work/app-other`。
4. 不存在的旧 checkout 不作为匹配候选；配置文件不存在、未匹配分别记录 `unconfigured`、`unmatched`。严格 resolver 拒绝损坏、无权限、物理冲突等错误；Activation 记录 `unavailable` 并继续正常记忆，不猜项目、不伪装成未配置。cwd 或私有记忆根不安全仍阻止启动。
5. 每个新 Run 只读取一次有界配置，成功解析时冻结 digest。不可用时只冻结不可用状态，不声称验证过配置内容。映射变化不改写旧 Run；同一 RunAttempt 的 cwd/有效配置版本/解析状态或匹配结果变化必须拒绝。

## 索引成本与证据

启动 envelope 仅新增 `{key,label}` 和短 `projectResolution` 状态，计入 4096-byte 传输预算。默认不承载索引正文，模型读完整原始索引；可选内联只能包含整份原文。不注入 roots、relatedKeys、完整 cwd 或别名清单，也不按项目隐藏其他 Agent 私有笔记。

完整来源写入已有 Computer RunAttempt materialization receipt 的可选 `source` 字段，不另存第二份记忆。`RAH_AGENT_MEMORY_SOURCE_FILE` 提供按需读取该 receipt 的位置；默认不要求全读，按需也只提取 `source`，不把整个文件清单打印进上下文。来源包含启动准备时的配置 cwd、realpath cwd、配置 digest、匹配根及项目/关联提示。它证明准备时的位置解析和配置选择，**不是 OS 对后续进程 cwd 的持续证明；不证明每条记忆来自该目录，不追踪 Agent 后续自行 cd，不把项目关联当作某条事实的适用范围或最后验证时间**。

未更改 Kernel ContextManifest 的授权结构，也没有在 Room ledger 中保存这些绝对路径。旧的无 source receipt 仍可读取。源快照与新 receiptId 绑定；同一 Run 的 cwd、解析结果或 catalog digest 改变会拒绝重放。该配置仍处于同 UID/full-access 信任模型内，不提供防恶意 Agent 修改本地文件的安全隔离。

本轮收紧后，默认 prompt 已撤回按短提示写索引标签和选择 notes 的要求。现有显式映射、运行来源和短 envelope 保留兼容，不据此增加记忆分类或宣称检索效果改善。尚未实现结构化逐条笔记来源自动关联，也不能声称所有历史笔记已经自动补齐元信息。

## 验收与部署

- 多 checkout 同 key、不同同名目录、显式嵌套项目、相关但不同项目、未配置/未匹配。
- symlink 别名归一、物理目录冲突、非法 JSON/权限/硬链接/过大配置拒绝。
- 同一 Run 来源不可变，重启后重读配置；源文件不变，Agent 仍按 participant 隔离。
- 真实 Node 子进程读取 receipt 与短提示；长路径不进入启动索引，总预算不变；本地与远程 composition 共用。
- 全量测试、类型和格式检查。浏览器配置、真实 LLM 相关性判断、强制临时模式另行验收。

仅新版本进程中的新 Run 会采用本切片；不重启用户在线 daemon、不热改冻结 RuntimeProfile。未配置文件时保持原有 memory 行为，仅补齐启动来源证据。

来源裁决：沿用 Raft 的单 Agent 文件记忆与按需 notes；借鉴 Claude-Mem 的短入口和统一解析原则。这里的显式目录配置/冻结来源是 RAH 适配，未声称为 Raft 或 Claude-Mem 原始代码，也未引入其 observer、hook、索引数据库或新依赖。

## M2a 原始审查记录（后续默认行为以基线优先合同为准）

- 10 个相关测试文件 **60 项全部通过**。目录解析覆盖多 checkout、同名不同项目、直接关联、显式嵌套目录、前缀邻居、缺失 checkout、symlink 归一与冲突、根目录别名绕过、非法 JSON/权限/硬链接/超大文件。
- 启动集成通过真实 Node 子进程核对短 project hint、receipt 中的 cwd 和配置选择；在另一 checkout/Room/RuntimeProfile 中仍指向同一 Agent memory；重新打开 registry、local fallback 和 remote fallback 均有执行证据。
- 同一 Run 的目录/配置变化被拒绝；原始 `MEMORY.md` 和旧 receipt 不变；不同 Agent 的索引路径仍隔离。默认启动只加短提示，总 JSON 仍不超过 4096 UTF-8 bytes。
- `npm run check`：类型检查通过；后端 **627 项，625 通过、2 项付费 CLI 门禁跳过**；Web **25 项通过**。`npm run format:check`、`git diff --check` 通过。

仍开放：网页配置、跨 Computer canonical 项目身份、逐条笔记的结构化来源绑定、真实模型的相关性/召回验收及临时对话强隔离。测试 Worker 不等于真实 LLM；本轮没有浏览器操作、没有调用付费模型，没有提交/部署/重启用户服务，也没有替用户创建在线目录映射。M2a 可作为这些后续功能共用的底层解析与来源合同，但不是整个 M2/M3/M4 完成证明。
