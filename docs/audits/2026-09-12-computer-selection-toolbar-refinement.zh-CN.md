# Computer 选择栏与分割线收口

依据用户左右对照截图及仓库冻结证据 packages/raft-ui-snapshot/reference/generated/raft-official-computers.css：Raft build 666bab60d8658d9e382e2c286ce1e423231e8f31，small-button-height 28px。复用内部 btn、Icon、EntityCard 和 ProfileSection；属于呈现结构调整，不是字节复制。本轮未进行新的线上双边测量。

- 选择模式隐藏创建；全选/取消同处标题行。
- 操作栏使用启动、停止、重启/重置图标和短标签，28px 高度；没有相应状态变化时禁用启动/停止，仍复用原有批次执行与重试 owner。
- 选中卡片持续使用共享 shadow-s，鼠标离开不恢复无阴影样式。
- Agent 段以下工作区与操作段分割线内缩20px，与卡片同宽。Agent 段上方分割线仍全宽。

验证：选择时创建仍可见的浏览器测试先失败；修复后通过全选/取消同一水平线、按钮高度、鼠标移开保持阴影、下方分割线与卡片 x/width 完全一致。Web404项、类型检查、构建通过。Chrome/Firefox × 1440/390 × 三种重启模式共12组隔离回归通过；未操作真实 Agent，也未运行付费 CLI。

全仓 check 仍被另一批 UI 规格的未提交 ratchet 与旧 CSS 哈希阻挡，format:check 仍有 ui-catalog.html、build-ui-catalog.test.mjs 两个非本批格式项；git diff --check 通过。正式部署状态在本批收尾时补充。

正式重启被守卫拒绝：仍有5个未完成Activation。新构建f5108c4ff7d5c36ec7b2acd7d44a2e4901316f7b0c6d829aec8f5694dfa239af尚未部署，没有强制终止工作。

补充回归：批量启动/停止重试与扫描失败恢复门禁，Chrome/Firefox × 1440/390 共4组通过。更新了此前仍定位旧“工作区扫描”区域标题的门禁，使用当前“AGENT 工作区”语义定位。
