# Agent 工作区与本地项目文件合同（P2）

状态：`C/A/L/D` 完成。Raft 前端合同优先；项目 cwd 是 RAH local-first 的显式扩展，不冒称 Raft 服务端源码移植。

## 1. 上游事实与本地裁决

冻结来源为 `docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`。Raft Agent 详情的“工作区”调用：

- `GET /agents/{agentId}/workspace-files?includeHidden=...`；
- 展开目录时追加 `dirPath`；
- `GET /agents/{agentId}/workspace-files/read?path=...`；
- 默认树宽 `256px`，范围 `160..600px`；
- 隐藏文件按 Agent 记忆偏好，刷新保留已展开目录；
- Markdown 有“源码 / 预览”，图片可预览，其他二进制只显示不可预览；
- 手机在树和预览间切页，而不是把两列挤进 390px。

Raft 文案和迁移说明同时证明：这里的 workspace 是 Agent 持久目录，包含 `MEMORY.md`、`notes/`、Agent 放入的项目或其他文件，不等于一次 Provider session，也不等于中央 Server 的任意文件系统浏览器。RAH 现有 `AgentMemoryCoordinator` 把该目录实现为每个 Agent 隔离的 Computer 本地目录，安全边界成立；“Agent 私有目录”文案把 Raft 的 workspace 语义缩窄了，需要改正，但不能把 Memory 另挂成第二个 Agent workspace。

RAH 还需要查看本机实际开发目录。它作为第二个只读 root 暴露，来源只允许 daemon 冻结配置中的 `workspace.cwd`。客户端不得提交绝对路径，Kernel/HTTP 不从 query/body 接受 host path，cwd 不成为 Agent、项目或 Memory 的 canonical identity。

## 2. 单一 owner

| 层              | owner                                                | 责任                                                                                    |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| public contract | `packages/protocol/src/agent-workspace.ts`           | root 枚举、rootId、相对路径、列表/读取 shape 与上限                                     |
| filesystem      | `packages/agent-host/src/agent-workspace-browser.ts` | root 解析、realpath 边界、逐组件 `lstat`、symlink/hardlink/special-file/secret/大小拒绝 |
| composition     | daemon config + `AgentMemoryCoordinator`             | 注入唯一的本地 Agent workspace 根和冻结的项目 cwd；不接受浏览器路径                     |
| authorization   | Human application route + Kernel management view     | 每次 roots/list/read 前后都确认操作者仍可管理目标 Agent                                 |
| UI              | `AgentWorkspaceBrowser`                              | Raft 树/预览交互、root 切换、旧请求取消、路径与根语义说明                               |

项目文件不是 Room File、Attachment、Artifact 或 Task submission。浏览/复制路径不发布任何内容，也不证明 Agent 在当前 Activation 中读过它。

## 3. Typed root 合同

`agent.workspace.roots` 返回当前目标 Agent 可浏览的服务端冻结 root：

- `agent-workspace`：kind=`agent-workspace`，owner 为该 Agent，默认选择；
- `runtime-project`：kind=`runtime-project`，指向本 daemon 的 `workspace.cwd`，只表示本机运行根。

列表和读取只携带 `agentDefinitionId + rootId + relative path`。旧调用省略 `rootId` 时兼容选择 `agent-workspace`。响应回显 rootId/kind/pathRef，前端不能把上一个 root 的迟到响应投影到当前 root。

项目 label 可取显式 project binding 的短 label；未匹配时只用目录 basename 和“本机运行项目”，不从 basename/git remote 猜 canonical 项目身份。多个 checkout 的归并仍由既有 `.project-bindings.json` 显式 catalog 负责；首批不新增网页 catalog 编辑器。

## 4. 文件系统安全与有界读取

两个 root 共用同一个经过测试的读取器：

1. root 在 Computer 侧解析并 canonicalize；`/` 永不成为 root。
2. 每个相对路径组件拒绝 `.`, `..`, NUL、反斜杠、symlink 和 special file；普通文件要求单硬链接。
3. `.env`、credential/token/secret 名称、`.ssh/.gnupg/.aws`、`.git` 元数据、RAH/Slock 私有目录及依赖缓存永不展示；隐藏开关不能绕过 never/secret 规则。
4. 单目录最多返回 1,000 项、扫描最多 2,000 项并回显 truncated；文本 1 MiB、图片 5 MiB，其他二进制不读取正文。
5. open 前后重验 inode/dev/link/realpath；变化或越界 fail closed，不返回半旧内容。
6. HTTP 操作前后重新授权，读取期间权限被撤销时丢弃内容。

本设计仍是同一 OS 用户/full-access daemon 的管理边界，不声称能抵御同 UID 恶意进程在请求间改写普通文件。它防止 Web/LAN 客户端把服务变成任意路径读取器。

