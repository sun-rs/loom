# Agent 工作区界面收缩与 Raft 参数对齐

用户于 2026-09-17 撤回 Agent 工作区中的运行项目选择器、说明页脚和独立记忆管理界面。
工作区只浏览当前 Agent 的持久目录。此决定取代
[旧多根合同](../product/2026-09-02-agent-workspace-and-project-files-contract.zh-CN.md)
中把运行项目作为第二个根的产品决定。

## 源码依据

- Raft Web `release/v1.16.0`，commit `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`。
- [AgentDetailPanel-CW_VMZT6.js](https://app.raft.build/assets/AgentDetailPanel-CW_VMZT6.js)，
  SHA-256 `918921bbb932ed020285d2f3639c0a5511249f4bca1d2468628da995078a37e3`。
  `mi` 文件树、`agent.workspace.title` 和 `agent.workspace.selectFile` 分支。
- [index-CKeqacxz.js](https://app.raft.build/assets/index-CKeqacxz.js)，hash 和版本见
  [版本证据](../evidence/raft-release-20260916/manifest.json)。`Gr / E8` 标题参数。
- 仅静态解析已发布代码，不执行、不分发 bundle；图标复用内部已有 Lucide 来源资产。
  这是源参数结构化移植和 RAH 接线，不是逐字复制上游组件。

| 项目         | Raft 参数                                                   | 本地采用                           |
| ------------ | ----------------------------------------------------------- | ---------------------------------- |
| 文件行       | 14px / 20px；纵向 padding 4px；图文 gap 4px                 | 相同                               |
| 缩进         | 目录 8px，文件 22px，每层加 16px                            | 相同                               |
| 图标         | 14px；目录 orange；文件 black/50                            | 共享图标及颜色 token               |
| 工作区标题   | 12px / 16px，700，black/60                                  | 相同；中文标题依本地规范保持零字距 |
| 隐藏文件按钮 | 28px 点击区，13px 图标，关闭 black/40，开启黑色             | 相同                               |
| 刷新         | 12px 图标，black/40，hover 黑色；按钮组 gap 4px             | 相同；统一 flex 垂直居中           |
| 空预览       | 等宽 14px / 20px，black/30；32px 图标、opacity .3；间距 8px | 相同                               |
| 文件树       | 256px，分隔线 2px，树上下 padding 4px                       | 相同；沿用已有移动树/预览切页      |

## Owner 与边界

`AgentWorkspaceBrowser` 固定请求 `agent-workspace`，删除根选择器和页脚。
`agent-directory-pane` 删除 `AgentMemoryPane`，同步删除其 CSS 与专用配置弹窗。
不删除、迁移或改写任何 `MEMORY.md`、`notes/`，也不改运行时记忆准备和隔离逻辑。

`createDaemonAgentMemoryCoordinator` 不再注入运行 cwd 或 execution workspace resolver。
因此正式 `agent.workspace.roots` 只枚举 Agent 根；旧客户端直接发送
`runtime-project` 的 list/read 也不会获得文件内容。协议枚举和底层有界读取器保留兼容，
不为删除 UI 改数据库或破坏已有文件安全测试。

Composer 的 Computer 文件引用继续由独立 `ComputerFileBrowser` 提供。
Agent 工作区不是通用主机浏览器，两者不会共享根选择状态。

## 验证

`npm run test:web:agent-workspace` 使用临时 daemon、真实 Kernel 和 Fake CLI，
覆盖 1440×900 与 390×844：无选择器/页脚、无记忆管理请求、服务器根列表与旧根拒绝、
computed style、目录展开与刷新、Markdown 预览、手机返回、权限失败恢复和 reload。
先在原实现上确认选择器断言失败，再修复。WebKit 使用 `RAH_UI_BROWSER=webkit`。

`workspace-roots-contract` 继续覆盖旧服务返回多个根时 UI 仍只使用 Agent 根。
真实 Raft 非空树同条件双边操作和物理 iPhone 未在本批验证。
自动检查：`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 通过。包测试 1681 项中 1664 通过、17 个付费门禁按默认跳过；
Web 单元测试 450 项通过。CSS 变更后重新采集 sidebar-row / sq-btn matched-rules 证据。

Chromium 与 WebKit 各通过 1440×900、390×844；截图人工检查。
旧多根服务 fixture 在两个尺寸下均只请求 Agent 根。
本地浏览器输出目录分别为 `rah-agent-workspace-1ChO2V` 与 `rah-agent-workspace-1eoUqU`
（系统临时目录下，不是用户产品入口）。

正式部署：确认空闲后完成校验备份
`~/.rah/backups/pre-restart-fe793e71-f0d1-4812-ad8c-625ef19b48f8`，
正常停止旧实例，后继 PID `88129` 保留三条原监听地址和 4173 端口。
冻结 Web build `8caa34c1f9ebc8fceb1c185146cee8be0e47b36559d4cc4c27eebeea5dd48613`，
health identity `2ee26fa45f21d1a8` 与构建匹配。
`test-agent-workspace-formal-browser.mjs` 从正式地址新开浏览器，两个尺寸下确认根列表、
真实 MEMORY.md 预览、关闭和 reload；无页面错误，Room event 序列前后相同。
截图与回执位于系统临时目录 `rah-workspace-formal-0bsWnK`。
未提交、未推送、未运行付费模型或物理 iPhone 测试。
