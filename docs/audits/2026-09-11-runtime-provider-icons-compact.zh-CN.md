# Runtime 图标与紧凑卡片

用户要求从 Multica 等项目采用 CLI 标识，缩小 Runtime 设置卡片，不支持 Guide 的项目灰显。

来源：Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/views/runtimes/components/provider-logo.tsx`，采用 ClaudeLogo/CodexLogo/OpenCodeLogo/KimiLogo。SVG 保留原路径，去除 React className、增加 xmlns。完整许可证和上游说明见 [素材记录](../../packages/ui-tokens/src/runtime-icons/README.md)。Kimi 是 Multica 简化字母图标，不宣称官方资产；本页为用户明确要求的本地扩展，不宣称 Raft 原页面。

唯一视觉 owner 是 ui-tokens 的 runtime-settings.css，组件继续消费服务端 supported/enabled。保持配置持久化与默认策略；不支持行灰度、浅灰底、禁用输入，仍显示等待发送。桌面卡片实测约 90px 高，减少内边距、分隔和重复留白；窄屏保留名称和图标、隐藏冗余开关文案，但保留可访问名称与点击区域。

先运行修改的浏览器回归确认旧页面失败（provider img 缺失），实现后 Chrome 1440×900 和 390×844 通过：图标加载、尺寸上界、禁用灰度、真实点击、键盘空格、独立配置值和无横向溢出。两份截图已人工查看。Web 构建通过。

全仓 check 在并行施工的 agent-execution-workspace.ts 重置恢复类型错误处停止，format:check 同样有其他施工文件未格式化。已通知该批 owner；暂未正式重启部署，也未提交或推送。不能将隔离页面验证称为正式部署验收。正式地址仍为 4173，待后端批次通过集成检查后一起交付。

## 正式交付更新

并行后端批次已通过主任务独立审查与最终全仓检查，正式服务已备份重启。本页现已部署至4173，正式Chrome桌面/手机实测通过并查看截图；Guide原有开启配置保持。构建、备份与测试明细见[联合交付记录](./2026-09-11-parity-batch-review-and-delivery.zh-CN.md#第二批联合交付主任务验收完成)。前述阻塞为施工过程记录，现已解除。

## 管理页单行布局更新

按用户提供的账户列表截图调整：撤掉独立 Runtime 导航，忙时投递控件作为管理页首个区块；旧 `settingsSection=runtime` 链接规范化到 `administration`。每项图标、名称和短说明同一行，右侧统一44px控制列，复选框上下对齐；不再显示重复的开启/关闭文案。勾选状态继续由原持久配置决定，不支持的行灰显禁用，不改变Runtime能力。

浏览器失败回归先证明旧路由不跳转；实现后1440×900和390×844通过：管理标题/入口、旧链接跳转、无Runtime导航、四个checkbox横坐标误差小于1px、卡片高度不超过70px、点击/空格键/灰显/无横向溢出。截图已查看。完整check、format、diff和Web构建通过；随后确认空闲、备份并温和重启正式实例。

本次正式build `17bdaeaec3c6230c911e8bf94e6d4dff66ada272dfd3c15776f035eabc84fe0f`，观测PID67174，端口4173。备份为 `/Users/sun/.rah/backups/pre-restart-cb41b090-ade8-4ff8-a76d-5b888b8d7687`。正式Chrome管理页设置持久化、恢复原偏好与桌面/手机截图通过，证据在 `/Users/sun/Code/reviews/rah_os/2026-09-11-management-guide/`。未运行付费模型或提交推送。
