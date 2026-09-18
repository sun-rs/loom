# R2：分离 Tailnet 与普通 LAN 的信任配置

## 工作项与裁决

工作单：[rc 修复与加固指南](../product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md) §5 R2；
审计出处：[rc.1 审计](2026-09-16-rc1-audit-and-latest-raft.zh-CN.md) B8 行。

裁决：**缺陷确认并已在代码层闭合，未部署。** 原实现把"配置 Tailnet"当作"同时授权本机
全部 RFC1918 网卡"，普通 LAN 入口是从 Tailnet 变量派生的副作用，且随网卡变化隐式改变。
现在两者是互不派生的显式配置，收据对已授权入口具有权威性。

保留的产品决定（§2 网络行）全部未触碰：Tailnet 仍是 HTTP、仍停用浏览器 token 门槛；没有
恢复强制登录；现用 PWA 入口一个都没有关闭，且提供了不改变手机入口的迁移路径。

## 证据

### 只读盘点（迁移基线，2026-09-16）

现役进程 pid 98334 = `node scripts/run-local-workbench.mjs`，state 目录 `~/.rah/state`。

`lsof -nP -iTCP -sTCP:LISTEN | grep -i node`（只读）中属于 98334 的入口：

```text
127.0.0.1:4173        本机
100.101.107.87:4173   Tailnet（utun4，100.64.0.0/10）
192.168.1.86:4173     普通 LAN（en0）
127.0.0.1:65174 / 127.0.0.1:65196   daemon 内部 loopback 端口
```

`~/.rah/state/workbench-launch.json`（只读）：

```json
{
  "schemaVersion": 1,
  "pid": 98334,
  "mode": {
    "kind": "tailnet",
    "bindHost": "100.101.107.87",
    "additionalBindHosts": ["127.0.0.1", "192.168.1.86"],
    "port": 4173
  }
}
```

`ifconfig` 只读确认：en0 = 192.168.1.86，utun4 = 100.101.107.87，utun5 = 198.18.0.1
（非 RFC1918，原实现已排除）。信任模式为 `trusted-network`（`local-core-workbench.ts:162`
对 tailnet 模式固定使用该值），端口 4173。

手机入口：两个都可能——Tailnet `http://100.101.107.87:4173` 与 LAN
`http://192.168.1.86:4173` 都在监听，都是 trusted-network 无 token。本轮不判定手机实际使用
哪一个，两个都必须在迁移后存活。本轮未修改任何 live 文件、未重启、未改配置。

### 缺陷证据

- `scripts/workbench-launch-mode.mjs:9-32`（改动前）：设置 `RAH_TAILNET_HOST` 时
  `additionalBindHosts` = `127.0.0.1` + 枚举 `networkInterfaces()` 得到的全部非内部 RFC1918
  IPv4 地址。即"只配置 Tailnet"会自动授权每一张 LAN 网卡，且新插网卡下次启动自动获得入口。
- `scripts/workbench-launch-receipt.mjs:46-51`（改动前）：tailnet 收据只回放
  `RAH_TAILNET_HOST` 与 `RAH_WEB_PORT`，`additionalBindHosts` 被丢弃，重启由 launcher 重新
  扫描网卡决定——这正是隐式扩大/收窄的来源。
- `packages/daemon/src/local-workbench-gateway.ts:109-126` 允许 RFC1918 bindHost 仅限
  `trusted-network`；`:314` `#hasSession()` 在 `trusted-network` 下无条件返回 true；`:337`
  cookie 为 no-op。Host/Origin 校验只防跨站，不能认证同网其他用户。该合同本轮不改动，
  只改"谁被授权成为入口"。

## 改动

仅两个 launcher 文件及其测试；daemon 源码、gateway 信任模型、Core 数量均未改动。

