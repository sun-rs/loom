# LIFECYCLE-E2E-1：三层换班 + 三层重启恢复 端到端实测（测好再上线）

用户 2026-11-27："换班的三个层次，super / leader auditor / worker，也要测试好了以后上线，推送代码，重启恢复三个层次角色也要测试，完成后提交。"
基线：最新 main（含 CCP-ROUTE-1、RESUME-1、WORKER-REAP-2；设计见 docs/research/2026-11-27-lifecycle-design.md）。

## 环境
- 一次性项目目录（/tmp 下短路径），用当前 main 的 release 启动 loomd（LOOM_HERDR_LAYOUT 可开，用于验证"同一标签页"）；`LOOM_GLOBAL_DIR` 指向一次性目录，**不碰真实 ~/.loom 与真实 pilot**。
- 角色：Leader 用 agy、Auditor 用 Claude（**只经 CCP 入口 /Users/sun/.local/bin/claude**）、worker 用 Codex 或 agy。真实模型请求尽量少（每项 ≤3 次最小请求），能用假 CLI 证明的先用假 CLI。
- 每启动一个 Claude 进程，立刻用 `ps eww`（只看代理变量）与 `lsof -nP -a -p <pid> -i` 核验只连 127.0.0.1:17891；发现任何非 CCP Claude 进程立即停止全部实验并报告。

## 要测（每项写：步骤、命令、期望、实际、PASS/FAIL、证据路径）
A. **worker 层**
  1. 卡内交接：worker 运行中执行 worker-handoff，新 worker 接手同卡、首报核实分支/SHA/WIP；旧 worker 释放。
  2. 卡完成后释放：结果确认后进入空闲计时、TTL 到期下线（可把 TTL 调短）；回执缺失 10 分钟（调短）标 UNCONFIRMED 仍下线。
  3. 跨卡复用与新开按 R28/R31 规则各走一次。
B. **Leader / Auditor 层**
  1. Leader（agy）自助换班：rotate --self，继任首轮核对、另一方确认、前任只读后退役。
  2. Auditor（Claude 经 CCP）自助换班：同上；继任 Claude 进程核验 CCP。
  3. 错峰：一方换班中另一方被拒绝同时换班。
  4. 失败路径：继任起不来 → 前任留任、通知 Super、继任终端回收。
C. **Super 层**
  1. `loom up`：无记录新开 Super；正常结束后再 `loom up` 新开并注入实况（检查 ≤12 行、`live.md` 生成）+ 交接单。
  2. 异常结束后 `loom up` 出现"续接原会话 / 新开"两个选项，两条路都走通（Super 用 Claude 时经 CCP `--resume`）。
  3. 同一 Herdr 标签页：新 Super 在原 Super 标签页位置启动（若一次性环境无法验证 Herdr，写明并给出替代证据）。
D. **重启恢复（三层）**
  1. 单进程中断：kill 一个 worker / Leader / Auditor 的 CLI 进程 → `loom recover` 列出 → `loom resume` 接回原会话（Codex thread、Claude --resume 经 CCP、agy 按能力或交接单新开）。
  2. loomd 崩溃：kill loomd → 重新拉起 → 角色与投递水位恢复，无丢失无重复。
  3. 模拟整机重启：停掉一次性环境里所有 loom 相关进程（holder、loomd、CLI）→ `loom up` → `loom recover --all-projects` → `loom project up` → 逐个 resume（Auditor→Leader→worker）→ 原工作继续。
E. 发现的缺陷：写 RED 测试并修复（在本分支），修完重跑对应项。

## 交付
分支 infra/lifecycle-e2e，工作树 /Users/sun/Code/repos/loom-lifecycle-e2e；RESULT.md 给总表（A1–D3 每项 PASS/FAIL）、修复的缺陷清单、全量 `npm test`/`npm run lint` 通过；显式路径提交，不 commit -a，不 push。实验结束停掉所有一次性进程并清理目录。不读凭据，不碰 /Users/sun/Code/ccp 与真实 pilot。