## 5. 前端状态机

- 首次进入默认 `agent-workspace`；root 选择器只在服务端返回多个根时显示。
- 切 root：Abort 当前 roots/list/read；清空选中文件、展开目录、复制结果和读取错误；保留共享树宽。
- 刷新：保留当前 root 和展开集合，重新请求已展开目录；失败显示错误但保留上次成功树。
- 手机：选择文件进入预览；关闭预览回同一 root/展开位置。
- root header 显示服务器返回的 pathRef，复制只复制该值；文案明确 Agent workspace 与本次运行项目的差异。
- 不把完整 cwd 注入模型上下文；此 UI 读取与 Memory 索引 token 消耗无关。

## 6. TDD、迁移和回滚

失败优先顺序：

1. protocol：未知 rootId、绝对 path、额外字段、响应 root 不一致；
2. AgentHost：项目非空树、隐藏/secret、symlink/hardlink/越界/过大/读取中变化；
3. application/SDK：root 枚举与 list/read 传递、权限撤销后丢弃；
4. UI：root 切换、迟到响应、刷新、树宽键盘/指针、390 树↔预览；
5. 隔离真实浏览器：本地非空 Agent workspace 与非空项目 root；Chrome/Firefox desktop + 390×844。

协议保持旧 list/read 请求省略 rootId 的兼容路径，因此无需数据迁移。部署回滚只需移除 `runtime-project` root 注入；默认 Agent workspace 和其文件完全不变。不得因为项目 root 失败而重置/创建/改写 Agent Memory。

## 7. 证据分层

Raft 官方 Computer 离线时只能证明前端源合同和官方空/错误态，不能宣称官方非空树双边通过。RAH 本地项目树成功属于本地功能验收；相同前提的 Raft Computer 恢复在线后，才能补非空树视觉/鼠标双边证据。

## 8. 施工与验收记录（2026-09-02）

- protocol 已增加 `agent-workspace | runtime-project` typed root、roots/list/read 严格 schema；旧 list/read 省略 root 时仍默认 Agent workspace。
- AgentHost 复用同一有界文件读取器，项目 root 来自 daemon 冻结配置；绝对路径不能由浏览器输入。项目非空树、隐藏项、secret、`.git`、symlink、hardlink、越界、大小限制与 root 绑定均有自动化覆盖。
- application service 在 roots/list/read 的 I/O 前后重复校验管理权限；SDK 只有 typed operation，没有任意 URL/path 旁路。
- Web 已实现多 root 才显示的选择器、切根取消旧请求、Raft 树宽 `256 / 160..600`、隐藏偏好按 Agent 隔离、刷新保留展开目录、Markdown 源码/预览、手机树↔预览和根语义说明。Memory 控件只出现在 Agent workspace，不泄漏到本机项目。
- failure-first 证据：protocol/AgentHost/SDK 缺少 root 合同时先失败；项目隐藏列表曾暴露 `.env`，测试先红后修为 never/secret 过滤；daemon composition root 一度超过 800 行门禁，已把项目目录解析留在 support owner 并恢复上限；K-carrier gate 捕获的半写 JSON 测试竞态仅修等待逻辑，不改产品。
- 自动化：`npm run check` 通过（package `773`，`771` 通过、`2` 个真实 Provider 用例按规则跳过；Web `167/167`；真实回调 `34/34`）；format、`git diff --check`、产品构建、`npm audit --omit=dev` 均通过且漏洞为 `0`。
- 本地真实浏览器：Chrome 完整门禁实际加载两个非空 root、切换本机项目、读取 README、切换 Markdown 源码/预览并验证 `390×844` 无横向溢出；Firefox 150.0.2 的 `1440×1000` 与 `390×844` 持久工作台门禁通过。证据等级为 `C/A/L`。
- 正式部署：active Task/InputRequest/Activation/Run/Runtime/lease/SOS 全为 `0`，数据库一致性备份后对精确实例执行优雅 TERM；新实例 PID `49255` 在 `4173` 服务，报告 `workspaceCwd=/Users/sun/Code/repos/rah_os`。正式浏览器在 OpenCode Agent 工作区看到非空 `MEMORY.md/notes` 和第二根“本机项目 · rah_os”，实际读取 README 并切换 Markdown 源码/预览；`390×844` 从树切到预览且 `scrollWidth=390`，console error/warn 为 `0`。证据等级补为 `D`。
- Raft 官方 Computer 当时仍离线，因此官方非空文件树没有相同前提；`R` 只覆盖冻结前端 bundle 的请求、状态机、布局与键盘合同，不能写成非空树双边通过。