- `scripts/workbench-launch-mode.mjs`
  - 新增导出的 `assertTrustedLanHosts(hosts, tailnetHost, source)` 校验器。
  - 新增 `RAH_TRUSTED_LAN_HOSTS`：逗号分隔、逐个显式列出的 RFC1918 IPv4 地址，是普通 LAN
    受信入口的唯一来源。重复、回环、非私有、越界、格式错误、与 Tailnet 地址相同、空值一律
    报错拒绝（不静默去重、不跳过）。
  - 删除 `networkInterfaces()` 推导与第三个 `interfaces` 参数：网卡新增/消失不再改变已授权
    集合。`RAH_TAILNET_HOST` 单独配置时 `additionalBindHosts` 恒为 `["127.0.0.1"]`。
  - `RAH_TRUSTED_LAN_HOSTS` 不与 `RAH_TAILNET_HOST` 同时出现时失败，并在错误里指向既有
    `RAH_LAN_ORIGIN` 认证 HTTPS/配对网关，避免新增第二条无认证 LAN 路径或第二个 Core。
  - 新增导出的 `assertTailnetHost(host, source)`（复审 P2 修复）：`RAH_TAILNET_HOST` 只接受
    100.64.0.0/10 的 IPv4。RFC1918、回环、通配、公网、越界、IPv6、带端口及格式错误值一律拒绝，
    错误信息同时指向 `RAH_TRUSTED_LAN_HOSTS` 与 `RAH_LAN_ORIGIN`。修复前
    `RAH_TAILNET_HOST=192.168.1.86` 会被接受为 `kind:"tailnet"`，等于用 Tailnet 变量绕过刚
    建立的显式 LAN 合同（gateway 构造函数原本会兜底拒绝，但失败发生得太晚且诊断不指向正确配置）。
- `scripts/workbench-launch-receipt.mjs`
  - `networkKeys` 增加 `RAH_TRUSTED_LAN_HOSTS`（重启时先清理再按收据回放）。
  - tailnet 收据回放 `RAH_TAILNET_HOST` + `RAH_TRUSTED_LAN_HOSTS`，收据成为已授权入口的权威
    来源，重启不再依赖网卡扫描。
  - tailnet 收据的 `bindHost` 改用同一 `assertTailnetHost()` 校验（原为宽松的 `isIP()`）：
    收据里的 Tailnet 地址若不在 CGNAT 段内则 fail-closed 并给出诊断，绝不回放。
  - 新增 `receiptTrustedLanHosts()`：读收据与写收据都用同一校验器。收据中出现 launcher 无法
    由显式配置复现的地址（非私有、格式错误、通配、重复、非列表、重复回环）时 fail-closed 并
    给出明确诊断，绝不静默降回 loopback，也不扩大范围。
- `docs/architecture/client-daemon-and-deployment.zh-CN.md`：新增"网络入口的所有权"小节，
  明确两个变量各自的所有权、拒绝规则与收据权威性。

不需要改动 `local-core-workbench.ts`、`local-workbench-gateway.ts`、
`restartable-local-workbench.ts`、`config.ts`：`LocalCoreWorkbenchMode` 已经接受
`additionalBindHosts`，gateway 的绑定白名单与 Host/Origin/配对合同已覆盖本工作单的拒绝要求。
`packages/daemon/src/macos-local-core-launch-agent.ts` 同样未改动（原因见"剩余项"）。

## 验证

### TDD 先失败记录

先写测试并运行，记录 9 个预期失败（`node --test scripts/workbench-launch-mode.test.mjs scripts/workbench-launch-receipt.test.mjs`，实现前）：

```text
✖ Tailnet alone authorizes no ordinary LAN interface
✖ a new or removed interface never changes the authorized set
✖ explicit trusted LAN hosts bind exactly the configured addresses
✖ duplicate, public, malformed or loopback trusted LAN hosts are refused
✖ trusted LAN hosts are never derived outside an explicit Tailnet entry
✖ a Tailnet receipt carries its trusted LAN entries into an empty shell restart
✖ a Tailnet-only receipt does not reintroduce LAN entries on restart
✖ a corrupted network entry list fails closed instead of narrowing or widening
✖ writing a receipt refuses a network entry set the launcher could not reproduce
```

失败样本：Tailnet-only 实得 `["127.0.0.1","192.168.1.86","10.7.0.4"]`（旧网卡推导）；
损坏收据 `Missing expected exception`（旧实现静默接受）。

### 复审 P2 的第二轮先失败记录

复审发现 `RAH_TAILNET_HOST=192.168.1.86` 被接受为 `{"kind":"tailnet","bindHost":"192.168.1.86"}`。
补测后运行，记录 2 个预期失败：

```text
✖ the Tailnet variable never accepts an ordinary LAN, loopback or public address
✖ a receipt whose Tailnet entry left the CGNAT range fails closed
```

