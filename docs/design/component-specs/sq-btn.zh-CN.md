# 组件规格：方形硬阴影按钮 `.sq-btn` / `.send-btn`（试点）

状态：试点批次 2（校验器加固）。本文件是该组件的唯一规格来源；机器可读副本在
`packages/ui-tokens/specs/sq-btn.spec.json`，由 `scripts/ui-component-spec.mjs` 在
`npm run check:ui-library` 中校验。规格、例外与覆盖样式必须先写进本文件与 JSON，再改 CSS。

## 上游来源

| 项                | 值                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官网发布          | `release/v1.12.0`，commit `f1a9a6b83add3db8f44320c753d2f8d8b03b8f06`，built 2026-09-04T11:56:32Z                                                                                                                                                                                                                                                                  |
| CSS 文件          | `docs/evidence/raft-web-20260908-current/index-D8Neh8lc.css`，sha256 `11f78ea36cb9e35639a08232b61a4523355c5242717b4abe48ec5ff0fc230f25`                                                                                                                                                                                                                           |
| JS bundle         | `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，sha256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`                                                                                                                                                                                                                            |
| 上游选择器        | `.btn-brutal-sm`（73 处调用），配合 Tailwind 工具类决定尺寸、内边距、底色、文字                                                                                                                                                                                                                                                                                   |
| Tailwind 主题常量 | `--spacing: .25rem`（4px）、`--color-black: oklch(0% 0 0)`、`--color-white: oklch(100% 0 0)`、`--color-brutal-black: #141111`、`--color-brutal-pink: #fe7da8`、`--font-display: "Raft Quote Glyphs","Space Grotesk",system-ui,sans-serif`、`--font-weight-bold: 700`、`--tw-border-style: solid`、`--default-transition-timing-function: cubic-bezier(.4,0,.2,1)` |

## 上游声明（逐字来自 CSS）

| 状态                         | 声明                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 基态 `.btn-brutal-sm`        | `border: 2px solid var(--color-black)`；`font-family: var(--font-display)`；`font-weight: 700`；`box-shadow: 2px 2px 0 #141111`；`transition: all .1s cubic-bezier(.4,0,.2,1)` |
| `:hover`                     | `translate: 0 -1px`；`box-shadow: 4px 4px 0 #141111`                                                                                                                           |
| `:active`                    | `translate: 1px 1px`；`box-shadow: 1px 1px 0 #141111`                                                                                                                          |
| `:disabled`                  | `pointer-events: none`；`opacity: .4`；`box-shadow: 2px 2px 0 #141111`；`transform: none`                                                                                      |
| `:focus-visible`（全局规则） | `outline: 2px solid #000`；`outline-offset: 2px` — **待活体确认**，见"挂起项"                                                                                                  |
| `[data-theme=elegant]`       | RAH 无该主题，不适用                                                                                                                                                           |
| `@media`                     | 冻结 CSS 中 2 条 media 规则含 `btn-brutal`，均为 elegant 主题或 `md:hidden` 显示切换，不改变本组件几何                                                                         |

## 上游尺寸变体（bundle 中的类组合）

| 变体            | 类组合                                                               | 几何                         | 出现次数              | RAH 对应                                     |
| --------------- | -------------------------------------------------------------------- | ---------------------------- | --------------------- | -------------------------------------------- |
| 图标方钮 28     | `btn-brutal-sm flex size-7 items-center justify-center`              | 28×28，图标 14               | 12                    | `.sq-btn` 基态、`.send-btn`                  |
| 输入区取件钮 26 | `btn-brutal-sm bg-white p-1`，内含 14px lucide 图标                  | 14 + 4×2 + 2×2 = 26          | 15                    | `.composer-bar .sq-btn`                      |
| 图标方钮 24     | `btn-brutal-sm inline-flex size-6 …`                                 | 24×24                        | 2                     | `.sq-btn.sm`                                 |
| 弹窗关闭 32     | `btn-brutal-sm … p-1` 内含 20px 图标                                 | 20 + 8 + 4 = 32              | 见 `product.css` 注释 | `.rah-agent-reset-dialog > header .sq-btn`   |
| 发送钮          | `btn-brutal-sm flex size-7 … bg-brutal-pink p-0 disabled:opacity-30` | 28×28，粉底，禁用 .3         | 1                     | `.send-btn`                                  |
| 文本钮          | `btn-brutal-sm bg-white px-2 py-1.5 text-xs` 等                      | 高 12×(16/12) + 6×2 + 4 = 32 | 多种                  | RAH 无对应（`.sq-btn.wide/.members` 零调用） |

