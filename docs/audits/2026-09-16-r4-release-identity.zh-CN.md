# R4：产品 release identity 与文档一致性

施工单：[rc.1 修复与补强施工指南](../product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md) §5 R4。
基线：`98dc095` / `v1.0.0-rc.1`。日期：2026-09-16。本报告含三轮复核后的最终状态
（第二轮：完整身份比对、health 身份、ADR 取代范围；第三轮：开发工作台单一身份、
LAN gateway health、门禁接入、ADR 结果段）。

## 问题

同一份代码在四个入口报出四个互不相干的版本：Settings → 关于 硬编码
`RAH OS 0.0.0`（`apps/web/src/components/settings-pages.tsx:572`），daemon 硬编码
`DAEMON_BUILD_VERSION = "0.1.0"`（`packages/daemon/src/daemon-health.ts:1`，经
`daemon-application-support.ts:124,591` 进入 health / capabilities 与
`agent_hosts.build_version`），根包 `package.json` 是 `0.0.0`，而唯一的里程碑标识是
tag `v1.0.0-rc.1`——字符串 `1.0.0-rc` 在任何被跟踪的文件里出现 0 次。没有 `--version`
命令，没有 commit/build 身份，产品构建脚本的 `--version` 只写进 `product-manifest.json`，
不传给 Web 或 daemon。README 的安装示例把 `0.1.0` 当成产品版本号写死。

ADR-0029 决策 4 声称 `in_progress` / `in_review` 只能由真实认领与冻结提交产生；
该限制已于 2026-09-14 被用户撤回并在
`packages/kernel/src/human-task-edit.ts:122-140` 反向实现，撤回说明当时只追加在
ADR-0020，ADR-0029 本身仍写着已作废的规则。

## 决定与实现

一个 release identity 贯穿全部入口，来源全部是显式构建输入：

- `scripts/release-version.mjs`：唯一解析器。`mode: "formal"` 缺 release version 直接
  抛错（并拒绝 `0.0.0` 这类占位符），不回落；缺 release version 即 `development`，
  版本号是 `0.0.0-dev+<shortCommit 或 local>`，`kind` 明确为 `development`。
  `commit` / `builtAt` 是构建输入，模块内没有 `node:child_process`、`execFile`、
  `spawnSync`、`rev-parse`——运行期不读 Git 工作树。`buildId` 由
  `(kind, version, releaseVersion, commit, builtAt)` 的 SHA-256 前 16 位确定，同输入同结果。
  它同时是一个 CLI：`node scripts/release-version.mjs --release-version <v> --commit <sha>`
  打印一份身份 JSON，供一次发布的所有构建步骤复用。
- Web：`apps/web/vite.config.ts` 用 `define` 注入 `__RAH_BUILD_IDENTITY__`，并在
  `index.html` 写入 base64 的 `<meta name="rah-build-identity">` 供产品构建核对；
  `apps/web/src/build-identity.ts` 解析并暴露 `WEB_BUILD_IDENTITY`；Settings → 关于
  渲染 `buildIdentityLabel(...)`，development 构建显式标注"development 构建（未签发版本）"。
- Daemon：`packages/daemon/src/build-identity.ts` 读 `process.env.RAH_OS_BUILD_IDENTITY`；
  打包时 rolldown `define` 把这个成员表达式替换成字面量，所以已发布的 Core 不依赖
  启动环境。`daemon-health.ts` 导出 `DAEMON_BUILD_IDENTITY` 与由它派生的
  `DAEMON_BUILD_VERSION`，health、capabilities 与 `agent_hosts.build_version` 因此
  自动一致（`daemon-application.ts` 未改动，其 800 行门禁保持 798 行）。
  `packages/daemon/src/cli.ts` 增加 `--version`，无需配置文件即可打印身份。
- 产品构建：`scripts/build-local-core-product.mjs` 接受 `--commit` / `--built-at`，
  优先采纳已注入的 `RAH_OS_BUILD_IDENTITY`（并校验它确实是本次 `--version`），
  把身份冻结进 Core bundle，并在打包前核对 Web bundle 的身份：没有身份、身份非法、
  是 development bundle，或与 Core 的**完整身份**（schemaVersion/kind/version/
  releaseVersion/commit/builtAt/buildId 逐项）不一致，一律拒绝打包而不是改标签。
  同版本同 commit 但 `builtAt`/`buildId` 不同——即两次独立构建——同样被拒绝。