（同批新增的 `the Tailnet variable accepts the CGNAT range it owns` 一开始即通过，用于锁住
100.64.0.1 / 100.101.107.87 / 100.127.255.255 不被误伤。）随后实现 `assertTailnetHost()`，
两项转绿，现役基线专项测试（100.101.107.87 在 CGNAT 段内）保持通过。

### 实现后

| 命令                                                                                                                                                                      | 结果               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `node --test scripts/workbench-launch-mode.test.mjs scripts/workbench-launch-receipt.test.mjs`                                                                            | 20/20 pass, exit 0 |
| `node --test packages/daemon/test/{local-workbench-gateway,local-core-workbench,restartable-local-workbench,lan-workbench-gateway,macos-local-core-launch-agent}.test.ts` | 25/25 pass, exit 0 |
| `node --test packages/daemon/test/source-boundary.test.ts`                                                                                                                | 1/1 pass, exit 0   |
| `npx prettier --check`（4 个脚本 + 架构文档）                                                                                                                             | exit 0             |

覆盖到工作单要求的每一项"先测"：

- 单独 Tailnet 配置 → 绑定集合恰为 Tailnet 地址 + `127.0.0.1`，三张模拟网卡（含
  192.168/10./198.18）都不获授权。
- 显式 LAN → 恰好是配置的地址，顺序与配置一致。
- 重复 / 非法 / 非私有 / 回环 / 越界 / 空值 / 与 Tailnet 同址 → 全部报错拒绝（8 个用例）。
- `RAH_TAILNET_HOST` 的取值范围 → 只接受 100.64.0.0/10；RFC1918、回环、通配、公网、CGNAT
  边界外、IPv6、带端口、域名共 12 个用例全部拒绝，错误信息指向 `RAH_TRUSTED_LAN_HOSTS`；
  收据侧同一检查，越界 Tailnet 收据 fail-closed 不回放（4 个用例）。
- 网卡新增/消失 → 同一配置在有网卡与无网卡两种 `networkInterfaces` 下产出完全相同的模式。
- 收据记录网络入口与端口；重启读收据；**现役基线专项测试**把盘点到的真实收据
  （`100.101.107.87` + `127.0.0.1` + `192.168.1.86`，4173）喂进 `restartNetworkEnvironment`
  → `workbenchLaunchMode`，断言复现的监听集合逐项等于
  `{100.101.107.87:4173, 127.0.0.1:4173, 192.168.1.86:4173}`，且在注入一张无关新网卡
  （10.55.0.9）时结果不变。
- 收据损坏 → fail-closed 并带明确诊断（5 种损坏形态），读与写两侧都校验。
- 空 shell 重启（`{PATH:"/bin"}`）→ 用收据，不丢条目；反向地，tailnet-only 收据会清掉环境里
  残留的 `RAH_TRUSTED_LAN_HOSTS`，不把旧 LAN 条目带回来。
- 错误 Host/Origin 拒绝、LAN 认证路径未认证访问拒绝：由既有测试覆盖并已重跑——
  `local-workbench-gateway.test.ts` 中 trusted-network 场景断言错误 Host → 421、
  跨站 Origin → 403、通配/LAN/越界 Tailnet 绑定构造即拒绝；
  `lan-workbench-gateway.test.ts` 覆盖配对 LAN 的未认证拒绝。本轮未削弱这些断言。

未做：未运行完整 `npm run check`（按本批次约束）；未做真实浏览器/真实 origin 验收
（属于部署环节，见下）。

## 部署

**未部署。现役入口未改变。** 本轮全程只读盘点，没有重启、没有停止、没有改
`~/.rah` 任何文件、没有动 launchd、没有改 live `RAH_TAILNET_HOST`、没有改手机入口。
现役 pid 98334 仍以旧代码运行原三个监听地址。

### 迁移配方（供 Fable 在单独授权后执行）

依据盘点基线，保持今天三个入口完全不变的显式配置是：

```sh
RAH_TAILNET_HOST=100.101.107.87
RAH_TRUSTED_LAN_HOSTS=192.168.1.86
RAH_WEB_PORT=4173
```

两条等价路径：

1. **推荐（零手工配置）**：直接用默认重启路径 `npm run restart:local-workbench`。它读
   `~/.rah/state/workbench-launch.json`；新代码会从收据里的 `additionalBindHosts` 还原出
   `RAH_TRUSTED_LAN_HOSTS=192.168.1.86`，复现完全相同的监听集合。手机入口无需改动，也不需要
   操作者记住任何变量。已有专项测试就是喂这份真实收据断言的。
