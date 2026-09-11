# 组件规格：聊天侧栏行家族（批次 3）

范围：频道行 `.channel-row`（含选中态、私信行 `.rah-direct-room-row`、已保存行 `.sidebar-bookmarks`）、分区标题行 `.side-title` / `.rah-sidebar-disclosure` / `.count`，以及分区右侧的扁平迷你钮（排序、新建）。
机器可读副本：`packages/ui-tokens/specs/sidebar-row.spec.json`，接入 `scripts/ui-component-spec.mjs`（沿用批次 2 的全部约束：上游字面量期望、tokenContract、来源实算、`ratchet.json` 以 HEAD 为上限、`since`/`evidenceNeeded`、按夹具元素反查命中规则）。

## 上游来源

与 `sq-btn.zh-CN.md` 相同的冻结包（v1.12.0，CSS sha256 `11f78ea3…`，JS sha256 `65dda386…`）。活体双边：2026-09-11，已登录 app.raft.build，1440×900 与 390×844，Raft 频道 `#test`，RAH `Agent Council`。

## 上游元素（live DOM 类名 + 冻结 CSS 声明）

| 元素           | 类组合                                                                                                                                                                                                                                                                           | 关键声明                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 行（未选中）   | `mb-1 flex w-full items-center gap-1.5 px-2 py-2 [@media(max-height:600px)]:py-1 md:py-1 text-sm font-medium border-2 border-transparent hover:border-black hover:bg-white hover:shadow-brutal-sm active:border-black active:bg-white active:shadow-brutal-sm transition-colors` | 14/20 500；padding-block ≥768px 为 4px，<768px 为 8px，视口高 ≤600px 为 4px；padding-inline 8；gap 6；mb 4；border 2 transparent；hover/active：黑边、白底、2px 阴影；transition colors .15s                                                                                                                 |
| 行（选中）     | 同上 + `border-black bg-brutal-pink text-black shadow-brutal-sm font-bold`                                                                                                                                                                                                       | 粉底 `#fe7da8`，黑边，2px 阴影；字重计算值 500（`font-medium` 在 CSS 中排在 `font-bold` 之后）                                                                                                                                                                                                               |
| 行内 `#` 图标  | lucide-hash `width=14`                                                                                                                                                                                                                                                           | 14×14                                                                                                                                                                                                                                                                                                        |
| 私信行头像     | `size-4.5 border !size-[18px] !border`                                                                                                                                                                                                                                           | 18×18，1px 黑边                                                                                                                                                                                                                                                                                              |
| 私信行描述     | `min-w-0 flex-1 truncate text-xs text-black/40`                                                                                                                                                                                                                                  | 12/16，字重继承行的 500，black/40                                                                                                                                                                                                                                                                            |
| 已保存行       | 与未选中行相同类组合 + `text-left`                                                                                                                                                                                                                                               | 同行；mb 4                                                                                                                                                                                                                                                                                                   |
| 分区标题容器   | `mb-1 mt-3 flex h-6 items-center justify-between px-2`                                                                                                                                                                                                                           | 高 24，mt 12，mb 4，px 8                                                                                                                                                                                                                                                                                     |
| 分区标题按钮   | `flex h-6 min-w-0 flex-1 items-center gap-1 text-xs font-bold uppercase text-black tracking-widest hover:text-black/70 transition-colors cursor-default`                                                                                                                         | 12/16 700 大写，字距 `--tracking-widest`=0.1em=1.2px，黑；hover black/70；内含 12px chevron                                                                                                                                                                                                                  |
| 分区计数       | `text-black/40 font-mono normal-case tracking-normal`                                                                                                                                                                                                                            | 12/16 **700**（继承）Space Mono，black/40                                                                                                                                                                                                                                                                    |
| 排序钮、新建钮 | `btn-flat-sm flex size-6 items-center justify-center p-0`                                                                                                                                                                                                                        | 24×24，pad 0，图标 14（lucide `arrow-up-down` / `plus`）；`.btn-flat-sm`：display 字体 700、color black/70、hover 底 black/5 + 字黑、active 底 black/10、`:focus, :focus-visible { outline-style: none }` + focus-visible 底 black/5 字黑、disabled `opacity .4; pointer-events none`、transition colors .1s |

