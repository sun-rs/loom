# 管理卡片与字号悬停修正

Provider 折叠卡片由用户指定采用黑框、悬停抬升硬阴影、展开标题黄色。此组合是本地管理页的明确设计要求，不宣称 Raft 有同一 CLI 配置页。使用现有 shared tokens；边框固定 2px，悬停上移 1px、阴影由 2px 增到 4px，避免改变布局尺寸。

## 源码依据

- `docs/evidence/raft-settings-20260905.js` 的 `Xr` 字号控件使用 `Ht / ze / Ue` 分段选择组件。
- `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js` 的导出 `bW = Av`、样式 `gR`：brutal item 采用 `border-2`、`hover:bg-primary-400/30`、`data-checked:bg-primary-400`，没有 hover transform 或 shadow。
- 同目录 `index-D8Neh8lc.css` 的 `.btn-brutal-sm:hover` 提供上移 1px、4px 硬阴影参数。Provider 卡片结构为 RAH glue，非逐字复制。

根因：字号按钮使用 `.btn`，被产品 shell 的通用 hover/active 抬升规则覆盖。当前在字号选择范围内取消 transform/shadow，保留固定黑框、选中黄色与未选中 hover 浅黄色。

## 验证

新增 `scripts/test-settings-hover-browser.mjs`，先观察旧实现黑框断言失败，再验证桌面与 390px：卡片 hover 阴影变化且宽度不变、展开黄标题、收起恢复、字号 hover 不改变边框/阴影/位移，点击选择有效。已有 runtime Guide 浏览器回归通过。

类型检查、399 项 Web 单测、format 检查、diff 检查与正式 Web 构建通过。全量 check 仍被独立施工中的 sq-btn 规格 ratchet 未提交及 matched-rules 源码 hash 过期阻挡；未放宽门禁。

正式实例已在空闲检查、状态备份后平滑重启。全新 Chrome 页面检查展开黄标题与字号无抬升通过，截图人工检查通过。本轮没有付费 CLI 测试，没有宣称官网同条件实时双边验收，没有提交或推送。