## RAH 现状（规格化前）

| 文件:行                                                   | 规则                                                                                                                        | 与上游关系                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/ui-tokens/src/neo-brutalist/styles.css:227-235` | `.sq-btn` 基态：28×28、`var(--bd)`、`var(--shadow-s)`、`transition: all var(--transition-fast)`；无 font-family/font-weight | 尺寸、边框、阴影、时长一致；缺 `font-weight: 700` 与 `font-family`                                              |
| `styles.css:237`                                          | `.sq-btn svg { 16px }`                                                                                                      | 上游图标由 lucide `size` 属性决定（14/16/20），RAH 用 CSS 定；实测 header 图标两侧均 14px，说明有更具体规则覆盖 |
| `styles.css:238-239`                                      | hover 阴影 m、active 位移+阴影 press                                                                                        | 一致（位移由 interaction-state 提供）                                                                           |
| `styles.css:240-241`                                      | `.sq-btn.members`、`.sq-btn.wide`                                                                                           | 全仓零调用                                                                                                      |
| `styles.css:242-243`                                      | `.sq-btn.sm` 24px，svg 13px                                                                                                 | 24 一致；图标 13 无上游证据                                                                                     |
| `styles.css:246`                                          | `.composer-bar .sq-btn` 26px                                                                                                | 一致，但写成实测常量而非 `p-1 + 14` 的结构                                                                      |
| `styles.css:422-432, 1086`                                | `.send-btn` 粉底 28，disabled `.3`                                                                                          | 一致                                                                                                            |
| `interaction-state.css:47-60`                             | hover `translateY(-1px)`、active `translate(1px,1px)`、timing cubic                                                         | 一致                                                                                                            |
| `interaction-state.css:86-88`                             | `:disabled:hover` 归位                                                                                                      | 上游用 `pointer-events: none` 达到同一效果                                                                      |
| `apps/web/src/product.css:301-304`                        | `.rah-product-shell button:disabled { cursor: not-allowed; opacity: .45 }`                                                  | 全局应用层规则，对本组件构成未登记覆盖：上游是 `.4` + `pointer-events: none`                                    |
| `product.css:2581-2590`                                   | 重置弹窗关闭钮 32/20                                                                                                        | 已登记的合理覆盖（注释给出 Raft 来源）                                                                          |
| `product.css:4081-4083`                                   | 窄屏隐藏 `.head-actions .sq-btn:not(.rah-channel-options)`                                                                  | 响应式分支，无上游证据，挂起                                                                                    |
| `styles.css:48-51`                                        | 全局 `:focus-visible { outline: 2px solid var(--black); outline-offset: 0 }`，注释称"实测无 offset"                         | 与冻结 CSS 的 `outline-offset: 2px` 冲突，挂起                                                                  |

## 批次 1 的改动边界

第一步：**同值 token 替换**，计算样式与布局必须逐项不变。
新增 token（值取自 Tailwind 主题，不是实测）：`--space-1: 4px`、`--space-2: 8px`、
`--control-6: 24px`、`--control-7: 28px`、`--control-8: 32px`、`--icon-3-5: 14px`、
`--icon-4: 16px`、`--icon-5: 20px`。`.composer-bar .sq-btn` 的 26px 改写为
`calc(var(--icon-3-5) + 2 * var(--space-1) + 2 * var(--bw-2))`，`--bw-2: 2px` 同时成为 `--bd` 的宽度来源。
只改本文件列出的规则，不碰其他选择器。

第二步：**有双边证据的差异**，逐条独立提交。

1. `.sq-btn` 基态补 `font-family: var(--sans)`、`font-weight: var(--fw-bold)`。证据：上游 `.btn-brutal-sm` 基态。RAH 现有 25 个 `.sq-btn` 调用点均为纯图标，计算样式仅字重字段变化，无几何影响；浏览器门禁须证明这一点。
2. `.sq-btn:disabled`、`.send-btn:disabled` 补 `pointer-events: none`、`opacity: .4`、`box-shadow: var(--shadow-s)`、`transform: none`，并以更高优先级压过 `product.css:301` 的 `.45`，**不修改**那条全局规则本身（管理页的灰色禁用状态由它承担，用户要求保留）。`.send-btn:disabled` 保持 `.3`，证据：上游发送钮自带 `disabled:opacity-30`。
3. 删除 `.sq-btn.members`、`.sq-btn.wide`：全仓零调用，且上游文本钮几何（高 32）与其不同，留着只会诱导误用。

## 已裁决项（2026-09-11 活体双边，已登录 app.raft.build，1440×900 与 390×844）

| 项                 | 测得                                                                                                                                                            | 裁决                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| focus-visible 轮廓 | Raft `.btn-brutal-sm`（输入区取件钮）键盘聚焦：`outline: solid 3px rgb(20,17,17)`，offset 0；RAH `.sq-btn`（添加文件）：`solid 3px #141111`，offset 0。两侧相同 | 组件层面已对齐，不改。冻结 CSS 与两侧源码均无显式 3px 声明，来源待记入 JSON（疑为 `outline-style: solid` 配默认 `medium` 宽度与 currentColor）。全局 `:is(button,…):focus-visible` 2px 规则与 Raft 全局 `2px #000 offset 2px` 的差异属另一组件，列为后续项 |
| 390px header 方钮  | Raft 搜索钮 x=308 与设置钮 x=342 均显示；RAH `搜索当前对话` 为 `display: none`（`product.css:4081-4083`）                                                       | 有证据的偏离：删除该 media 规则，浏览器门禁 390px 分支断言搜索钮可见                                                                                                                                                                                       |
| 发送钮禁用态       | Raft：`opacity .3`、`pointer-events none`、阴影 2px                                                                                                             | 与规格中 `.send-btn:disabled` 例外一致                                                                                                                                                                                                                     |

