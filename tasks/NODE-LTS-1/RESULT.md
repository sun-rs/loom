# NODE-LTS-1 验收记录

固定 Node.js **26.13.1 (Lithium)**，原生模块 ABI **147**。Node 26 于 2026-05-05 首发，2026-10-28 进入 Active LTS，2027-10-20 进入维护期，2029-04-30 结束支持。26.13.1 安全更新于 2026-11-11 公告，发行索引日期为 2026-11-10。 [Node.js 官方发布计划](https://github.com/nodejs/Release/blob/main/schedule.json) · [26.13.1 发布公告](https://nodejs.org/en/blog/release/v26.13.1) · [发行索引](https://nodejs.org/dist/index.json)

macOS arm64 包从 Node.js 官方站下载。用独立临时密钥环境校验 `SHASUMS256.txt.sig`，签名指纹为 `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`。包的 SHA-256 与签名清单一致，为 `af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559`。运行时已安装至 `/Users/sun/.loom-cell/runtime/node-26.13.1/bin/node`，另在临时目录验证了安装脚本的全新安装路径。Linux x64 使用同一安装脚本选择官方 `linux-x64` 包，本机只核对了签名清单中的摘要。 [官方校验文件](https://nodejs.org/en/blog/release/v26.13.1#shasums) · [发布签名密钥](https://github.com/nodejs/release-keys)

`bin/node-runtime` 统一记录固定版本和两个平台的摘要。CLI、daemon、配套入口、托管 Worker、holder 拉起的 Node 子进程、hooks 和 session-host 使用固定的绝对路径。独立评测脚本可从 `bin/loom-node` 启动，npm 测试入口也使用它。`loom doctor` 核对 CLI 和 daemon 的版本、执行路径及 ABI。`bin/build-release` 使用该安装自带的 npm 安装依赖、重编 `node-pty` 并运行冒烟测试。 [构建及升级说明](../../docs/HOT-UPGRADE.md)

## 验证

- RED 先行。改动前，两项测试分别复现了无 Node 的 `PATH` 下启动失败，以及 self-check 缺少实际运行时字段。日志 `/private/tmp/loom-node-lts-red.log`。
- macOS arm64 安装后报告 `v26.13.1`、`arm64`、ABI `147`。固定 Node 下 `npm ci` 成功，`node-pty` 使用随发行包提供的头文件完成本机重编。日志 `/private/tmp/loom-node-lts-build.log`。
- 从未加 Node 固定机制的 `1ab84f67` 归档启动隔离项目，使用 `/opt/homebrew/Cellar/node/25.9.0_2/bin/node`（25.9.0）以及假 Codex。热升级至 26.13.1 后完成消息投递，再回滚至 25.9.0。holder 和假 CLI 的 PID 始终一致，原有权限保持有效。日志 `/private/tmp/loom-node-lts-migration-final.log`。
- `npm run lint` 检查 362 个文件，通过。最终 `npm run release:smoke` 3 项通过，覆盖固定 Node 的入口、原生 ABI、投递、失败恢复和成功热升级。日志 `/private/tmp/loom-node-lts-lint.log` 和 `/private/tmp/loom-node-lts-final-smoke.log`。
- 固定 Node 下全量 `npm test -- --test-concurrency=4` 通过 **1123/1123**，0 失败、0 跳过、0 取消，退出码 0。日志 `/private/tmp/loom-node-lts-full.log`。

存量会话和回滚仍需要旧 release、其依赖及旧 Node 二进制。全局 Homebrew Node 与 PATH 配置未改动。验证在隔离的项目中执行。

STATUS: done

## 合并 main 后验收（2026-11-28）

- 按卡面指定的 `8efd3cbb` 合并到 `infra/node-lts`。`daemon/release.mjs` 保留固定 Node 运行时与技能根目录环境，`daemon/upgrade.mjs` 保留旧运行时兼容字段和技能资源自检。
- 使用 `/Users/sun/.loom-cell/runtime/node-26.13.1/bin/node`（v26.13.1，ABI 147）对应的 npm 完成 `npm ci`。
- 固定 Node 下 `npm run lint` 通过，扫描 371 个文件。全量 `npm test` 通过 **1146/1146**，0 失败、0 跳过、0 取消，退出码 0。

STATUS: done
