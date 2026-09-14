# `packages/ui-tokens/specs/<name>.spec.json` 字段清单

校验器：`scripts/ui-component-spec.mjs`。归一化：`scripts/ui-component-spec-normalize.mjs`。

## 顶层字段

| 字段                  | 类型     | 说明                                                         |
| --------------------- | -------- | ------------------------------------------------------------ |
| `component`           | string   | 组件 id，与文件名、gate 脚本名、`ratchet.json` 的 key 一致。 |
| `doc`                 | string   | 指向 `docs/design/component-specs/<name>.zh-CN.md`。         |
| `provenance`          | object   | 上游来源，见下。                                             |
| `classNames`          | string[] | 该组件的类选择器集合；覆盖率检查以此为起点。                 |
| `tokens`              | string[] | 该组件允许消费的令牌。                                       |
| `tokenContract`       | object[] | 每个几何令牌「上游怎么产生这个数」。                         |
| `upstreamRules`       | object[] | 逐字引自冻结证据 CSS 的上游规则，校验器会重新解析比对。      |
| `matchedRulesFile`    | string   | `--report-matching-rules` 产出的按元素覆盖率报告路径。       |
| `rules`               | object[] | 本组件的登记规则（期望值 = 上游字面量）。                    |
| `overrides`           | object[] | 登记的例外，受 ratchet 预算约束。                            |
| `pending`             | object[] | 未取证、明确不改的问题。                                     |
| `resolvedDivergences` | object[] | 已裁决并落地的差异（可选）。                                 |
| `browserExpectations` | object   | `"<viewport>/<probe>/<property>": "<期望计算值>"`。          |

## `provenance`

`release`、`commit`、`builtAt`、`cssFile`、`cssSha256`、`jsFile`、`jsSha256`、`selector`。
两个 sha256 由校验器用 `node:crypto` 现算，写错即失败。

## `rules[]` / `overrides[]`

`file`、`selector`、`state`（`base` / `hover` / `active` / `disabled` / `focus-visible` / 响应式条件）、
`source`、`reason`、`declarations`。
`overrides[]` 另有 `status`（`registered` | `registered-unresolved`）、`since`、`evidenceNeeded`，
`registered-unresolved` 还要用 `pending` 字段指回一条挂起 id。

## `pending[]`

`id`、`question`、`evidenceNeeded`、`since`。

## 硬约束

1. `rules[].declarations` 与 `browserExpectations` **不得出现 `var(`**——拿 RAH 令牌和自己比等于没比。
2. 每个几何令牌的值由 `tokenContract` 从冻结证据 CSS 里重算（`--spacing * n`、lucide `size` 属性、上游具名自定义属性）。
3. `provenance` 的 sha256 与 `upstreamRules` 都是现算/重解析，不是声明。
4. 计数与预算在 `ratchet.json`，与 `git show HEAD:` 比对；工作区里改预算无效（ratchet 未提交时 `--uncommitted-ratchet-preview` 只做预览，见 `docs/design/component-specs/baseline-2026-09-12.zh-CN.md`）。
5. 每条 override / pending 都要 `since` + `evidenceNeeded`，即例外必须可证伪。
6. 覆盖率按元素算，不按类名文本：`*.matched-rules.json` 列出每个 probe 实际命中的规则，
   任何触及规格属性的未登记规则都会失败；CSS 输入变化时该报告按内容哈希失效。

## 归一化（比较前两边都会走一遍）

1. 去首尾空白，连续空白折叠为一个空格；
2. 全部小写；
3. 逗号统一成 `, `，括号内侧不留空格；
4. 裸小数点补零：`.4` → `0.4`；
5. 零长度去单位：`0px` → `0`；
6. 颜色**只**通过一张极小的等价表折叠：`oklch(0% 0 0)` ↔ `#000000`、`oklch(100% 0 0)` ↔ `#ffffff`。
   其余颜色原样保留，真正的色差仍会失败。

## 门禁字段（2026-09-12 业主复审第 1、3 条新增）

| 字段                | 含义                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `probes`            | 探针清单的唯一来源：`{id, selector, disabled?, interactive?, hoverHost?, capture?, coverage?}`。夹具缺任一已声明探针，门禁硬失败；报告缺一个或多一个，校验器失败。 |
| `capture: false`    | 只参与覆盖率反查，不读计算样式（例如只由别的选择器命中的元素）。                                                                                                   |
| `coverage: false`   | 只读计算样式，不参与覆盖率反查（例如只为读响应式分支而存在的容器）。                                                                                               |
| `fixture`           | `{html, tsx}`：报告绑定到这两个文件的字节。                                                                                                                        |
| `gateScript`        | 产出报告的门禁程序路径；报告绑定到它的字节。                                                                                                                       |
| `fixtureMarkupFile` | 门禁导出的每个探针渲染后 `outerHTML`；目录页渲染它，校验器比对其 `structureSha256`。                                                                               |
| `gate`              | `{fixtureUrl, anchorProbe, settleMs, skipZeroWidth, viewports, properties}`：通用门禁的全部参数。                                                                  |