## 仍挂起（无同条件证据，不改）

| 项                                    | 需要的证据                     |
| ------------------------------------- | ------------------------------ |
| `.sq-btn.sm svg` 13px                 | 上游 `size-6` 变体内图标尺寸   |
| `.sq-btn svg` 16px 与实测 14px 的关系 | 列出所有覆盖该属性的规则后再定 |
| 全局 focus-visible 2px 规则的 offset  | 属通用聚焦协议，另开组件规格   |

## 自动检查要求

`scripts/ui-component-spec.mjs` 读取 `packages/ui-tokens/specs/*.spec.json`：

1. 解析 `packages/ui-tokens/src/neo-brutalist/**/*.css` 与 `apps/web/src/**/*.css`，展开 `var()`（含 `calc`），对规格中每个 `selector + state` 断言解析后的声明与期望值逐项相等。
2. 枚举所有选择器命中本组件类名的规则（含 `@media` 内），凡不在规格 `rules` 或 `overrides` 中登记的，检查失败。登记项必须带 `source`（证据文件路径或 `main.js@offset`）与 `reason`，缺一即失败。
3. 例外不能靠加白名单绕过：`overrides` 条目数记录在 JSON 的 `overrideBudget`，新增条目时若 `source` 不指向 `docs/evidence/` 或上游 bundle 位置，检查失败；预算值只允许在评审中下调。
4. 浏览器门禁 `scripts/run-sq-btn-spec-browser-gate.mjs`：在真实 Chrome 中对 `.sq-btn`、`.composer-bar .sq-btn`、`.sq-btn.sm`、`.send-btn` 采集基态、hover、active、disabled、focus-visible 五种状态在 1440×900 与 390×844 的计算样式，与规格期望值比对；token 替换提交前后各跑一次，差异必须为空。

