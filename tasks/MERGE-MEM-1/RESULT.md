# MERGE-MEM-1 结果

在独立工作树 /Users/sun/Code/repos/loom-merge-pilot-2-memory-v1 创建候选分支 merge/pilot-2-memory-v1。双父合并提交为 a7bd0c270269573adb5a1b0518e9633812ff345e，第一父提交为 main 的 9af71b6c1f2bcb3a335685a83fa353a85c50635f，第二父提交为 pilot-2 的 2c2349e36f708208a03955bbbfc0c48caca84c2d。共同基线为 22b96cca，pilot-2 的 29 个提交均已纳入。候选分支留给 Super 审阅和快进，结果报告留在该工作树中，未提交。main 和 pilot-2 的工作树无本卡改动，本卡未推送或部署。

## 合并取舍与运行时核对

- Git 自动合并，无冲突。双方唯一共同修改的文件是 docs/MEMORY.md。两边已写入同一条用户裁决，Auditor 和 Leader 对用户层 preference 和 ruling 享有只读访问。合并保留该内容。
- 对 main 的净差异仅包含新增的 memory v1 模块、接口约定与测试，以及 docs/MEMORY-TESTS.md 对 U10、U19、L04 的更新。DELIVERY-SLA-1 至 GATE-NOTIFY-1 的实现和测试保持原样。
- 比对合并前后的运行时代码和导入。loomd 的 daemon/sessions.mjs 与 CLI 的 cli/loom.mjs 仍只导入已有的 memory/project.mjs（v0）。无新增从 daemon、CLI 或启动适配层进入 memory v1 的运行路径。
- pilot-2 的合入范围没有 .project 文件、日志、原始遥测 CSV 或其他试跑制品。保留 docs/MEMORY.md、docs/MEMORY-TESTS.md 和 memory/CONTRACT.md。

## 验收

两次全量 npm test 均在同一合并提交上依次执行，每轮使用独立 HOME 和 TMPDIR。依赖取自与候选锁文件一致的本地发布版本。

| 检查 | 测试数 | 通过 | 失败 | 取消 | 跳过 | 退出码 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| npm test 第 1 轮 | 690 | 690 | 0 | 0 | 0 | 0 |
| npm test 第 2 轮 | 690 | 690 | 0 | 0 | 0 | 0 |
| node --test memory/v1-*.test.mjs | 280 | 280 | 0 | 0 | 0 | 0 |
| node --test memory/*.test.mjs | 284 | 284 | 0 | 0 | 0 | 0 |

全量测试包含 v1 的 280 项和已有 v0 的 4 项。[全量第 1 轮](/Users/sun/Code/exp-relay/merge-mem-1/npm-test-1.log) · [全量第 2 轮](/Users/sun/Code/exp-relay/merge-mem-1/npm-test-2.log) · [v1 专项](/Users/sun/Code/exp-relay/merge-mem-1/memory-v1-test.log) · [memory 目录专项](/Users/sun/Code/exp-relay/merge-mem-1/memory-all-test.log)

git diff --check 与 git diff --check 9af71b6c HEAD 均通过。按路径与内容模式扫描了 pilot-2 的 29 个提交和合并提交相对 main 的净差异，覆盖各提交消息、19 个变动路径和 73 个不同的 Git blob。核对了私钥、常见供应商令牌、嵌入凭据、.env、认证及凭据文件和原始遥测数据文件。8 处命中均为同一个脱敏测试的合成字面量，按文件、变量和摘要复核后，未决命中为 0。扫描日志只记录位置与规则，不输出匹配值。[扫描汇总](/Users/sun/Code/exp-relay/merge-mem-1/secret-scan.log) · [扫描脚本](/Users/sun/Code/exp-relay/merge-mem-1/scan-merged-range.py)

## 接线前遗留

目标 4 报告记录的遗留继续适用。回执随成功写入累积，保留策略待定。旧快照中没有指纹的回执重放会返回 conflict。调用同时缺分类器和访问权限时，错误优先级尚未由测试固定。真实 loomd 集成和原生 CLI 验收（I/L 层）留待接线阶段。[目标 4 审核报告](/Users/sun/Code/loom-pilot2/.project/goal4-final-report.md)

STATUS: done
