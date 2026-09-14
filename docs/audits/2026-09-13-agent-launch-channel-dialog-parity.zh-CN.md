# Agent 启动配置与频道确认弹窗（2026-09-13）

## 来源与边界

Raft 发布前端冻结证据：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`，来源 https://app.raft.build/ 。发布 bundle 仅用于分析，未复制或新增生产依赖，沿用仓库来源记录与权利边界。本批是结构性移植与 RAH 接线，不是逐字复制。

频道确认使用 `zi`：`max-w-sm`、`p-6`、标题下 `mb-4`、正文 `mb-5 text-sm leading-relaxed text-black/75`、footer `gap-3`、操作 `size=sm`，关闭图标 20px。对应宽 384px、内距 24px、无标题分隔线、32px 关闭按钮、28px 操作按钮。归档/停止/可见性为 orange，删除为 red。频道信息表单 footer 自身没有额外 margin，保留父级 12px 间隔。

运行时表单发布代码包含 `envVars` 与受控环境变量清理；没有可核验的 Raft 后端环境合并实现，不能把本地合并算法标为 Raft 后端复制。Multica 对比位置为 `packages/views/agents/components/inspector/runtime-picker.tsx`，revision `11861145abc59a0d39c8c8f24ad837d4584e664f`；保留运行时可用性由现有授权入口校验的边界，未复制其代码。

## 本地所有权和明确差异

用户确认同时支持环境变量和 CLI 附加参数。单一所有者为 daemon 的 `RuntimeGuideSettings`，保存于已有 Host 私有设置文件（0600、原子替换、revision 冲突检查）。全局按 runtime，Agent 覆盖按 AgentDefinition + runtime；不写入 Room 事件、Agent 私有记忆或模型策略。

- 环境变量：Agent 同名覆盖全局，删除 Agent 项恢复继承；限制大小、数量和名称，RAH 控制的运行环境不可覆盖。
- CLI 参数：相同完整选项组去重，同名但值不同拒绝保存并提示冲突，不猜测重复选项语义；模型和通信等受控参数继续使用原保护规则。旧版全局完整覆盖与 Agent 附加参数同时存在时明确拒绝，需要先在 Settings 转为附加参数。
- API 通过现有 Human facade 校验 Agent 管理权限；真实执行从 Activation 的 AgentDefinition 取得作用域，不接受客户端伪造运行身份。
- 下一次启动读取配置，不中断当前运行。启动配置单独保存，模型/推理策略仍走原 canonical 配置命令；两种持久化不伪装为一个原子保存。
- Web/PWA 共用编辑器；重复保存禁用、错误可见、版本冲突可显式重新载入。

## 验证

失败先行：频道按钮间距 18.5px 与期望 12px 的浏览器失败；Agent 作用域测试在旧实现失败；CLI 冲突原为普通 Error 的回归失败。

已通过定向 daemon 启动配置/执行身份测试、application-service 未知 Agent 拒绝测试、隔离浏览器全局与 Agent 环境变量和附加参数保存/重新打开/全局不变，以及 390×844 无横向溢出。频道浏览器验证可见性取消/确认/失败恢复、归档/停止/删除弹窗几何与按钮颜色、12px 描述框间距。

正式 Web 构建、格式与 diff 检查通过；trusted reconnect 隔离浏览器验证保留原页面数据。完整检查及正式重启证据如下。没有运行付费 CLI；没有声称 Raft 在线同条件双边验收通过。

全量检查发现旧 ownership 测试仍要求成员侧栏最大 400px。现有实现为 320px；冻结 Raft 同一 bundle 的 `slock:sidebarWidth` 参数明确是 `min:180,max:320,defaultWidth:240`。只修正过时断言，保留现有布局实现，并运行成员/Computer 实际拖动边界浏览器回归。

## 正式交付与启动故障修复

`npm run check` 核心 1575 项中 1558 通过、17 跳过；Web 初次因上文旧侧栏断言失败。修正后单独续跑 Web 407、callback 34、formal-browser-policy 与 bilateral-captures 全部通过，未重跑无变化的核心套件。格式、diff、正式 Web 构建均通过。定向启动配置、频道弹窗、trusted reconnect 和实际侧栏拖动浏览器均通过；没有把旧 Fake CLI workbench/LAN gate 的既有失败标为通过。

本批启动发现额外故障：ProfileImageStore 原样传递文件系统小数 `mtimeMs`，Kernel inventory 要求 safe integer，导致正式进程退出。增加真实文件小数时间复现测试（先失败），在文件系统适配器向上取整到毫秒，避免缩短 GC 宽限期；头像 store、GC reconciler 和 Kernel lifecycle 的 13 项测试通过。没有修改头像字节或删除历史。

备份为 `~/.rah/backups/pre-restart-9a3c5551-04a3-4662-94cc-041c250f984a`。修复后以原 `~/.rah/state` 和验证过的冻结构建 `7960c793a8034a66cbb476cfb04e1a4eae3dbf3ba0a520b930549caffa9b32f0` 启动，三个入口的新 Chromium 页面通过：loopback、本地 LAN、Tailnet 的原四个 Agent、Council 历史、Agent 启动编辑器、390px 无横向溢出、384px 频道确认弹窗、32px 关闭按钮、28px 确认按钮及描述框 12px 间距。正式检查仅打开/取消，没有写入 Agent 配置或执行频道危险操作。此验证来自 Mac，不代表 iPhone 5G 网络链路验收。