## 批次 1 执行记录（2026-09-11）

机器可读规格：`packages/ui-tokens/specs/sq-btn.spec.json`；
校验器：`scripts/ui-component-spec.mjs`（已接入 `npm run check:ui-library`）；
浏览器门禁：`scripts/run-sq-btn-spec-browser-gate.mjs`，
夹具 `apps/web/test/sq-btn-spec-fixture.{html,tsx}`。

### 本文件与实测不符之处（未擅自按本文改，按实测记录）

1. **`.sq-btn.members` / `.sq-btn.wide` 并非「全仓零调用」。**
   `packages/raft-ui-snapshot/reference/index.html:161,461` 与 `slack.html:180,480,791`
   共 7 处使用。但该参考快照自带冻结的 `reference/styles.css`（2026-08-27，与
   `packages/ui-tokens` 的副本无关），且 `apps/web/test/responsive-shell-parity-contract.test.ts:151`
   用 `assert.doesNotMatch` 明确禁止产品里出现 `sq-btn members`。
   产品调用点确为零，因此仍按第二步第 3 条删除，但「全仓零调用」的说法不成立。

2. **`.send-btn:disabled` 的 `.3` 在改动前并未生效。**
   `styles.css:1086` 的 `.send-btn:disabled`（0,2,0）被
   `product.css:301` 的 `.rah-product-shell button:disabled`（0,2,1）压过，
   门禁基线实测 `opacity: 0.45`。第二步第 2 条落地后才真正是 `.3`。
   本文「`product.css:301` … 对本组件构成未登记覆盖」低估了影响面：
   它同时吃掉了发送钮的例外。

3. **`.sq-btn.sm` 永远拿不到 hover 阴影。**
   `styles.css` 中 `.sq-btn.sm { box-shadow: var(--shadow-s) }`（0,2,0）
   排在 `.sq-btn:hover`（0,2,0）之后，门禁实测 24px 变体 hover 仍为 2px，
   其余变体为 4px。本文未提及；已记入 JSON `pending` 的 `sm-hover-shadow`，本批不改。

4. **focus-visible 的实测宽度是 2px，不是 3px。**
   门禁在 `.rah-product-shell` 内键盘聚焦 `.sq-btn`，
   实测 `outline: 2px solid oklch(0 0 0)`、`outline-offset: 0`，
   由 `styles.css:48` 的通用 `:is(button, a, input, …):focus-visible` 规则产生。
   与 2026-09-11 活体记录的「双边同为 3px solid #141111、offset 0」不一致：
   3px #141111 = UA `medium` 宽度 + `currentColor`，说明那次测量所在的界面上
   `styles.css:48` 没有胜出。未调 outline，记为 `pending` 的
   `focus-outline-width-2-vs-3`，需要补测量来源界面与元素。

### 已裁定并落地的差异

- 窄屏隐藏：`product.css` 原 `@media (max-width: 767px)` 内的
  `.head-actions .sq-btn:not(.rah-channel-options) { display: none }` 已删除。
  证据：活体双边 2026-09-11（Raft 390×844 下 `搜索此频道` x=308 与
  `频道详情与设置` x=342 均可见）+ `index-BVfbaScj.js` 中 header 的
  `btn-brutal-sm` 不带 `md:`/`hidden` 工具类。门禁在 390×844 断言该钮可见。
  本文「挂起项」中的该条随之关闭。

### 协调者复核（Fable，2026-09-11）

