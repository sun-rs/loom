# P110：结构化输出被付费门禁白名单拦截

2026-10-05，owner持续授权，干净源码 `6ecbfd701a8aa6d066ac59a466eb1ab0bc1fd9da`。Codex0.160.0 / gpt-6-luna / low，固定P97原生三轮＋Loom warm三轮计划。原生完成，产品首轮被本地门禁阻断，整批failed。[原始脱敏结果](2026-10-05-final-output-p110.json)。

门禁的 `turn/start` 参数白名单尚未接纳新增 `outputSchema`，日志明确为 `PAID_GATE_MODEL_DENIED Unsupported gate request: turn/start.outputSchema`。首个请求在转发前被拒，原生turn未admit；之后第二次attempt因session连续性要求拒绝，最终隔离。未静默更换session。两次attempt不是两次模型生成。

Kernel实证：零Room回复、final marker、ACK游标、usage row。没有有效产品答案或三轮质量/效率比较；不能把缺失测量填零宣布预算通过，也不能据此判断真实供应商不支持schema或模型未遵从schema。此前无付费护栏的免费生产链证据仍有效，但它没有覆盖这个入口遗漏。

原生三轮完成生成2/1/1，input22,115/13,641/13,972，合计49,728；cached34,048、uncached15,680、output855。实际turn_context均指定模型/low、同一session；首轮一次exec读取指定两文件，后两轮零工具，官方记忆关闭有逐轮spawn配置证据。整批已有真实原生消耗，不能说零费用失败。付费provider HTTP总请求和账单未独立捕获。

修复范围是让同款护栏只接纳Protocol导出的精确最终输出schema，继续拒绝宽化/不同schema、未知字段、未批准model/effort。先用真实CLI＋同款护栏＋loopback假模型贯穿工具前后和续轮，再验证真实模型；不调整批准模型、预算、题面或分母规则。后续批次使用自己的原生分母，不改写本失败或借用历史分母。

原始目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-cli-efficiency-VceljF`。result SHA-256：`f2e2d889ef28a97f9d794c4d25363b1152bb4efa788b47f0ffcfe04b75f131d9`。独立审计在 `~/.loom/reviews/2026-10-05-final-output-product/codex/p110/`；原始结果保留。
