# PWA 手机入口在正式重启后不可达

## 故障与恢复

用户反馈 PWA 一片空白。故障实例只监听 `127.0.0.1:4173`；此前已工作的 Tailnet 和局域网地址请求均为 `ECONNREFUSED`，本机入口仍返回 200。此前两种移动视口的本机验收不能证明手机网络入口可用，这一交付结论存在遗漏。

原因是源码工作台重启脚本的子进程只继承操作者当前 shell 环境，没有保存现役进程的 `RAH_TAILNET_HOST` 等启动参数。于是一次未携带该变量的重启把 Tailnet 模式静默降为 loopback。不是本轮已证实的前端脚本异常或 Room 数据丢失，也没有依据要求用户清除 PWA 缓存。

先沿原有正式重启守卫确认空闲、备份并恢复原 Tailnet 模式，复用同一冻结 Web 构建。三个原入口恢复 200；已通过 Tailnet 与 LAN 真实数据浏览器页面检查。未切换到 wildcard 监听、未取消认证、未发送消息或运行付费模型。

## 修复 owner

这是 RAH 本地部署拓扑，不复用 Raft 中央服务的重启配置。网络模式解释仍归 `workbench-launch-mode.mjs`，启动及操作脚本只保留该 owner 的输入语义。

- `run-local-workbench.mjs` 在服务启动成功后，以 0600 原子写入 `state/workbench-launch.json`，记录 PID 和实际模式。此文件是当前启动收据，不是第二份服务配置，不保存凭据或私钥内容。
- `restart-local-workbench.mjs` 在停止旧进程前读取收据，核对现役 PID、版本和模式，仅恢复受支持的网络环境字段；调用 shell 的旧 LAN/Tailnet 变量不会覆盖它。Tailnet 主地址保留，loopback 与本机私有 LAN 地址仍由现有模式 owner 发现。
- 缺失、损坏或旧 PID 收据拒绝重启，不能静默回退 loopback。尚无收据的旧实例只允许通过显式 `--adopt-network-from-environment` 一次性迁移，操作者须先核对现役监听及原模式。迁移后的启动生成新收据，后续正常重启无需再提供网络变量。
- 保留既有精确 PID/工作目录/数据库/监听校验、空闲栅栏、状态备份、冻结构建、正常停止与日志轮换；不自动扩大网络暴露范围。

## 回归

新增 `test:workbench-launch` 并纳入 `npm run check`。先记录当前故障：本机 200、原 Tailnet/LAN 连接拒绝。测试在缺少修复模块时失败，再实现收据及恢复规则。覆盖空 shell 保留 Tailnet、LAN HTTPS 参数与证书路径、清理冲突 shell 变量、显式 loopback、缺失/旧 PID/非法模式拒绝、0600 原子替换。最终正式验证必须包含一次不带任何网络变量的重启，以及原手机网络入口上的新页面；仅本机 health 不算修复验收。

## 本次验收结果

- `npm run check`、`npm run format:check`、`git diff --check` 通过；网络模式及收据测试共 9 项通过。日志：`/tmp/pwa-restart-check.log`、`/tmp/pwa-restart-format.log`、`/tmp/pwa-receipt-green.log`。
- 在无收据的现役实例上执行普通重启，命令在停止前按预期失败，原进程及三个监听保持可用。随后显式采用原网络模式完成一次迁移，再清空全部六个网络环境变量执行普通重启成功。两次均通过空闲、备份、构建及正常停止守卫；第二次备份为 `~/.rah/backups/pre-restart-25424d2f-1a2c-487d-82a3-1e0764975cf1`，启动收据更新为新 PID，原三个监听仍存在。日志：`/tmp/pwa-missing-receipt-guard.log`、`/tmp/pwa-receipt-migration.log`、`/tmp/pwa-receipt-normal-restart.log`。
- 复用已验证冻结 Web 构建 `8cdf037caab506a7a12e6f0a9f2dc46b6e713c7bc73b4e5819e40d230cb205c7`；本修复只改变启动脚本，不重建或替换前端资源。
- 最后一次重启后，从实际 Tailnet、LAN origin 分别新建 Chromium 页面，以 430×932 触摸视口检查首页、通知、搜索、动态、任务及筛选、成员、设置、频道、私聊和返回，并检查桌面展示；两条浏览器门禁均通过，已查看首页及频道截图。证据目录为系统临时目录下的 `rah-mobile-polish-formal-xZ3wxN`、`rah-mobile-polish-formal-aufdGS`；门禁日志为 `/tmp/pwa-final-tailnet-browser.log`、`/tmp/pwa-final-lan-browser.log`。
- 用户明确回复原 PWA「已恢复」。浏览器自动验收不是物理 iOS 自动化或 Raft 双边视觉验收；本次未运行付费 CLI、未提交或推送代码。