- 亲自重跑：`node --test scripts/ui-component-spec.test.mjs` 12 通过；`npm run check:ui-library` 输出 `Component specs hold: sq-btn`；`node scripts/run-sq-btn-spec-browser-gate.mjs --expect-spec` 输出 `matches 42 spec browser expectations`；`git diff --check` 通过。
- diff 逐行复核：改动限于 `tokens.brutal.css`、`styles.css`、`interaction-state.css`、`product.css` 中规格列出的规则与 `package.json` 一行；未触碰 `product.css:301` 全局禁用规则与管理页样式。
- 校验器已知盲点：只登记"选择器文本含 `.sq-btn` / `.send-btn`"的规则。通过其他类名命中同一元素的规则不在其视野内，例如 `channel-extras.css:259` 的 `.rah-composer-pickers .rah-composer-picker:disabled { opacity: .4; pointer-events: none }`。下一批需让校验器按夹具中的真实元素反查全部命中规则，而不是按类名文本匹配。
- focus-visible 分歧的现状：夹具中的 `.sq-btn` 实测 `2px oklch(0 0 0)`（`styles.css:48` 通用规则）；正式实例页面上的 `.sq-btn.rah-composer-picker` 与 Raft 的 `.btn-brutal-sm bg-white p-1` 实测均为 `3px #141111`。两次测量的元素与构建不同，`pending: focus-outline-width-2-vs-3` 保留，需在同一构建上对 header 方钮与取件钮各测一次。
- 行为差异另记：Raft 取件钮在同页面为启用态（opacity 1），RAH 为禁用态（0.4）。这是上传能力判定的行为问题，不属本组件样式规格。

## 批次 2：校验器加固（用户 2026-09-11 三条攻击复现成立）

复现结果（修复前）：`--control-7: 99px` 通过；`cssSha256` 改为全零通过；`overrideBudget` 加 5 并新增伪例外通过。

硬性要求，逐条对应一个先失败再通过的测试：

1. **期望值不得引用 RAH 自己的 token。** `rules[].declarations` 与 `browserExpectations` 只允许上游字面量（`28px`、`2px solid oklch(0% 0 0)`、`700`）。校验器把 RAH 的 `var()`/`calc()` 解析到字面量后与之比较；出现 `var(` 的期望值本身就是错误。
2. **token 值由上游派生并校验。** 新增 `tokenContract`：每个几何 token 给出上游推导式（如 `--control-7 = --spacing * 7`，`--icon-3-5 = lucide size 14`），校验器从证据 CSS 里解析 `--spacing: .25rem` 等主题常量算出字面量，与 `tokens.brutal.css` 的实际值比较。改 28 为 99 必须失败。
3. **来源必须实算。** 校验器对 `provenance.cssFile` / `jsFile` 计算 sha256 并与登记值比对，文件不存在或哈希不符即失败；并解析证据 CSS，断言登记的每条上游规则（`.btn-brutal-sm` 基态、`:hover`、`:active`、`:disabled`）在其中存在且声明与规格引用一致。规格从"手抄"变成"可被证据反证"。
4. **预算与登记分离、只降不升，且以已提交版本为准。** 预算移到 `packages/ui-tokens/specs/ratchet.json`；校验器用 `git show HEAD:packages/ui-tokens/specs/ratchet.json` 读取已提交值，工作树里的 `overrides` 数、`pending` 数与预算值任一高于已提交值即失败；`ratchet.json` 与 spec 同 HEAD 比较，工作树抬高预算无效。仓库不在 git 中或无 HEAD 版本时视为预算 0。无 HEAD 版本的新组件首次登记走同一条路：先以 0 预算提交空 ratchet，再由人提交预算。
5. **登记的例外必须能被反证。** 每条 `override` 与 `pending` 需含 `evidenceNeeded`（需要什么证据才能关闭）与 `since`（登记日期）；同一 `pending` id 被多条 override 引用时计一次。
6. **命中范围按元素而非类名文本。** 校验器对每条规格规则用夹具 DOM（`apps/web/test/sq-btn-spec-fixture.html`）中的对应元素，静态枚举所有能匹配该元素的规则（含祖先组合选择器与 `@media`），凡影响规格属性且未登记的即失败。`channel-extras.css:259` 对取件钮的禁用规则应被此项捕获并要求登记或裁决。

## 批次 2 执行记录（2026-09-11）

