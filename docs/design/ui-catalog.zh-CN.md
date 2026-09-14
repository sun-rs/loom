# UI 目录页（docs/design/ui-catalog.html）

一页式的新粗野 UI 目录：hero → 怎么用（ui-component-spec 技能）→ 规则与约束 → 组件预览 + 规格表 → 令牌刻度 → 页脚。

## 怎么生成

```
node scripts/build-ui-catalog.mjs            # 重新生成 docs/design/ui-catalog.html
node scripts/build-ui-catalog.mjs --check    # CI 用：产物过期、或夹具摘要漂移则非零退出
npm run check:ui-catalog                     # 同上，已接进 npm run check
node --test scripts/build-ui-catalog.test.mjs
```

产物已提交。**不要手改 `docs/design/ui-catalog.html`**，改生成器或改上游数据源后重跑。

## 数据来源（页面上没有一处组件标记是手抄的）

| 页面内容                                   | 来源                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 样式（含载入顺序）                         | `apps/web/src/product-styles.ts` 的 import 列表，递归内联 `@import`，字体转 base64 data URI                                                                                  |
| 图标                                       | `packages/ui-tokens/src/neo-brutalist/extracted/raft-icons.svg`、`packages/ui-tokens/src/interaction-icons.svg`，作为隐藏 `<svg>` 内联，`<use href="#raft-icon-…">` 离线可用 |
| 组件、上游来源、规则、例外、挂起、门禁期望 | `packages/ui-tokens/specs/*.spec.json`                                                                                                                                       |
| 预算与计数                                 | `packages/ui-tokens/specs/ratchet.json`                                                                                                                                      |
| 令牌表                                     | `packages/ui-tokens/src/neo-brutalist/tokens.brutal.css` 的 `:root`                                                                                                          |
| 改动边界 / 挂起小节                        | `docs/design/component-specs/*.zh-CN.md`                                                                                                                                     |
| 「怎么用」的步骤                           | `.claude/skills/ui-component-spec/SKILL.md` 的 `###` 小节                                                                                                                    |
| 「规则与约束」的批次规则                   | `.claude/skills/ui-component-spec/SKILL.md` 的 `## 批次规则` 列表                                                                                                            |
| 组件预览的标记                             | `packages/ui-tokens/specs/*.fixture-markup.json`——门禁在真实 Chrome 中渲染夹具后导出的每个探针 `outerHTML`                                                                   |
| 校验器六条机械约束                         | `scripts/ui-component-spec.mjs` 头部注释                                                                                                                                     |

某一节的来源缺失时，页面渲染显式的「未登记」块，不编造文字。

## 约束

- 页面外壳只消费 `tokens.brutal.css` 的令牌（`--space-*`、`--control-*`、`--icon-*`、`--text-*`/`--fs-*`、`--shadow-*`、`--bd`），
  唯一的裸 px 是响应式断点 `767.98px`——令牌层没有登记断点令牌。测试用白名单锁住这一点。
- 预览是**夹具在真实 Chrome 中的渲染快照，与门禁同源**：
  `node scripts/run-component-spec-browser-gate.mjs <组件> --report-matching-rules` 在真实 Chrome 里
  渲染 `apps/web/test/<组件>-spec-fixture.{html,tsx}`，把每个探针 React 渲染后的 `outerHTML` 导出到
  `packages/ui-tokens/specs/<组件>.fixture-markup.json`，本页逐字渲染这些字符串——这和门禁量计算样式时
  看到的是同一份 DOM，生成器里没有一行手写的组件标记。
  **夹具本身不是产品页面**：它是门禁脚手架，只重现该组件在产品中的类名与结构，页面级布局、数据与路由都不在其中。
  快照取门禁的首个视口（sq-btn 与 sidebar-row 均为 1440×900）。
  舞台包在 `.rah-product-shell` 里，所以 hover / active 是真 CSS，disabled 是真属性，
  focus-visible 只在键盘 Tab 时出现。
- 导出文件带四重摘要（CSS 输入 / 夹具字节 / 门禁脚本字节 / 渲染 DOM）。夹具 TSX 改一个字节，
  `--check` 就失败，要求重跑门禁——这是「预览与门禁同源」的机械保证，不是口头承诺。
- 浅色单主题（产品即浅色），`<body>` 显式上底色。
- 767.98px 以下单列；宽表格在自己的容器内横向滚动。
- 输出确定性：无时间戳、无随机、键序稳定，跑两次字节一致。

## 新增一个组件的预览

1. 在 `packages/ui-tokens/specs/<组件>.spec.json` 里声明 `probes`、`fixture`、`gateScript`、`fixtureMarkupFile`。
2. 跑 `node scripts/run-component-spec-browser-gate.mjs <组件> --report-matching-rules` 生成
   `*.matched-rules.json` 与 `*.fixture-markup.json`。
3. 在 `scripts/build-ui-catalog.mjs` 的 `STAGES` 里加舞台：只写**标签、说明与探针 id**，不写任何标记。
   探针不在导出里时，该舞台会显式标成「静态示例（非夹具）」并列出缺失探针，不会静默消失、也不会手抄。

没加舞台之前，该组件的预览格显示「未登记」，其规格表照常渲染。

## 待实施

`docs/design/component-specs/` 里有文档但没有 `*.spec.json` 的组件（当前：`message-row`）
渲染在「待实施（只有文档、尚无规格 JSON）」下，**不计入 hero 的「组件规格」数**。