- 开发工作台的单一身份：`build:web:workbench` 没有 release version 时解析出
  development 身份（`0.0.0-dev+local`，`builtAt` 与真实 `buildId` 哈希），vite 把它同时
  写进 `index.html` 的 `<meta name="rah-build-identity">` 与 `.rah-web-build.json` 的
  `buildIdentity` 字段。`scripts/workbench-web-assets.mjs` 在快照时校验两处身份**完全
  一致**，只有一处、多个 meta 或两者不同都拒绝快照。`scripts/run-local-workbench.mjs`
  在**载入 daemon 之前**（改为动态 import，因为 daemon 的身份在模块加载时解析一次）
  把快照的身份写进 `RAH_OS_BUILD_IDENTITY`；环境里已有身份则沿用，但与 bundle 不一致
  时带诊断失败关闭，不会一边服务一份 bundle 一边报告另一份。因此开发环境下
  `/_rah/health` 的 `buildId` 与 Web meta 的 `buildId` 相同。
  `packages/daemon/src/build-identity.ts` 里常量 `development` 的兜底**保留**——直接用
  `--config` 启动 daemon、不经启动器的路径仍可能没有 bundle 身份；但所有工作台启动路径
  现在总是提供一个真实身份。
- 验收面：`packages/daemon/src/local-workbench-gateway.ts` 与
  `packages/daemon/src/lan-workbench-gateway.ts` 的 `/_rah/health` 共用
  `daemon-health.ts` 的 `workbenchHealthPayload()`（单一 owner，两个入口不会漂移），
  返回完整 `buildIdentity`（kind、version、releaseVersion、commit、shortCommit、
  builtAt、buildId），loopback/TLS 语义不变，不含任何凭据。typed client health
  （`/v3/client/health`）仍只有 `buildVersion`，因为
  `packages/protocol/src/client-health.ts` 是 `.strict()` 且不在本次可改范围；
  扩展提案见 `scratchpad/batch-a/integration/R4-protocol-client-health.md`。
- schema（`KERNEL_SCHEMA_VERSION`）、protocol 版本、runtime binding 版本保持独立，
  没有从 release identity 派生。

版本号本身没有被本次工作决定：当前 HEAD 是 rc.1 之后的开发状态，构建出来就是
`development`。**下一个版本号是用户决定**，本次没有把新代码命名为 rc.2，也没有改写
`v1.0.0-rc.1`。

ADR-0029 增加"部分被取代（2026-09-14）"状态段：决策 4 中关于 `in_progress` /
`in_review` 的那一句被用户批准的 Human 任务编辑合同取代，历史原文保留并就地标注；
同时明确列出**未被取代**的围栏：Worker 的 claim / start / submit / review / 证据式
`completeTask` 权限校验、Runtime cancellation fence 与终止证明、`workflowStatus`
仅为 canonical `Task.state` 投影（决策 1/2/3 及数据库 trigger）、以及决策 5–8 的
所有权、幂等、事件与浏览器验收要求。ADR-0020 的 2026-09-14 段落原地保留为历史证据，
由 ADR-0029 反向链接。

README "Repository status" 改为：当前分支是 rc.1 之后的开发状态，rc.1 tag 是既有里程碑，
产品构建必须显式提供 release version，安装命令用 `<release-version>` 占位而不是 `0.1.0`，
并写明 parity PASS 指登记/ratchet 校验有效，不等于完整产品 parity。

## 测试（先失败）

| 测试                                                                                  | 初始失败                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/release-version.test.mjs`                                                    | `ERR_MODULE_NOT_FOUND: scripts/release-version.mjs`，随后 1 fail（源码扫描找不到两个 `build-identity`） |
| `packages/daemon/test/build-identity.test.ts`                                         | 依赖尚不存在的 `../src/build-identity.ts` 与 `DAEMON_BUILD_IDENTITY`、`cli --version`                   |
| `apps/web/test/build-identity.test.ts`                                                | 依赖尚不存在的 `../src/build-identity.ts`；`settings-pages.tsx` 仍含 `RAH OS 0.0.0`                     |
| 第二轮 `the product build rejects a Web bundle that is not this exact artefact`       | 把旧的 version+commit 比较还原后该用例失败（缺预期异常），`11 pass / 1 fail`                            |
| 第二轮 `the workbench /_rah/health route serves the injected identity over real HTTP` | 旧路由只返回 `service`/`state`，断言 `buildIdentity` 失败                                               |
| 第三轮 `scripts/workbench-web-assets.test.mjs`                                        | `readWorkbenchAssetIdentity` 尚未导出（`TypeError: not a function`）；快照不校验两处身份                |
| 第三轮 `the workbench launcher hands the served bundle's identity to the daemon`      | `workbenchDaemonIdentityEnvironment` 尚未导出                                                           |
| 第三轮 `the workbench launcher applies the identity before the daemon is loaded`      | 启动器当时是静态 import daemon，断言失败（`14 pass / 1 fail`）                                          |
| 第三轮 `the LAN gateway /_rah/health serves the same injected identity over real TLS` | LAN 路由当时只返回 `service`/`state`                                                                    |
| 第三轮 `audit: actual run-local-workbench.mjs …`（既有独立审计）                      | 启动器调用顺序改为 snapshot→identity→prepare 后，旧期望 `["prepare","snapshot","lease"]` 失败并已更新   |