2. **冷启动**：用上面三个变量执行 `npm run start:local-workbench`。

**注意**：`--adopt-network-from-environment` 分支现在按新语义解释环境。若用该分支重启且
**只**带 `RAH_TAILNET_HOST`，192.168.1.86 入口会消失。采用该分支时必须同时带
`RAH_TRUSTED_LAN_HOSTS=192.168.1.86`。默认（读收据）路径无此风险。

### 切换前的兼容性测试

必须从真实 origin 新开浏览器验证，不能只测 `127.0.0.1`：

1. `lsof -nP -iTCP -sTCP:LISTEN | grep 4173` 确认三个地址都在监听。
2. Tailnet 设备新开无痕窗口访问 `http://100.101.107.87:4173`：直接进工作台，不出现 token
   表单，不下发 session cookie。
3. 同网 LAN 设备新开无痕窗口访问 `http://192.168.1.86:4173`：同上。
4. 手机 PWA 原有入口直接打开，不清缓存、不重新配对。
5. 负向：`curl -H 'Host: attacker.invalid' http://192.168.1.86:4173/` 应得 421。
6. 重启后重新读 `workbench-launch.json`，确认 `additionalBindHosts` 仍是
   `["127.0.0.1","192.168.1.86"]`，pid 已更新。

### 回退

代码回退：`git checkout -- scripts/workbench-launch-mode.mjs scripts/workbench-launch-receipt.mjs`
（本工作项未提交、未推送，且不涉及 schema 或数据迁移，制品回退即完全回退）。
运行回退：旧代码从同一份收据启动会重新扫描网卡，仍然得到包含 192.168.1.86 的集合，因此
回退不会切断现用入口。重启前按既有流程做备份与空闲检查。

## 剩余项

1. **需要用户决定：普通 LAN 入口 192.168.1.86 的去向。** 本轮只把它从"自动派生"改成"显式
   配置"，没有改变它的信任级别。三个选项：
   - (a) **保持 trusted-network 显式授权**：写死 `RAH_TRUSTED_LAN_HOSTS=192.168.1.86`。手机
     和 PWA 完全不受影响，无需任何客户端动作。风险不变：同一 Wi-Fi 上的任何设备仍可无认证
     访问，Host/Origin 校验不解决这一点。
   - (b) **只保留 Tailnet，关闭普通 LAN 入口**：不设 `RAH_TRUSTED_LAN_HOSTS`。风险最低；
     但若手机当前用的是 192.168.1.86，需先把手机改到 Tailnet 入口，属于会改变手机入口的
     动作，需单独授权。
   - (c) **普通 LAN 改走既有 HTTPS/配对网关**：用 `RAH_LAN_ORIGIN` 路径（`lan-workbench-gateway.ts`
     已具备配对与 TLS，`~/.rah/state/lan-access.json` 中已有 2026-09-12 遗留的配对记录）。
     LAN 侧获得应用层认证；代价是客户端需信任受管 CA 并完成配对，且该模式会把同一端口切到
     HTTPS，与 Tailnet HTTP 不能在同端口共存，需要额外的端口/拓扑决定。
     在用户裁决前，代码按 (a) 的语义保留现状，不做任何自动迁移。
2. **确认手机实际使用的入口**：本轮只读盘点无法判定。切换到 (b)/(c) 之前必须先确认，否则
   会切断现用 PWA。
3. **`macos-local-core-launch-agent.ts` 尚不支持 tailnet 模式**：`createMacOSLocalCoreLaunchAgentPlan`
   只产出 loopback 或 LAN 两种环境，正式安装态 LaunchAgent 无法表达 Tailnet + 显式 LAN 入口。
   现役入口跑在仓库 launcher 上，不受影响。要把这套信任分离带进安装态产品，需要给
   LaunchAgent plan 与 `local-core-cli-dispatch.ts` 补 tailnet/`RAH_TRUSTED_LAN_HOSTS` 分支
   （后者本批次不在可改文件范围内）。记为独立后续项。
4. **真实 origin 验收未执行**：上面"兼容性测试"六步属于部署环节，须在授权重启时完成，
   单元测试不能替代。
5. **未运行完整 `npm run check`**：按本批次约束只跑定向测试。
