# Raft 缺口修复 A：Cleaner 配置闭环验收

日期：2026-08-30。结论：**本机 Cleaner 配置这一批通过；不代表整个记忆生命周期或产品收口。未部署到用户在线实例，未提交 Git。**

## 先设计、再审查、后施工

1. [分批修复方案](../product/raft-gap-repair-plan.zh-CN.md)：列出 A–F 的必要性、单一 owner、上游依据和放行门禁。
2. [施工前二次审查](./2026-08-30-raft-gap-plan-second-review.zh-CN.md)：否决用 AgentDefinition revision 代替配置 revision、JSON rename 充当 CAS、把关闭 cleaner 当关闭记忆，以及直接 wake → spawn。这是同一执行者的第二轮审查，不是第三方审计。
3. 先见红测试：缺失 store / Coordinator 方法、Human 路由 404、CLI 不认识 app config；然后接入实现。另加 reset 回滚反例，先复现旧配置覆盖，再修复。

## 本批实际修复

- 按 Raft Computer 1.0.18 的 `system.cleaner` 合同，只提供 enabled、threshold_bytes、interval_ms。默认值及上下界沿用上游。
- 配置独立 revision + 条件更新；持久保存，unset 恢复默认。编辑人设或重置记忆不删除配置，下一次合法 Activation 恢复配置。
- Human API 受 Workspace Agent-management 权限约束；SDK 使用同一 typed schema。文件列表的阈值读同一个配置 owner。
- 当前 Run 的私有 CLI 支持 `rah app config --app system.cleaner [--set key=value] [--unset key]`。先读取再条件写，冲突不自动覆盖。提醒中原先没有真实动作的指引现在指向这条可执行命令。
- Web Agent → 工作区 → 大小提醒设置：保存、恢复默认、冲突后显式重读、输入校验、关闭/焦点恢复。复用既有 Raft 风格表单、按钮和 dialog 协议，未另加页面级颜色/尺寸。
- 修复重置失败回滚时恢复旧 timer 配置的竞态：改为读取最新已提交配置。关闭过程中不复活 timer。

关闭大小提醒**不关闭记忆读取或保存**。此批不切分、不筛选、不总结、不重写 MEMORY.md / notes；原版 prompt 字节校验仍通过。

## 源码采用方式

Raft 授权 bundle SHA-256 再次核验为 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。依据 `src/commands/app/config.ts` 的 GET → expectedRevision PATCH → 409 重读，以及 cleaner 的 revision/config/threshold 规则。

这是**合同与调用逻辑的结构化移植**，不是整份上游 App 配置系统逐字复制。Raft Server 的配置存储源码不可见；本机 `.cleaner-config.sqlite`、Human ACL、run-scoped capability 与 Web 入口是 RAH 适配。SQLite 只存三字段 override 和 revision，不是新记忆引擎。已有 SQLite 提供并发事务/恢复，避免自制跨进程文件锁。

## 实测证据

### 自动化

- `npm run check`：后台 645 项，643 通过、2 项 opt-in 付费 gate 跳过；Web 单测 25/25。零失败。
- 最后追加的符号链接与 Room sequence 断言，目标测试 5/5 通过；TypeScript 再次通过。
- 两个真实 Node 子进程以相同 expectedRevision 写同一数据库：一个 committed，一个 conflict，最终只有 revision 1。
- SQLite 触发器模拟写入失败：更新整次回滚，内容及 revision 不变。
- Human 越权/Agent 凭据拒绝，CLI 不允许指定另一 owner、拒绝 Origin、旧 revision 返回 409、Run release 后能力失效。
- 配置操作不改变 control Room sequence；disabled 后仍可读取原记忆，配置保存本身不 wake 模型。
- production Web build、Prettier、`git diff --check` 通过；生产依赖 audit 为 0。构建仍有 >500 kB chunk 提示，不声称性能门禁全绿。

### 真实浏览器

隔离 fixture：loopback 4189，真实 daemon/SQLite/Human API，fake providers。没有调用付费模型，也没有使用用户正式数据。

[步骤与观察值](./evidence/2026-08-30-cleaner-config/browser-results.json)：

1. 修复前配置入口数量为 0。
2. 1440×1000 保存关闭提醒 / 8192 bytes / 900000 ms，得到 revision 1；刷新并重新进入后仍是这些值。
3. 第二页面提交 revision 2；第一个页面旧值保存被后端拒绝，重读得到 16384。期间发现 HMR 下 `instanceof` 识别不稳定，修为按 typed code/status 识别；再实测确认中文错误、保存禁用、明确重读。
4. 恢复默认得到 revision 3。
5. 核实实际视口为 390×844、document scrollWidth 390 后操作；4095 非法值禁用保存，24576 成功保存为 revision 5。首次视口设置作用于另一个 tab，已纠正，未将错误尺寸截图当作移动端证据。
6. 切换 Kimi，仍为 revision 0 / 65536；不继承 Alice 的配置。
7. Escape 关闭弹窗，焦点返回“大小提醒设置”。

截图：[桌面冲突](./evidence/2026-08-30-cleaner-config/desktop-conflict.png)、[移动端保存](./evidence/2026-08-30-cleaner-config/mobile-saved.png)、[另一 Agent 默认值](./evidence/2026-08-30-cleaner-config/mobile-other-agent-default.png)。

## 未完成与下一批

- 官方 cleaner Web 配置页未重新做像素级双边测量；此批验证的是源码合同与本机配置交互，不宣称 UI 1:1 新增认证。
- idle 自治启动、active notice、provider-native memory 的全 CLI 控制仍未完成；不会把本批 Node 测试说成真实模型已完成自动整理。
- 全局 Tasks 仍错误落到 Room 范围，Search / Activity 等缺口没有顺手改动。下一批 B 先核定 Raft 全局查询范围及权限，再补跨 Room / DM 反例和双边大屏浏览器测试。
- Notifications/deep links、execution restart/reset / 安全改派、Artifact/Files 继续按分批计划推进。
- 未进行 Firefox、物理 iPhone 或正式部署验收。浏览器临时标签已关闭、视口已复原；临时服务停止，不影响用户正式 daemon。
