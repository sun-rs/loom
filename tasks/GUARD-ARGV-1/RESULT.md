# GUARD-ARGV-1 结果

- 根因在 agy、Codex 和 OpenCode 共用的 `lib/host-tool-guard.mjs`。原正则扫描整条命令，误把 `--cli codex`、`--cli codex,agy,opencode` 和传给 `realpath` 的路径当作可执行文件。T120 实况仅查阅了任务卡指定的阻断说明。
- 守卫现在提取每条简单命令的可执行项，再对原生 CLI 检查绝对路径、可执行性和 canonical 路径，并记录实际执行路径。管道、命令列表、子 shell、显式 shell 脚本和 `env`、`command`、`exec` 前缀仍检查裸调用。解析使用静态字面量，不执行 shell 或求值变量。
- 回归覆盖两条误拒命令、绝对路径作为参数、裸调用、前缀、引号、命令替换和只记录实际启动的 canonical 路径。授权到期、受保护路径和外联检查保持生效。 [RED](/private/tmp/loom-guard-argv-red.log) · [GREEN](/private/tmp/loom-guard-argv-green.log)
- `npm run lint` 和 `git diff --check` 通过。定向测试 4 项通过。全量 `npm test -- --test-concurrency=4` 1096 项通过，失败、取消、跳过均为 0。 [全量日志](/private/tmp/loom-guard-argv-full.log)

STATUS: done
