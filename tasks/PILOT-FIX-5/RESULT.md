# PILOT-FIX-5 结果

## 无头 Worker 登录

- agy 1.5.17 在私有 `HOME` 下启动时，即使传入原生 ACP 的 `--gemini-dir`，仍返回 `Authentication required`。原生 Claude 2.1.331 在默认登录环境能通过 `auth status`，私有 `HOME` 下不能。显式将 `CLAUDE_CONFIG_DIR` 设为原来的 `.claude` 目录也会改变其登录选择。诊断只记录状态和目录，不打开、复制或打印任何凭据文件。 [agy 登录与系统钥匙串](https://antigravity.google/docs/cli/troubleshooting/) · [Claude 配置目录](https://code.claude.com/docs/en/settings)
- macOS 的 OAR 版本探测仍使用私有目录。实际 agy 和 Claude Worker 启动保留原生登录定位，Seatbelt 仅允许写工作树、对应 Git 元数据、私有主目录和临时目录，以及明确列出的原生会话数据。登录目录根和凭据保持只读。agy 的命令工具使用外层 Seatbelt，避免在真实主目录生成第二层沙箱配置。Claude 通过 `CLAUDE_CODE_TMPDIR` 将工具临时文件放回 Worker 目录。 [权限清单](../../README.md) · [Claude 临时目录设置](https://code.claude.com/docs/en/env-vars)
- 在一次性 Git 仓库经 `loom spawn worker` 以已登录的原生 agy 和 Claude 各完成一轮，两者都绑定了存在的 transcript。Claude 直接使用绝对原生路径 `/Users/sun/.local/share/claude/versions/2.1.331`，agy 使用 `/Users/sun/.local/bin/agy`。另外，两种原生 shell 都成功写入私有 XDG 和工作树，工作树外的探针写入均被拒绝。 [原生回执](</Users/sun/Code/exp-relay/pilot-fix-5/live-final.log>) · [命令工具验证](</Users/sun/Code/exp-relay/pilot-fix-5/live-tools-final.log>)
- 用原生 Codex 0.171.0 重跑 FIX-4 的沙箱探针。关联工作树提交成功，私有临时目录的 Unix socket 可连接。主 checkout、共享 Git 根、其他分支、启动 HOME、公共临时目录和私有临时目录外的 socket 监听均被拒绝。模型响应使用本地夹具，工具与系统沙箱为原生。 [Codex 探针](</Users/sun/Code/exp-relay/pilot-fix-5/codex-confinement.log>)

## 事实核查

- 只读采样的 Pilot 状态有 101 条旧 `fact-miss`。回归覆盖 `loom status` 命令串、`provider/model`、`3/3`、`37/37`、计划生成的产物及项目外绝对路径。项目内的候选路径核对轮末 Git 快照和当前文件系统，任一处存在即通过，同轮新增文件也使用变更记录。真实缺失的项目文件仍会计入证据。
- 每次会话的同一轮最多生成一条事实核查通知，最多显示五项，并标明其余数量。无轮次关联的旧逐项告警保留在原账本，从活动状态和新告警队列中排除。更新后的只读状态查询显示 0 条活动事实告警。没有修改 Pilot 窗格或数据。

## 验收

- `npm test` 通过全部 291 项。重跑前将 agy 测试夹具移入发布摘要本来就排除的临时目录前缀，以消除并行测试扫描到临时符号链接的问题。 [完整测试日志](</Users/sun/Code/exp-relay/pilot-fix-5/npm-test-acceptance.log>)
- 本次执行未提交。macOS 之外的 agy 和 Claude 原生登录未做实测。

STATUS: done
