---
name: ui-component-spec
description: Use for any RAH OS UI size/style change, any new component being aligned against Raft, and any "why is this 7px not 8px" question. Covers tiered verification (what local evidence can settle vs. what needs a live bilateral experiment), writing docs/design/component-specs/<name>.zh-CN.md, the packages/ui-tokens/specs/<name>.spec.json schema, the same-value token baseline, the checker (scripts/ui-component-spec.mjs) and the real-browser gate (scripts/run-component-spec-browser-gate.mjs).
---

# 组件规格流程（ui-component-spec）

一次改动只处理**一个共享组件**。先登记，再取证，最后才改 CSS。

**取证是分级的，不是一刀切。**（2026-09-12 业主复审：旧版把「必须同条件双边实测」写成绝对要求，
既做不到也不诚实——冻结上游产物里 class → 声明是可以静态读出来的，而 hover 时序、焦点走向这类
运行时行为确实读不出来。下面的 A/B/C 三级取代那条绝对要求。）

## 取证分级

### A 级：冻结上游源码可判定 → 本地验证即可

参数能从 `docs/evidence/raft-web-*/` 的冻结产物里读出「class → 声明」的，
**不需要开实时双边**。做法：

- 在冻结 CSS/JS 里定位该 class 的规则，登记 `source` 为**文件 + 具体行/偏移**。
- 用校验器把 RAH 的值解析到同一个上游字面量：`node scripts/ui-component-spec.mjs`。
- 用真实 Chrome 门禁证明计算值确实等于它：`--expect-spec`。
- 汇报时写 **「本地验证」**，并写明是哪一行冻结源码。

典型 A 级：长宽 / 内边距 / 边框宽度与颜色 / box-shadow / 字号字重 / transition 时长 /
outline / 同值 token 替换。

### B 级：依赖运行时状态 → 必须同条件双边实验

值不写在 class 里、而是由运行时决定的，**必须**先做同条件双边实验再动：

- hover 的出现时机与延迟、动画中途的插值
- 焦点走向（Tab 顺序、focus 落到哪个元素、`:focus-visible` 是否命中）
- 响应式导航（断点两侧谁显示谁隐藏、侧栏折叠行为）
- disabled 的判定逻辑（什么条件下才 disabled）
- 分组与排序（分区怎么分、行怎么排）
- 时间格式化（相对时间 / 绝对时间 / 何时切换）

同条件的含义：**同一视口、同一主题、同一登录态、同一数据形状**，上游与 RAH 并排读
computed style，不读截图估读值，不读模型口述。

### C 级：措辞纪律

- 只有**真的做过实时并排比较**才可以写「双边验收」。
- 没做过就写 **「本地验证」**，并说明依据（冻结源码行 / 门禁输出）。
- 没有证据又想改的，写进 `pending`，不要写成 override，也不要写成「已验收」。

### 响应式采样规则

任何触及该组件的断点，**两侧都要采**：例如 `md`（768）必须同时采 **767 与 768**；
另外固定加 **1440×900** 与 **390×844**；组件若有 `max-height` 分支，该分支也要单独采一次
（例如 `1440×600`）。视口清单写在 `spec.gate.viewports` 里，门禁按它跑。

## 步骤

### 1. 划定组件与改动边界

- 选定一个共享组件（例如 `.sq-btn`、聊天侧栏行家族），列出它的类名集合。
- 只改这个组件的规则。顺手看到的其它偏差写进「挂起」，不在本批次改。

### 2. 按分级取证

- 先判定每个参数属于 A / B 级，再决定要不要开实时双边（见上「取证分级」）。
- 上游发布产物的 CSS/JS 冻结在 `docs/evidence/raft-web-*/`，其 sha256 由校验器计算，不是声明。
- 登记上游元素：**element / source 文件行 / version（release + commit）/ values / states**。

### 3. 写规格文档

`docs/design/component-specs/<name>.zh-CN.md`，固定小节：
`上游来源` → `上游声明（逐字来自 CSS）` → `RAH 现状` → `本批次的改动边界` → `挂起（无同条件证据，不改）` → `自动检查要求` → `执行记录`。

### 4. 写规格 JSON

`packages/ui-tokens/specs/<name>.spec.json`。字段清单与归一化规则见
`references/spec-schema.md`。要点：

