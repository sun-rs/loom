# AUDITOR-LEAN-1：压低 Auditor 的 Claude 消耗（每回合调用次数）

用户 2026-11-27："我们的 claude 额度消耗的太多了"。两个 pilot 的 Auditor 跑在 Claude 上：
- pilot-cell：25 回合、362 次调用（每回合约 14 次）、每次调用平均输入约 27 万 token、合计 9,760 万 raw；senior-tool-denied 143 次、senior-override 112 次。
- pilot-2：141 回合、832 次调用、每次约 19.5 万、合计 1.63 亿；senior-tool-denied 约 180 次、override 约 33 次。
每被拒一次工具，就多一次带着整段长上下文的调用。

## 要做
1. 只读统计（两个 pilot 的 hist/证据，只看 Auditor）：每回合调用数分布；被拒工具调用占比、被拒的是哪些工具/命令、拒后 Auditor 做了什么（重试、换参数、走 override）；override 后实际读了多少字节。写成表。
2. 根据统计改：
   - Auditor 常驻核心里明确写出允许做的动作清单与禁止清单（一句一个，不加解释），让它不去试；
   - 工具守卫拒绝时只回一行"禁止：<原因>；改为：<允许的替代>"，不回长文本；
   - override 路径要求先写明要读的唯一文件与行范围，超过 200 行拒绝；
   - 若某类拒绝本应允许（统计显示是合理需求），改为允许，减少来回。
3. 加一个指标 `auditor calls per turn` 到 `loom cost` 与 Status 页；目标 ≤ 5。
4. 测试先行；全量 `npm test`、`npm run lint` 通过。分支 infra/auditor-lean，工作树 /Users/sun/Code/repos/loom-auditor-lean，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。
只读 pilot 的数据，不往 pilot 终端输入，不读凭据。
