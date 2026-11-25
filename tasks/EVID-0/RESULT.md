# EVID-0 结果

已交付 `evidence.forTurn()` 和 relay 的 `--evidence` 接入。worker 轮末生成 `.project/evidence/<task>-<turn>.json` 和 `.txt`，记录 Git 变更、保护路径、测试删改、验证命令及其退出码和沙箱状态。输出尾部的 SHA-256 与摘录写入 JSON，最终回复的声称与观测对照并标记 `MISMATCH` 或 `UNVERIFIED`。文本卡最多 300 字节（含换行），重复事件复用同一份归档。[使用说明](../../evidence/README.md)

## 验证

- 在 `exp-relay/evid-0/suite` 运行全仓 `node --test`，164 项通过。新增用例覆盖声明不符、跳测、删断言、轮次隔离和 relay 重启去重。
- 在 `exp-relay/evid-0/git-check` 用真实 Git 工作树核对重命名前后的保护路径、测试文件删除，以及未追踪测试中的新增 `skip` 和 `only`。
- 第一轮使用 `20261124151218-59651/arms-final.tgz` 的源码和测试，第二轮使用当前 `h0`、`h1`、`orca` 的源码和测试。六份副本以 `seed.commit` 为基线并使用公开夹具。在各副本运行 `node --test`，六次均退出 0。复跑配置的保护 glob 为 `SPEC.md`、`fixtures/**`、`loomx`。
- 在各副本的新验证记录上生成六张卡，抽查五张。每张都核对了未追踪文件清单、五个测试文件、保护命中 `loomx`、测试通过数和尾部哈希。六张文本卡均为 206 字节。第二轮 H1 额外生成的卡记录了 54 项通过。[证据卡目录](/Users/sun/Code/exp-relay/evid-0/.project/evidence)

| 抽查 | 通过数 | 改动文件 | 测试文件 | 输出尾部 SHA-256 前 12 位 |
| --- | ---: | ---: | ---: | --- |
| 第一轮 H0 | 64 | 11 | 5 | `6a5349502731` |
| 第一轮 H1 | 53 | 11 | 5 | `8fa5c6682110` |
| 第一轮 Orca | 121 | 11 | 5 | `044321a061ae` |
| 第二轮 H0 | 157 | 11 | 5 | `883aa17b941b` |
| 第二轮 Orca | 133 | 11 | 5 | `3cdb07b68613` |

## 验证范围

红线仅允许读取本任务测试目录生成的会话记录。验收以实际复跑的退出码和输出生成 Codex 格式回放记录，因此原实验 worker 的当轮验证、沙箱和最终声称仍待核验。

STATUS: done