`.btn-flat-sm` 冻结 CSS 原文：`font-family:var(--font-display);font-weight:700;color:color-mix(in oklab,var(--color-black) 70%,transparent);display:inline-flex;align-items:center;justify-content:center;transition-property:color,background-color,…;transition-duration:.1s`；`:hover{background-color:color-mix(in oklab,var(--color-black) 5%,transparent);color:var(--color-black)}`；`:active{background-color:color-mix(… 10%…)}`；`:focus,:focus-visible{outline-style:none}`；`:focus-visible{background-color:… 5% …;color:var(--color-black)}`；`:disabled{pointer-events:none;opacity:.4}`。

## RAH 现状与逐项判定

| RAH 规则                                      | 文件:行                                                                         | 判定                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.channel-row` 基态                           | `styles.css:161-171`                                                            | 14/20 500、pad 4/8、gap 6、mb 4、border 2 transparent、transition .15s：一致。**缺响应式分支**：<768px 应为 padding-block 8px（活体：Raft 390px 计算值 8px，RAH 4px）；视口高 ≤600px 为 4px                              |
| `.channel-row .row-icon { 18px }`             | `styles.css:173`                                                                | **偏离**：Raft `#` 图标 14px（活体两侧：14 vs 18）                                                                                                                                                                       |
| hover/active、`.is-selected`                  | `styles.css:177-183`                                                            | 一致                                                                                                                                                                                                                     |
| `.rah-direct-room-row small`                  | `channel-extras.css`（12px/16px 400）                                           | **偏离**：字重应继承 500（Raft 计算值 500，RAH 400）                                                                                                                                                                     |
| 私信头像 18px 1px 边                          | `channel-extras.css`                                                            | 一致                                                                                                                                                                                                                     |
| `.sidebar-bookmarks`                          | `styles.css:130-140`                                                            | 几何、字体、hover 一致；**偏离**：`margin: 0`，Raft `mb-1` 4px（活体：Raft margin-bottom 4，RAH 0）                                                                                                                      |
| `.side-title` 容器                            | `styles.css:141-148`                                                            | 高 24、mb 4、px 8 一致；容器上的 12px 大写字体属冗余（子按钮自带）；**待测**：Raft 容器 `mt-3` 12px 与 RAH `.side-section + .side-section { margin-top: 12px }` 是否在所有分区（含第一个分区、已置顶、联合频道空态）等价 |
| `.rah-sidebar-disclosure`                     | `identity-interactions.css:2-40`                                                | 12/16 700 大写 1.2px、gap 4、hover ink-70：一致；color `--ink`(#141111) 对 Raft 纯黑：微差，本批不动（属全局墨色议题）                                                                                                   |
| `.count` / `.rah-sidebar-disclosure > .count` | `styles.css:149`、`identity-interactions.css:30-33`                             | **偏离**：字重 400，Raft 700                                                                                                                                                                                             |
| 排序钮                                        | `workspace-navigation.tsx:~516` 使用 `task-filter-trigger rah-interaction-flat` | **偏离**：借用了任务页筛选器类：pad 4、display grid、gap 8、图标 12、hover 多出 `border-color`；Raft 为 `.btn-flat-sm size-6 p-0`，pad 0，图标 14                                                                        |
| 新建钮                                        | `workspace-navigation.tsx:541`、`product.css:2435-2449`                         | **偏离**：文本 `+` Space Mono 18/800；Raft 为 lucide `plus` 14px（sprite 已有 `raft-icon-plus`）                                                                                                                         |
| 扁平钮 focus-visible                          | 全局 `styles.css:48` 给 2px 描边                                                | **偏离**：Raft `.btn-flat-sm:focus-visible` 明确 `outline-style: none`，只用底色 black/5 表示                                                                                                                            |
| `.side-actions button`                        | `styles.css:153-157`                                                            | 已正确建模 `.btn-flat-sm`（pad 0、图标 14、hover/active/focus 底色），但排序钮与新建钮**没有使用它**                                                                                                                     |

## 批次 3 的改动边界

第一步：同值 token 替换。为本家族涉及的字面量引入同值 token：`--control-6`（已有）、`--icon-3-5`（已有）、`--space-1/2`（已有）、新增 `--space-1-5: 6px`（Tailwind gap-1.5）、`--space-3: 12px`（mt-3）、`--icon-3: 12px`（chevron）、`--tracking-widest: 0.1em` 若尚未以该名存在则对齐现有 `--tracking-widest`。只替换本文件列出的规则，浏览器门禁基线 diff 必须为空。

第二步：有双边证据的差异，逐条独立提交，每条重跑校验器与门禁：

1. `.channel-row .row-icon` 18 → 14（`--icon-3-5`）。私信头像 18 不动。
2. 私信行描述字重：删除 `small` 上的 `font-weight: 400`，继承行的 500。
3. `.sidebar-bookmarks` 加 `margin-bottom: var(--space-1)`。
4. `.count` 与 `.rah-sidebar-disclosure > .count` 字重 400 → `var(--fw-bold)`。
5. 排序钮与新建钮改用同一个扁平迷你钮原语：新增共享类（建议 `.flat-btn-sm`，按 `.btn-flat-sm` 的冻结声明逐字建模：24×24、pad 0、inline-flex 居中、`--sans` 700、color ink-70、hover/active/focus-visible 底色、`:focus, :focus-visible { outline: none }`、disabled .4 + pointer-events none、transition colors .1s），TSX 里去掉 `task-filter-trigger` 借用，新建钮改为 `<svg><use href="…#raft-icon-plus"/></svg>` 14px 并保留 `aria-label="新建频道"`。`.side-actions button` 若与新原语重复，迁移到新原语后删除。
6. `.channel-row` 增加响应式分支：`@media (max-width: 767.98px) { padding-block: var(--space-2) }`、`@media (max-height: 600px) { padding-block: var(--space-1) }`，与 Raft 的 `md:` 断点（768px）一致；门禁在 390×844 断言行高 40。

## 挂起（无同条件证据，不改）

| 项                                                                                                 | 需要的证据                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 分区标题 `mt-3` 与 RAH 分区间距的等价性（第一分区、已置顶空态、联合频道空态）                      | 两侧对每个分区标题测 margin-top 与相对上一元素的距离 |
| 390px 下打开频道时侧栏是否隐藏（Raft 隐藏并显示频道页，RAH 显示列表）                              | 属移动端导航行为，另立项                             |
| 分区标题按钮 `color` `#141111` vs 纯黑                                                             | 全局墨色议题，另立项                                 |
| 用户要求保留的"已置顶 0 / 将频道或私信拖到这里置顶"空态与提示文字尺寸（`.side-hint` 12/16.5 mono） | Raft 对应元素类名与计算值                            |

## 自动检查要求

沿用批次 2 的六条约束。夹具需覆盖：未选中行、选中行、私信行（含头像与描述）、已保存行、分区标题行（标题、计数、排序钮、新建钮，含 disabled 排序钮）；状态：base / hover / active / focus-visible / disabled；视口 1440×900、390×844、1440×600（触发 `max-height` 分支）。`ratchet.json` 新增 `sidebar-row` 条目，其值同样以 HEAD 为上限（首次登记前为 0，校验器会红，直到人提交）。

## 执行记录（2026-09-11，批次 3）

机器可读副本：`packages/ui-tokens/specs/sidebar-row.spec.json`（32 条 rules / 19 条 overrides / 13 条 pending）；
夹具 `apps/web/test/sidebar-row-spec-fixture.{html,tsx}`；门禁 `scripts/run-sidebar-row-spec-browser-gate.mjs`；
`packages/ui-tokens/specs/ratchet.json` 新增 `sidebar-row` 条目（首次登记，HEAD 尚未提交，校验器按约定报红）。

### 已执行

- 第一步 同值 token 替换：新增 `--space-1-5: 6px`、`--space-3: 12px`、`--icon-3: 12px`（`tokens.brutal.css`），
  并把本文件列出的规则中的 6/8/12/24/14 字面量换成 token。门禁 `--compare` 基线 diff 为空。
- 改动边界 1：`styles.css` `.channel-row .row-icon` 18 → `var(--icon-3-5)`（14）。
- 改动边界 3：`styles.css` `.sidebar-bookmarks` `margin: 0` → `margin: 0 0 var(--space-1)`。
- 改动边界 4：`styles.css` `.count` 与 `identity-interactions.css` `.rah-sidebar-disclosure > .count` 字重 400 → `var(--fw-bold)`。
- 改动边界 6：`styles.css` 给 `.channel-row` 加 `@media (max-width: 767.98px) { padding-block: var(--space-2) }`
  与 `@media (max-height: 600px) { padding-block: var(--space-1) }`。

### 停止执行并退回规格（未静默偏离）

- 改动边界 2（私信行描述字重）：规格把规则定位在 `channel-extras.css`，实际在 `apps/web/src/chat-surface.css:45`
  （`font: 400 12px/16px var(--sans)`，实测生效），另有 `apps/web/src/product.css:1241` 同选择器声明
  `font: 10px/1.25 var(--mono)`。两条规则谁是所有者未裁定，且两个文件都不在本批改动边界内。
  登记为 pending `direct-small-font-weight`。
- 改动边界 5（排序钮 / 新建钮改用 `.btn-flat-sm` 原语）：规格把排序钮定位在 `workspace-navigation.tsx:~516`，
  实际类名由 `apps/web/src/components/discovery-filter.tsx:184` 对 `variant="sidebar"` 生成（`task-filter-trigger`），
  样式在 `apps/web/src/message-social.css:239` 与 `apps/web/src/product.css` 的 `.task-filter-trigger`。
  改这条会同时改任务页筛选器，且三处都不在本批改动边界内。登记为 pending
  `sort-trigger-borrows-task-filter` 与 `create-button-not-btn-flat-sm`。TSX 未改，`aria-label="新建频道"`
  与排序菜单行为保持原样。

### 门禁视口的偏差

改动边界 6 要求「门禁在 390×844 断言行高 40」。RAH 在 `styles.css` 的
`@media (max-width: 760px)` 里整条 `.sidebar { display: none }`，而该断点正是本文件挂起表的
「390px 下侧栏是否隐藏」。门禁因此在 767×844 读移动端 padding 分支（padding-block 8、行高 40），
390×844 仍然采集，采集到的就是「未渲染」（client-height 0）——正是那条挂起项需要的证据。
登记为 pending `narrow-sidebar-hidden-390`。

### 校验器修复

`scripts/ui-component-spec.mjs` 的 `parseCssRules` 让一个分组选择器里的所有选择器共用同一个
declarations 对象，而 `componentSpecErrors` 又用 `Object.assign` 就地合并重复选择器，
于是 `.a, .b { x }` 之后再出现 `.b { y }`，`.a` 也会凭空多出 `y`。
在 `apps/web/src/product.css` 的 `.rah-direct-room-fallback, .rah-direct-header-fallback`
上实际触发。已改为每个选择器各持一份，并补测试
`a grouped selector's declarations do not leak to its siblings`。修复后 `sq-btn` 规格仍成立。

## 批次 3b：对退回三项的裁决（Fable，2026-09-11 活体复测）

1. **私信描述字重**（原改动边界 2 文件定位有误）。生效规则是 `apps/web/src/chat-surface.css:45-50`（`font: 400 12px/16px var(--sans)`），`apps/web/src/product.css:1241-1246` 的 `font: 10px/1.25 var(--mono)` 被完全覆盖，是死规则。裁决：`chat-surface.css` 为所有者，字重改为 `var(--fw-medium)`（Raft 继承 500）；删除 `product.css` 那条死规则中被覆盖的 `font` 与 `color` 声明，保留其 `overflow/text-overflow` 若仍生效（需门禁证明计算样式不变）。改动边界扩展到这两个文件的这两条规则。
2. **排序钮与新建钮**（原定位有误）。排序钮由 `apps/web/src/components/discovery-filter.tsx:184`（`variant === "sidebar"`）渲染，侧栏专属样式所有者是 `apps/web/src/message-social.css:239-254`（`.rah-sidebar-sort > button`，pad 4、svg 12）。裁决：只改该侧栏所有者，不碰 `task-filter-trigger` 通用规则：`padding: 0`、svg `var(--icon-3-5)`；新建钮 `workspace-navigation.tsx:541-547` 的文本 `+` 改为 `<svg aria-hidden="true"><use href="…#raft-icon-plus" /></svg>`（14px），`product.css:2435-2449` 的 `.rah-side-create` 删除 `font-family/font-size/font-weight`，保留 24×24 与 ink-70。两钮的 `:focus-visible` 在侧栏作用域内加 `outline: none`（Raft `.btn-flat-sm:focus, :focus-visible { outline-style: none }`，以底色 black/5 表示聚焦），作用域限定 `.rah-sidebar-sort > button` 与 `.rah-side-create`，不影响任务页筛选器。
3. **侧栏隐藏断点**。活体：Raft 在 764px 隐藏侧栏（行宽 0，行 padding-block 8），772px 显示（行宽 211，padding 4）；RAH 在 764px 仍显示（`display: flex`，行宽 748）。Raft 断点是 Tailwind `md` = 48rem = 768px（冻结 CSS 中 `@media(min-width:48rem)` 11 处）。裁决：`packages/ui-tokens/src/neo-brutalist/styles.css:474` 与 `:1075` 的 `@media (max-width: 760px)` 改为 `767.98px`，门禁在 764×900 断言 `.sidebar` 为 `display: none`、在 772×900 断言可见。其他文件里的 760 断点不在本批范围，登记为挂起。
4. **390px 下 RAH 以列表替代频道页**仍挂起（导航行为）。