覆盖的不变量：显式输入解析出唯一身份、同输入同 `buildId`、正式模式缺版本/占位版本/非法
版本一律拒绝、development 身份可启动且可识别、development 不得携带 release version、
注入环境往返一致、损坏注入退化为 development、三个身份模块不调用 git；daemon 的
health / capabilities / `agent_hosts.build_version` 读注入身份且 development 可区分、
`--version` 可打印；Web 解析注入身份、无注入时标 development、`settings-pages.tsx`
不再含任何字面产品版本；产品构建缺 `--version` 退出非零、身份同时下发 Core 与 Web 且
拒绝 development Web bundle。

## 命令与结果

| 命令                                                                                                                                  | 结果                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `node --test scripts/release-version.test.mjs scripts/workbench-web-assets.test.mjs scripts/workbench-launch-{mode,receipt}.test.mjs` | 39 pass / 0 fail                                                         |
| `node --test packages/daemon/test/build-identity.test.ts`                                                                             | 7 pass / 0 fail                                                          |
| `node --test packages/daemon/test/source-boundary.test.ts`                                                                            | pass（798 行未增长）                                                     |
| `node --test packages/daemon/test/daemon-application.test.ts`                                                                         | 13 pass / 0 fail                                                         |
| `node --test packages/daemon/test/local-core-product.test.ts` 等 4 个定向文件                                                         | 9 pass / 0 fail                                                          |
| `npx tsc --noEmit -p apps/web`                                                                                                        | 本次改动无错误；仅 R9 未完成的 `surface-error-boundary*` 报错，不属于 R4 |
| daemon 定向 12 个文件（含 source-boundary、两个 gateway、local-core-workbench、daemon-application）                                   | 54 pass / 0 fail                                                         |
| `node --test apps/web/test/*.test.ts`（排除他人未完成的 surface-error-boundary）                                                      | 438 pass / 0 fail                                                        |
| `npx prettier --check`（全部改动文件）                                                                                                | all matched                                                              |

未运行（按施工安排留给正式冻结后执行）：`npm run check`、`npm run build:web:workbench`、
真实产品构建与真实浏览器门禁。

## 部署

**未部署。** 现役 workbench 未重启，未执行正式构建。本次改动对正在运行的服务没有影响；
从源码启动的开发工作台在下次重建后会把关于页与 health 显示为
`0.0.0-dev+local` / `development`，这是预期的诚实标注，不是回退。

### 开发工作台（无 release version，当前分支的常态）

```bash
npm run build:web:workbench        # 产出 development 身份并写进 bundle 的两处记录
npm run restart:local-workbench    # 或 start:local-workbench；启动器把该身份给 daemon

curl -fsS http://127.0.0.1:4173/_rah/health | python3 -m json.tool
# buildIdentity.kind = "development"，version = "0.0.0-dev+local"，buildId 是本次构建的哈希

# 同一 buildId 必须出现在被服务的 index.html 里
curl -fsS http://127.0.0.1:4173/ | grep -o 'name="rah-build-identity" content="[^"]*"' \
  | sed 's/.*content="//;s/"//' | base64 -d | python3 -m json.tool
```

两者的 `buildId` 必须完全相同；Settings → 关于 显示的 `RAH OS 0.0.0-dev+local` 与
`构建 <buildId>` 也必须是同一个。若环境里已有 `RAH_OS_BUILD_IDENTITY` 且与 bundle
不一致，启动器会带诊断失败退出，而不是服务一份 bundle 却报告另一份身份。
需要在 development 身份里带上 commit 时，构建前设
`RAH_OS_BUILD_COMMIT=$(git rev-parse HEAD)`，版本会变成 `0.0.0-dev+<shortsha>`。

