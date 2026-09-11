# UI 目录页（docs/design/ui-catalog.html）

一页式的新粗野 UI 目录：hero → 怎么用（ui-component-spec 技能）→ 规则与约束 → 组件预览 + 规格表 → 令牌刻度 → 页脚。

## 怎么生成

```
node scripts/build-ui-catalog.mjs            # 重新生成 docs/design/ui-catalog.html
node scripts/build-ui-catalog.mjs --check    # CI 用：产物过期则非零退出
node --test scripts/build-ui-catalog.test.mjs
```

产物已提交。**不要手改 `docs/design/ui-catalog.html`**，改生成器或改上游数据源后重跑。

## 数据来源（页面上没有一处是手抄的）

| 页面内容                                   | 来源                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 样式（含载入顺序）                         | `apps/web/src/product-styles.ts` 的 import 列表，递归内联 `@import`，字体转 base64 data URI                                                                                  |
| 图标                                       | `packages/ui-tokens/src/neo-brutalist/extracted/raft-icons.svg`、`packages/ui-tokens/src/interaction-icons.svg`，作为隐藏 `<svg>` 内联，`<use href="#raft-icon-…">` 离线可用 |
| 组件、上游来源、规则、例外、挂起、门禁期望 | `packages/ui-tokens/specs/*.spec.json`                                                                                                                                       |
| 预算与计数                                 | `packages/ui-tokens/specs/ratchet.json`                                                                                                                                      |
| 令牌表                                     | `packages/ui-tokens/src/neo-brutalist/tokens.brutal.css` 的 `:root`                                                                                                          |
| 改动边界 / 挂起小节                        | `docs/design/component-specs/*.zh-CN.md`                                                                                                                                     |
| 「怎么用」的步骤                           | `.claude/skills/ui-component-spec/SKILL.md` 的 `###` 小节                                                                                                                    |
| 校验器六条机械约束                         | `scripts/ui-component-spec.mjs` 头部注释                                                                                                                                     |

某一节的来源缺失时，页面渲染显式的「未登记」块，不编造文字。

## 约束

- 页面外壳只消费 `tokens.brutal.css` 的令牌（`--space-*`、`--control-*`、`--icon-*`、`--text-*`/`--fs-*`、`--shadow-*`、`--bd`），
  唯一的裸 px 是响应式断点 `767.98px`——令牌层没有登记断点令牌。测试用白名单锁住这一点。
- 预览是**真实产品标记**，包在 `.rah-product-shell` 里：hover / active 是真 CSS，disabled 是真属性，
  focus-visible 只在键盘 Tab 时出现。结构以 `apps/web/test/*-spec-fixture.tsx` 为准，移植成静态 HTML。
- 浅色单主题（产品即浅色），`<body>` 显式上底色。
- 767.98px 以下单列；宽表格在自己的容器内横向滚动。
- 输出确定性：无时间戳、无随机、键序稳定，跑两次字节一致。

## 新增一个组件的预览

在 `scripts/build-ui-catalog.mjs` 的 `PREVIEWS` 里按该组件的 fixture 结构加一条即可；
没加之前，该组件的预览格会显示「未登记」，其规格表照常渲染。
