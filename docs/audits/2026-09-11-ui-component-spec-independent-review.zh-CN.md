# UI 尺寸规格试点：独立复核

范围：Claude 本地会话 `4a75263a-b39d-4fe0-867b-f724ea97754f` 最新完成报告与当前未提交的 sq-btn/send-btn 试点。只审查，不与工作 Agent 通信，不改其实现。当前结论是试点有效，但静态门禁不等于独立的 Raft 尺寸或来源校验，不能宣布规格机制完全收口。

## 已核实

`packages/ui-tokens/specs/sq-btn.spec.json` 中的官方 CSS/JS 文件实际存在，SHA-256 与登记值一致。官方 CSS `.btn-brutal-sm` 确实包含 2px 边框、display 字体、粗体、2px 阴影、100ms transition；disabled 为 opacity .4、pointer-events none、2px 阴影。Claude 采用这些基础声明有来源，不是凭截图猜测。

独立运行 `node --test scripts/ui-component-spec.test.mjs`：12 项通过；`node scripts/run-sq-btn-spec-browser-gate.mjs --expect-spec`：42 项本地浏览器预期通过。这证明当前 fixture 与当前规格一致，不是本轮在线双边验收。hover 的最终值仍需考虑组合类与层叠，不能只拿基础选择器判产品实际结果。

## 尚未收口

1. **P2：静态尺寸校验自我引用。** `scripts/ui-component-spec.mjs` 同时用当前 tokens 解析实际值和 expected；规格宽高写 `var(--control-7)`。只在内存中把 token `28px` 改为 `99px`，检查仍返回空错误。现有 42 项浏览器断言可覆盖其采样状态，但静态门禁本身不能保证 token 不漂移。应对来源确定的 token 登记独立字面值，并加入变异测试。
2. **P2：来源未机器核实。** 只在内存中把 provenance.cssFile 改为不存在文件、cssSha256 改为 64 个零，检查仍通过。当前真实文件没有造假，但将来失效不会被检查发现。应验证文件存在、摘要及选择器，并以错误路径和错误摘要作失败测试。
3. **P2：预算尚非棘轮。** 检查仅比较当前 overrides 数量和当前 JSON 中的 overrideBudget；没有对比已有基线，也没有独立限制 pending 数量。把预算和例外一起增大不会被本规则阻止。因此“只能下降”目前是约定，不是机器保证。宜固定基线并验证新增待核验项，或准确降低门禁声明。

另有范围限制：选择器扫描依赖组件类名，未完整处理其他选择器影响及变量的作用域/层叠；Claude 已主动承认这一类限制，不作为新发现重复归责。focus、图标变体、业务 disabled 等仍应保留为待核验，不能因这 42 项通过而关闭。

建议先补齐这三个门禁缺口，再扩展下一页面族；无需推翻已做的 token 替换与按钮修复。全页面前后端对齐、真实模型协作与本次 UI 试点是不同的验收面。
