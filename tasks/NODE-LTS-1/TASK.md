# NODE-LTS-1：loom 固定使用 Node LTS 版本

用户 2026-11-27 批准："同意固定版本"。现状：loom 的 loomd、CLI、worker 环境都用 Homebrew 的 `/opt/homebrew/Cellar/node/25.9.0_2/bin/node`（Node 25，非 LTS，跟随 Homebrew 升级）。

## 要做
1. 查 nodejs.org 官方发布计划，选 **2026-11 时处于 Active LTS 的主版本**（写明版本号、发布日期、支持截止日期与来源链接）。
2. 运行时放在 loom 自己的位置：下载官方 macOS arm64 tarball（校验 SHASUMS256 签名/哈希）解压到 `~/.loom-cell/runtime/node-<版本>/`，**不改用户全局 Homebrew node，不改 PATH 配置文件**。Linux x64 同理（记录做法，本机不装）。
3. loom 所有启动点统一用这个固定 node 的绝对路径：release 的 `bin/loom`、`bin/loomd`、holder 拉起的 node 子进程、hooks/relay 脚本、session-host、worker 环境里传给 CLI 的 node、评测与测试脚本。新增一处单一配置（例如 `release.json` 的 `node` 字段 + `loom doctor` 校验），不散落硬编码。
4. `package.json` 加 `engines.node`；node-pty 等原生扩展按新版本重编，release 构建时做冒烟测试（启动 loomd、spawn 一个假 CLI、投递一条、热升级一次）。
5. 热升级兼容：从旧 release（Homebrew node）升级到新 release（固定 node）时，旧会话不中断；写进 docs/HOT-UPGRADE 相关文档。
6. 测试先行；全量 `npm test`、`npm run lint` 在固定 node 下通过。分支 infra/node-lts，工作树 /Users/sun/Code/repos/loom-node-lts，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。不读凭据，不碰 /Users/sun/Code/ccp，不启动 Claude。