### 正式构建

Fable 完成正式构建并重启后，必须核对同一身份在各入口一致。工作台在
`http://127.0.0.1:4173`（loopback gateway），daemon 在 `http://127.0.0.1:7314`；
LAN/PWA 入口的 `/_rah/health` 与 loopback 返回同一份 payload。

```bash
# 构建时：一次解析，两处复用（不这样做，产品构建会因身份不一致拒绝打包）
export RAH_OS_BUILD_IDENTITY="$(node scripts/release-version.mjs \
  --release-version <release-version> --commit "$(git rev-parse HEAD)")"
npm run build:web:workbench
npm run build:core:macos-product -- \
  --output /absolute/RAH-OS-Core-<release-version> \
  --version <release-version> \
  --carrier /absolute/carrier-directory/node

# 重启后 1：工作台 health 直接返回完整身份
curl -fsS http://127.0.0.1:4173/_rah/health | python3 -m json.tool
# 期望：{"buildIdentity":{"kind":"release","version":"<release-version>",
#        "buildId":"<id>","commit":"<sha>","shortCommit":"…","builtAt":"…"},
#        "service":"rah-os-local-core","state":"online"}

# 重启后 2：typed client health 的 buildVersion 必须等于上面的 version
curl -fsS -H "authorization: Bearer <human-pat>" \
  http://127.0.0.1:7314/v3/client/health | python3 -m json.tool | grep buildVersion

# 重启后 3：ledger 中的 Host 记录
sqlite3 "$HOME/.rah/<workspace-state>/room.db" \
  'SELECT host_id, build_version FROM agent_hosts;'

# 重启后 4：制品自身
python3 -m json.tool < /absolute/RAH-OS-Core-<release-version>/product-manifest.json | grep '"version"'
```

浏览器打开 `http://127.0.0.1:4173` → Settings → 关于，其 `RAH OS <version>` 与
`构建 <buildId>` 必须与第 1 条的 `buildIdentity` 完全一致。任一条仍显示 `0.1.0`、
`0.0.0` 或 `development`，说明该入口没有走本次构建，不得当作发布通过。

## 剩余

- **下一个版本号由用户决定**：本次不命名 rc.2，不改写 rc.1，构建出来就是 `development`。
- `package.json` 的 `version` 字段未改（root `0.0.0`、web/daemon `0.1.0`、
  kernel/protocol/agent-host `0.0.0`）。它们是 npm 工作区元数据，不再是任何运行时或 UI
  的版本来源，因此保持现状是安全的；改动提案见
  `scratchpad/batch-a/integration/R4-package.json.md`，由用户定下版本号后统一执行。
- `docs/README.md` 是共享文件，本报告的索引条目以 diff 形式交给 Fable。
- 产品 SEA 入口 `packages/daemon/src/local-core-cli.ts` 不在本次可改文件范围内，因此
  `rah-os-core --version` 尚未提供；制品身份目前靠 `/_rah/health`、Settings 与
  `product-manifest.json` 交叉核对。建议后续由该文件 owner 补一条 `version` 子命令。
- `packages/protocol/src/client-health.ts` 的 `ClientHealthResponseSchema` 是
  `.strict()`，不在本次可改范围，因此 typed client health 仍只有 `buildVersion`
  （其值已是 release identity 的 version）。把完整 `buildIdentity` 加进 typed health
  的提案见 `scratchpad/batch-a/integration/R4-protocol-client-health.md`。
- `scripts/release-version.test.mjs` 与 `scripts/workbench-web-assets.test.mjs` 目前
  没有脚本执行它们。接入 `npm run check` 的 `test:release-identity` 提案见
  `scratchpad/batch-a/integration/R4-package.json-check.md`；已确认
  `.github/workflows/ci.yml:37` 就是 `npm run check`，**不需要改 workflow**
  （`scratchpad/batch-a/integration/R4-ci.yml.md`）。
- `packages/daemon/src/build-identity.ts` 仍保留常量 `development` 兜底，因为不经工作台
  启动器直接 `--config` 启动 daemon 的路径可能没有 bundle 身份。所有工作台启动路径
  现在都会提供真实身份。
- 真实产品构建、真实重启与浏览器关于页实测未做（无授权、不重启现役服务）。开发链路
  （`build:web:workbench` → 启动器 → `/_rah/health`）已由 snapshot、启动器纯函数、
  启动顺序独立审计与真实 HTTP/TLS 测试逐段覆盖，但未跑一次完整真实构建。
