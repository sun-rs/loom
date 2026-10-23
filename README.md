# Loom

Loom 是本地优先的多 Agent 协作平台。当前开发分支为 **main**（由 evo 晋升）；**chatbox** 独立承载从 `sun-rs/rah` 引入的多 CLI 工作台。旧复刻 UI 分支和 evo 分支已退役，不参与当前产品开发。分支关系见[主线与 Chatbox 记录](docs/evo/branch-promotion.zh-CN.md)。

用户自行安装并登录 Codex、Claude Code、OpenCode、Kimi 或 Pi。Loom 负责实例、频道、消息投递与运行管理，不代为安装 CLI 或配置账号。

## 当前架构

- **Role** 保存 CLI、模型、提示词等配置，修改生成不可变修订。
- **Instance** 是频道成员，持有冻结配置和独立执行通道；多个实例可以并行。
- **Session** 是实例连续使用的原生 CLI 会话。
- **Channel** 保存协作消息与共享记忆。Kernel 的持久状态是业务事实来源，Provider 输出与轨迹用于诊断。

后端本地单 Human MVP 已冻结。当前工作以官方前端对接和必要修复为主，不持续扩展后端架构或重复成本实验。

## 唯一产品前端

产品前端位于 `frontends/raft`：

- `packages/web` 等目录保存已授权采用的官方源码。
- `loom` 保存 Loom 数据接线、路由组合及必要的专属功能。
- `adoption.json` 记录来源版本、许可和文件摘要；共享组件来自固定版本的 `raft-ui`。

保留官方组件的字体、尺寸、状态、交互与响应式规则；尽量替换数据来源，不重新仿写页面。官方原始 store 不构成第二份业务事实。

旧复刻版本 `apps/web`、`packages/ui-web`、`packages/ui-tokens`、`packages/raft-ui-snapshot` 和临时控制台 `apps/console` 均已退役。源码历史仍可从 Git 查询，不参与当前构建、测试或服务部署。

## 代码归属

| 目录                                         | 职责                                               |
| -------------------------------------------- | -------------------------------------------------- |
| `packages/protocol`                          | 公共协议、身份和校验                               |
| `packages/kernel`                            | 事务、Room 事件、Inbox、Activation、游标与执行围栏 |
| `packages/agent-host`                        | CLI 生命周期、执行与清理                           |
| `packages/application-service`、`client-sdk` | 认证后的业务接口                                   |
| `packages/client-core`                       | 客户端有序同步、因果屏障与写意图                   |
| `packages/core`、`daemon`                    | 无界面 Core、服务启动和本地网关                    |
| `packages/computer-protocol`、`k-carrier`    | 远端计算机协议与运行基础；当前扩展冻结             |
| `frontends/raft`                             | 官方源码产品前端                                   |

## 开发与验证

需要 Node.js 24 或更高版本。依赖分别安装：

```sh
npm ci
npm ci --ignore-scripts --prefix frontends/raft
```

常用命令：

```sh
npm run typecheck
npm run typecheck:loom --prefix frontends/raft
npm run build:web:workbench
npm run test:official-web:source
npm run start:local-workbench
```

测试与改动范围匹配；浏览器门禁使用临时状态和 fake provider。`npm run check` 用于里程碑或有依据的跨层检查，不作为每个小改动的默认流程。真实 CLI 与付费成本验收必须单独授权，不能由常规测试自动触发。

已安装服务的更新需检查活动工作、备份持久状态、优雅重启并核验真实页面；不能仅凭健康检查宣布部署成功。

## 当前合同与证据

- [工程约定](AGENTS.md)
- [目标合同](docs/evo/target-contract.zh-CN.md)
- [当前状态与部署](docs/evo/status.zh-CN.md)
- [真实 CLI 与付费运行记录](docs/evo/paid-runs.zh-CN.md)
- [前端清理与后续官方接入清单](docs/audits/2026-10-17-frontend-cleanup-and-next.zh-CN.md)
- [临时控制台退役](docs/audits/2026-10-17-console-retirement.zh-CN.md)

历史审计描述当时的源码和限制，不代表当前能力。各 CLI 的真实验收与效率结论，以对应证据为准；源码接入、自动测试、真实页面、真实 CLI 和效率验收是不同结论。
