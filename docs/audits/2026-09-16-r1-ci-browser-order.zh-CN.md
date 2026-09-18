# R1 修复 CI 浏览器依赖顺序（2026-09-16）

基线：`main` HEAD `98dc095`。范围仅 `.github/workflows/ci.yml` 与新增的 CI 顺序不变量脚本。

## 工作项与裁决

| 字段     | 内容                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 工作项   | R1（`docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §5 R1）        |
| 裁决     | 确认缺陷。审计 B4 行的判断成立：根因是 `npm run check` 内缺少 Playwright Chromium   |
| 否决部分 | 原始报告"foundations 找不到 Chrome"不是远端失败的直接原因；不采纳仅设环境变量的修法 |

## 证据

### 原行为

`.github/workflows/ci.yml`（修改前）步骤顺序为
`npm ci` → `npm run check` → `npx playwright install --with-deps firefox` → 三个 Web 门禁。
`npm run check` 串中的 `test:ui:choice`（`scripts/test-choice-row-browser.mjs:2-3,29-33`）
`import { chromium, firefox } from "playwright/test"` 并直接 `engine.launch({ headless: true })`，
即使用 Playwright 自带引擎。远端 run `35007939637` 因此在 check 内失败，而安装步骤排在其后。
另外安装只覆盖 firefox，且未与锁文件版本绑定。

### 引擎清单（脚本静态解析，非人工推断）

解析器：`scripts/ci-browser-requirements.mjs`；结果由 `scripts/ci-workflow-order.test.mjs` 断言。

| 入口                         | 实际启动引擎                           | 依据                                                                         |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `check` → `test:ui:choice`   | Playwright chromium + firefox          | `test-choice-row-browser.mjs` 直接 `launch()`，无 `executablePath`           |
| `check` 其余各项             | 无                                     | 纯 Node/TS 校验、typecheck、单元测试、策略测试                               |
| `test:web:foundations`       | 系统 Chrome + Playwright firefox       | `run-ui-foundation-browser-gate.mjs:119-131`（chromium 带 `executablePath`） |
| `test:web:ui-compare`        | 系统 Chrome                            | `run-ui-comparison.mjs:5,76-77`                                              |
| `test:web:browser`           | 系统 Chrome（CDP 直连，非 Playwright） | `run-real-browser-gate.mjs:20,75-76` + `findChromeExecutable`                |
| `test:web:mobile-navigation` | Playwright chromium（webkit 可选）     | 三脚本；webkit 仅经 `RAH_MOBILE_ENGINE` 开关                                 |
| `test:web:message-menu`      | Playwright chromium（webkit 可选）     | `RAH_UI_BROWSER === "webkit"` 开关                                           |
| `test:web:message-selection` | Playwright chromium                    | 直接 `chromium.launch()`                                                     |
| `test:web:task-filter-scope` | Playwright chromium（webkit 可选）     | `RAH_UI_BROWSER` 开关                                                        |
| `test:web:scroll-ownership`  | Playwright chromium（webkit 可选）     | `RAH_MOBILE_ENGINE` 开关                                                     |
| `test:web:sidebar-touch`     | Playwright chromium + **webkit**       | npm 脚本第二段显式 `RAH_TOUCH_ENGINE=webkit`                                 |

"系统 Chrome"指 `scripts/real-browser-gate-support.mjs:43-65` 的 `findChromeExecutable()`：
按 `RAH_BROWSER_EXECUTABLE` → `/Applications/...` → `/usr/bin/google-chrome[-stable]` →
`/usr/bin/chromium[-browser]` 查找，找不到即抛错。

### 2026-09-05 之后新增门禁的夹具前提

`test:web:mobile-navigation`、`message-menu`、`message-selection`、`task-filter-scope`、
`task-filter-touch`、`scroll-ownership`、`sidebar-touch`、`mobile-interactions`、
`mobile-sidebar-return` 全部调用 `scripts/ui-shell-browser-scenarios.mjs` 的
`startShellFixture()`：它自行 spawn `scripts/run-multi-agent-web-fixture.mjs`（真实
Kernel/daemon + 假 provider 可执行文件 + vite dev，隔离临时状态），通过
`RAH_MULTI_AGENT_FIXTURE` 公告行回读 origin/roomId。**不需要预构建 Web 产物，也不需要
已运行的正式 daemon**；每个脚本各自起停自己的夹具，互不共享。
相对地，`test:web:workbench`、`lan-workbench`、`firefox`、`build-recovery`、`media-preview`
需要先 `npm run build:web:workbench`，本批未接入（见"剩余项"）。

### 失败测试及其预期失败

新增 `scripts/ci-workflow-order.test.mjs`。在修改 `ci.yml` 之前运行，得到预期失败
（完整输出存档 `scratchpad/batch-a/reports/R1-failing-test.txt`）：

```text
step 3 (npm run check) launches chromium but no earlier step installs it
step 3 (npm run check) launches firefox but no earlier step installs it
step 5 (npm run test:web:foundations) launches chrome but no earlier step installs it
step 5 (npm run test:web:foundations) relies on an install of firefox that is not pinned to the lockfile version 1.60.0
step 6 (npm run test:web:ui-compare) launches chrome but no earlier step installs it
step 7 (npm run test:web:browser) launches chrome but no earlier step installs it
```

即：该测试独立复现了远端 CI 的真实根因，而非只重述结论。

## 改动

单一 owner：workflow 顺序由 `.github/workflows/ci.yml` 拥有，顺序不变量由
`scripts/ci-browser-requirements.mjs` + `scripts/ci-workflow-order.test.mjs` 机检。

1. `npm ci` 之后、`npm run check` 之前安装浏览器：
   - `actions/cache@v4` 缓存 `~/.cache/ms-playwright`，key 为 `hashFiles('package-lock.json')`；
   - `./node_modules/.bin/playwright install --with-deps chromium firefox webkit`；
     使用本地二进制而非 `npx playwright`，版本按构造等于 `package-lock.json` 的
     `playwright` 版本（当前 1.60.0），不存在漂移；
   - `./node_modules/.bin/playwright install --with-deps chrome` 安装 Chrome 稳定通道，
     使 foundations/ui-compare/real-browser 的**系统 Chrome 策略由安装满足**，
     而不是用 `RAH_UI_BROWSER=firefox` 掩盖 ChoiceRow 的 Chromium 依赖。
     Chrome 通道安装到 `/usr/bin/google-chrome-stable`，正落在 `findChromeExecutable()` 的候选内。
2. 接入本次 rc 相关门禁（各自带夹具、无重复 fixture 服务）：
   `test:web:mobile-navigation`、`message-menu`、`message-selection`、
   `task-filter-scope`、`scroll-ownership`、`sidebar-touch`，各自设置 timeout。
3. 不变量测试内容：每个启动引擎的步骤前必须有覆盖该引擎、带 `--with-deps`、版本与锁文件
   一致的安装步骤；缓存步骤必须在安装之前且以锁文件散列为 key；rc 门禁必须在 workflow 中出现。
   引擎需求由脚本源码推导（import 绑定 + 是否带 `executablePath` + 环境开关），
   新增脚本或改动启动方式会自动被覆盖，无白名单绕过。

与 Raft 的有意差异：不适用（本项为本仓 CI 基础设施，无上游对应合同）。

## 验证

本机 macOS，Playwright 1.60.0，浏览器缓存已存在（`~/Library/Caches/ms-playwright`
含 chromium-1223 / firefox-1538 / webkit-2287），未下载任何新浏览器。

| 命令                                                                  | 结果                                   |
| --------------------------------------------------------------------- | -------------------------------------- |
| `node --test scripts/ci-workflow-order.test.mjs`（修 ci.yml 前）      | exit 1，6 条预期违规（见上）           |
| `node --test scripts/ci-*.test.mjs`（修复后）                         | exit 0，8 passed / 0 failed            |
| `node scripts/test-choice-row-browser.mjs`                            | exit 0，`choice-state-profiles passed` |
| `HOME=<临时目录> node scripts/test-choice-row-browser.mjs`            | exit 1，`Executable doesn't exist ...` |
| `node scripts/test-task-empty-stability-browser.mjs`                  | exit 0（验证新增门禁自带夹具）         |
| `RAH_TOUCH_ENGINE=webkit node scripts/test-sidebar-touch-browser.mjs` | exit 0（验证 webkit 安装确有必要）     |
| `npx prettier --check`（三个改动文件）                                | exit 0                                 |