六条要求逐条落地，每条先复现绕过、再补测试。测试文件
`scripts/ui-component-spec.test.mjs`（28 个用例，已接入
`npm run test:ui:component-spec` 与 `npm run check`）。

### 复现（加固前，三条全部通过校验器）

1. `tokens.brutal.css` 的 `--control-7` 改成 `99px` → `Component specs hold: sq-btn`。
2. `sq-btn.spec.json` 的 `provenance.cssSha256` 改成 64 个 0 → 通过。
3. `overrideBudget` 加 5 并追加一条 `source: "fake"` 的伪例外 → 通过。

### 逐条对应

| 要求 | 实现                                                                                                                                                                                                                       | 测试                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `rules[].declarations` 全部改写为上游字面量；期望值含 `var(` 即报错。归一化形式见 `scripts/ui-component-spec-normalize.mjs` 头注释                                                                                         | `req1: an expectation that names a RAH token is itself the failure`、`req1: a browserExpectation…`                                                                 |
| 2    | 新增 `tokenContract`（17 个 token），从证据 CSS 的 `--spacing: .25rem` 等主题常量重算字面量                                                                                                                                | `req2: a geometry token is recomputed…`、`req2: the real sq-btn tokenContract…`                                                                                    |
| 3    | `node:crypto` 实算两个证据文件的 sha256；用同一条规则遍历器解析证据 CSS，比对 `upstreamRules` 引用的四条 `.btn-brutal-sm` 规则                                                                                             | `req3: provenance sha256 is computed…`、`req3: a misquoted upstream declaration…`、`req3: a missing evidence file…`                                                |
| 4    | 预算移入 `packages/ui-tokens/specs/ratchet.json`，校验器用 `git show HEAD:` 读已提交值；spec 里再写 `overrideBudget` 直接报错                                                                                              | `req4: raising the working-tree budget…`、`req4: an uncommitted ratchet counts as zero…`、`req4: the budget no longer lives in the spec`                           |
| 5    | 每条 `override` 与 `pending` 必须带 `since` 与 `evidenceNeeded`；`pending` id 重复报错                                                                                                                                     | `req5: every override and pending…`、`req5: the shipped spec carries…`                                                                                             |
| 6    | 浏览器门禁新增 `--report-matching-rules`，由 Chrome 的选择器引擎对夹具每个 `data-probe` 元素反查全部命中规则，结果提交为 `packages/ui-tokens/specs/sq-btn.matched-rules.json`；静态校验器按 CSS 输入内容哈希判定其是否过期 | `req6: a rule that matches the element…`、`req6: a matched-rules report is refused…`、`req6: element defaults…`、`req6: the shipped report proves channel-extras…` |

### 要求 6 的裁决

`channel-extras.css:255/258/259` 通过 `.rah-composer-picker`（产品里与 `sq-btn`
同元素，见 `packages/ui-web/src/neo-brutalist/composer-attachment-pickers.tsx:48`）
命中本组件，批次 1 的类名文本视野看不见它们。三条均裁定为**与上游同值的重复声明**
（26 = 14 + 2×4 + 2×2、图标 14、禁用态 `.4` + `pointer-events: none`
等于上游 `.btn-brutal-sm:disabled`），因此登记进 `rules` 而非 `overrides`，
例外数不变（6）。夹具补了 `composer-picker` / `composer-picker-disabled`
两个探针元素，否则该规则没有可反查的宿主。

### 已知边界

- **元素默认规则不在本规格视野内。** 剥掉 `:where()` 后不含类/id/属性的选择器
  （`*`、`button`、`:where(.rah-product-shell, …) :where(button)`）按重置层处理，
  不要求登记。它们仍能影响本组件*自身未声明*的属性（当前只有 `font-size`）。
- **`--allow-uncommitted-ratchet` 会解除要求 4。** 它只用于 ratchet 提交前的
  本地报告运行，绝不进 `package.json`。
- **matched-rules 报告会被并发的 CSS 改动作废。** 内容哈希一变就必须重跑门禁；
  这是设计意图，但在有人同时改 `packages/ui-tokens/src/**/*.css` 时会反复失效。
