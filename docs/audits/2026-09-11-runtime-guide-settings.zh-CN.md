# Runtime 级 Guide 开关与等待基线

后续用户已更新默认策略为“已接通的 Guide 默认开启”，见 [设置页与默认策略更新](./2026-09-11-runtime-settings-redesign.zh-CN.md)。本文记录前一批的实施与验收，不作为当前默认值。

用户授权：默认等待，由 daemon 积攒；已核实接法的 CLI 可单独开启 Guide。此设置是本地产品扩展，不宣称 Raft 存在同样开关。

## 来源与实现

来源版本、路径和能力边界见 [CLI 源码能力表](./2026-09-11-runtime-wait-guide-source-matrix.zh-CN.md)。Raft Computer 1.0.18 的 main.js:766593 在不支持忙时输入时保留 inbox；769240 合并收件箱更新通知；direct/gated/none 是适配器分流。RAH 继续复用现有持久 Inbox/Activation，新增的只有用户投递偏好，不复制 Raft 未公开的服务器实现。

- Protocol 定义读取/更新合同，Client SDK 提供 `runtime.guide.read/update`；Human 认证的 v3 API 使用严格 schema，旧 revision 拒绝，Agent 凭据不能写入。
- daemon 的 `RuntimeGuideSettings` 唯一持有 `runtime-guide.json`，临时文件、文件 fsync、原子 rename、目录 fsync 后持久化。缺省全部关闭。偏好按 CLI 保存，不按 Room、模型或 Agent 派生新设置。
- Host 对实际 adapter 的 guideRuntimeId 查询偏好；读取 notice 前与投递前检查。能力不支持或用户关闭不会主动追加，已投递的输入不能撤销。
- Codex app-server、Claude stream-json 暴露可选开关；Kimi 当前 ACP、OpenCode 未接通的 Guide 显示不可用。源码存在候选能力不等于本地已接通。
- 设置页面复用 Settings 与 checkbox 样式，包含加载、保存、错误、禁用和过期请求处理；保存后以服务端结果更新，冲突后重读，不乐观伪造成功。

## 等待的精确含义

等待延后的是 daemon 主动投递到当前 CLI。消息仍已发布到 Room，Agent 主动回查仍可读取；本批没有修改 Room 可见性或 freshness。追加通知失败不 ACK、不完成 Task、不清除持久 follow-up；后续 Activation 在当前执行退出后处理。连续消息允许合并成下一轮，不承诺一条消息单独一次模型调用。

用户开关不绕过各 CLI 的会话/工具/轮次校验。开启后不等于已被模型读取，更不等于已回复。Kimi 本地服务与 OpenCode 原生追加接线、Claude 更完整的生命周期边界、相同条件的真实多 CLI 双边复验仍是后续工作。

## 验证

先增加测试，确认当前实现仍会在等待/关闭场景发送，得到预期失败；随后实现偏好检查。覆盖默认关闭、按 Runtime 独立、重建 store 后恢复、旧 revision 拒绝、未支持接法拒绝、读取期间关闭禁止后续写入。真实 Kernel + FakeRuntime 验证连续三条追加保留 follow-up，并在原运行结束后通过下一次执行交付；不把它称为真实模型验收。

HTTP 测试覆盖无凭据、Agent 凭据拒绝及 Human 合同校验。浏览器 gate `scripts/test-runtime-guide-browser.mjs` 覆盖 1440×900 / 390×844、真实鼠标点击、空格切换、CLI 独立值和禁用项；截图已检查。真实付费 native gate 已显式启用其测试目标的 Guide，本批未调用付费模型。

最终 `npm run check` 通过：核心测试 1404 通过 / 17 个显式跳过 / 0 失败，Web 单元 395 通过，其余合同与门禁均通过。首轮发现 SDK 操作清单未列两个新增接口，补齐清单后重跑全量通过。格式及 diff 检查通过。截图发现标题引用不存在的 terminal 图标，先补浏览器失败断言，再改用已有 code-xml；此后重新通过类型、Web 单元、UI 库、双尺寸浏览器检查并重建。

正式服务已受控备份并重启到构建 `17ce743f5995d1e1c159cbd45cf177717b696516d96a60c780750b522a5bb05f`；验收时 PID 20184 监听 4173。最终备份 `/Users/sun/.rah/backups/pre-restart-c9040be4-1efb-4900-859c-f10c1404069d`，脚本在停止前验证无活跃执行、备份及 Room 事件基线。正式 Chrome 通过鼠标切换、刷新、读取实际 daemon 文件、禁用项、桌面/手机尺寸验收；复验开始时已读取重启前保存的设置，结束恢复全部关闭（revision 4、enabled 空数组）。

正式截图与验收目录：`/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-guide-settings/`，脚本 `scripts/test-runtime-guide-formal.mjs`。本批没有运行真实付费模型、没有新增 Raft 双边实景验收、没有 commit/push；不能将开关验收等同于全部 CLI Guide 生命周期已收口。