- `rules[].declarations` 与 `browserExpectations` 只能写**上游字面量**，禁止出现 `var(`。
- 每条 `tokens` 都要在 `tokenContract` 里说明上游是怎么产生这个数的。
- 每条 `rules`/`overrides`/`pending` 都要有 `source` + `reason`（例外还要 `since` + `evidenceNeeded`）。
- `probes` 是探针清单的**唯一来源**（门禁与校验器都读它）：`{id, selector, disabled?, interactive?, capture?, coverage?}`。
  夹具里缺任何一个已声明探针，门禁**硬失败**，不跳过。
- `fixture`、`gateScript`、`fixtureMarkupFile` 把报告绑定到夹具字节、门禁程序字节与渲染后的 DOM。

### 5. 基线 → 同值令牌 → 有证据的差异

1. `--write-baseline`：先把当前计算值存成基线。
2. 把硬编码值换成**同值**令牌（先不改任何数值），再 `--compare`，diff 必须为空——这才叫证明「什么都没变」。
3. 只改「本级取证站得住」的项：A 级凭冻结源码行，B 级凭同条件双边实测。**不允许 7→8、15→14 这类顺手取整**。
4. `--expect-spec`：证明计算值等于规格里的上游字面量。

### 6. 例外与预算

- 白名单只能缩不能涨：新增 `overrides` 必须带 `source`（指向证据）+ `reason` + `since` + `evidenceNeeded`。
- 预算在 `packages/ui-tokens/specs/ratchet.json`，与 `git show HEAD:` 比对，工作区改动无效。
- ratchet 尚未提交时，`--uncommitted-ratchet-preview` 只是**预览**，不是模式：先让人审阅
  `docs/design/component-specs/baseline-2026-09-12.zh-CN.md` 再提交 ratchet。该 flag 永远不进 package.json。
- 不确定的写 `pending`，不要写成 override。

### 7. 跑检查

```
npm run check:ui-library
node scripts/ui-component-spec.mjs [--uncommitted-ratchet-preview]
node scripts/run-component-spec-browser-gate.mjs <component> --write-baseline <path>
node scripts/run-component-spec-browser-gate.mjs <component> --compare <path>
node scripts/run-component-spec-browser-gate.mjs <component> --expect-spec
node scripts/run-component-spec-browser-gate.mjs <component> --report-matching-rules
node --test scripts/ui-component-spec.test.mjs
npm run check:ui-catalog
```

`--report-matching-rules` 产出两个文件：`*.matched-rules.json`（按元素而非类名文本证明覆盖率）
与 `*.fixture-markup.json`（每个探针 React 渲染后的 `outerHTML`，目录页就渲染它）。
两者都带 CSS / 夹具 / 门禁脚本 / 渲染 DOM 四重摘要，任一改动都会让报告失效。

### 8. 用户指定的设计必须保留

紧凑的 Runtime 行、单行描述、对齐的勾选框、灰色的不支持态；不另开 Runtime 页面。
这些不因「与上游不一致」而改。

### 9. 共存检查

- 动手前 `git status --short`，收尾前再跑一次。
- 只改属于本批次的文件；别人正在编辑的文件不碰。
- 不 `git stash` / `git checkout` / `git commit`。

### 10. 汇报模板

```
本批次改了什么 + 依据（A 级：冻结源码文件行；B 级：同条件双边实测值）
取证级别与措辞（做过实时并排才写「双边验收」，否则写「本地验证」）
实际跑过的检查（命令 + 结果，不是「应该会过」）
仍存在的差异（挂起项 id + 为什么不改）
```

## 批次规则

- 一次只处理一个共享组件；一个批次一个组件。
- 动手前先登记上游：element、source（文件行）、version（release + commit）、values、states。
- 先做同值 token 替换，并用门禁 --compare 证明计算值一字未变，然后才谈改值。
- 取证分级：冻结上游源码可判定的参数走本地验证；依赖运行时状态的行为必须同条件双边实验。
- 没有实时并排比较就不写「双边验收」，写「本地验证」。
- 响应式必须采断点两侧（例如 md 的 767 与 768），外加 1440×900 与 390×844，以及任何 max-height 分支。
- 禁止顺手取整：不把 7 改成 8，不把 15 改成 14。
- 白名单只减不增：新增 override 必须带 source + reason + pending，预算只能通过已提交的 ratchet 下降。
- 保留用户指定的设计：紧凑的 Runtime 行、单行描述、对齐的勾选框、灰色的不支持态；不另开 Runtime 页面。
- 每批次汇报：改了什么 + 依据、实际跑过的检查、仍存在的差异。

## 参考

- 字段清单与归一化规则：`references/spec-schema.md`
- 可读目录（由 `scripts/build-ui-catalog.mjs` 生成）：`docs/design/ui-catalog.html`
