# Thread 空态与反应浮层视觉修复

## 证据与采用边界

- Chrome 同条件对照：`/Users/sun/Code/reviews/rah_os/2026-09-10-chrome-bilateral/chrome/24-thread-pair.png`、`26-emoji-pair.png`。
- 授权发布的官网前端 bundle：`/Users/sun/Code/repos/raft-ui/vendor/raft/index-WTraJnrd.js`，SHA256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。这是已保存的参考版本，不声称是当前线上最新版本。
- `cf` 共享空态函数：`px-6 py-12`、图标下间距 16px、标题 18px/28px/600、标题底间距 8px；Thread `noRepliesTitle` 调用该组件，`message-square` 图标 size 36，`flex flex-1 flex-col items-center justify-center`。
- `message-reaction-picker` 使用 `wG=224, Bg=8`，定位 `re.right-wG`，纵向 `re.bottom+4`，不足时 `re.top-lN-4`，边界裁剪。

这里采用的是布局参数与结构迁移，不是逐字复制组件代码。共享 EmptyState 已有相同图标与标题参数，增加 thread context 复用它；Thread 空回复容器采用纵向 flex，父消息保留自然高度。反应面板继续使用现有共享 DiscoveryFilter 及关闭/键盘 owner，只改锚点、间距和视口留白；其他过滤器不改变。

## 验证

新增 `apps/web/test/thread-chat-visual-parity.test.ts` 两条布局合同测试，修复前两条均失败，修复后通过；连同 Thread 面板、焦点返回、宽度合同共 13 条通过。测试只证明结构/布局合同与既有交互合同没有回归，不等于真实 Chrome 验收。实际布局、反应面板 hover、Escape 和指针命中仍由本轮主 Agent 在集成构建中验收。

本批不修改消息投递、Thread 历史/实时同步、权限、任务状态、反应持久化。Thread 菜单和文件定位图标已补充较新证据：`docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`（SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`）。`ict` 的 `thread-overflow-view-in-channel` 使用 `Vg`（map-pin）；`thread-overflow-follow-action` 在关注/未关注时分别使用 `Ore`（message-circle-off）/`Dre`（message-circle-plus）。文件 `channel-file-inline-jump` 同为 `Vg`。三个 Lucide SVG geometry 从该 bundle 原样迁入维护的 interaction sprite，动作处理不变。新增图标合同测试修复前失败、修复后通过；现有图标语义测试同时通过。新 bundle 的 `Ng`/Thread 空态及 reaction `n7=224,k2=42,sb=8` 再次确认上述参数。