第四行是关键反证：把 `HOME` 指向空临时目录（等价于干净 CI 环境、无个人浏览器缓存）后，
`npm run check` 内的同一脚本按远端方式失败；因此"先安装后 check"的修复方向经过本机验证，
而不是只读 YAML 推断。

**本机通过 ≠ 远端 CI 通过。** 未获 push 授权，`.github/workflows/ci.yml` 的实际执行
（含 `--with-deps` 的 apt 依赖安装、Chrome 通道在 ubuntu-latest 上的落点、新增六个门禁的
真实耗时）记为待推送后验证，不声称绿色。

## 部署

未部署。本批仅改 CI 配置与测试脚本，不触及运行时、数据库或 Web 产物，按 §9 属无需重启
正式本地工作台的范围；未改动正式工作台进程。回退条件：`git checkout 98dc095 --
.github/workflows/ci.yml` 并删除两个新增脚本即可完全还原，无持久状态变更、无需备份。

## 剩余项

- **需 Fable 集成（package.json 为共享文件，本批未改）**：把
  `test:ci-workflow` 接入 `npm run check`，补丁见
  `scratchpad/batch-a/integration/R1-package.json.md`。未合入前，顺序不变量只在手动运行时生效。
- **远端验证缺口**：GitHub Actions 实跑未执行（无 push 授权）。首次推送需确认
  ① `playwright install --with-deps` 在 ubuntu-latest 的 apt 依赖安装成功；
  ② `chrome` 通道确实提供 `findChromeExecutable()` 能找到的路径；
  ③ 新增六个门禁的实际耗时与设定 timeout 匹配（当前按本机量级估设，可能需上调）。
- **门禁覆盖缺口（前端验证）**：`test:web:workbench`、`lan-workbench`、`firefox`、
  `build-recovery`、`media-preview` 需要先 `build:web:workbench`，本批未接入，
  理由是会显著拉长单 job 时间且应拆独立 job；`task-filter-touch`、`mobile-interactions`、
  `mobile-sidebar-return`、`task-presentation`、`sidebar-geometry` 与已接入集合在
  引擎与夹具上重叠，暂缓以控制总时长。两类都记为待排期，不算已完成。
- **后端验证缺口**：无（本项不涉及 Kernel/daemon 行为）。
- 本文件尚未链接进 `docs/README.md`（该文件不在本批可改范围），由 Fable 在合并批次证据时补链。
