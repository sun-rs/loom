# 官方系统频道设置接线

代码 `a5009a1`。本批只接“管理 → 系统频道 → 隐藏 #all”，不新增后端能力。

## 来源与语义

官方源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，来源 `SettingsPanel.tsx` 的 AdministrationTabContent → SystemChannelsSection → SectionHeader / Checkbox / Banner / Button，使用 `raft-ui@0.5.64`。FSL-1.1-ALv2 notices 保留。最新锚点仍为 v1.21.16：授权 release bundle `https://app.raft.build/assets/app-shell-L7litFx-.js`，SHA256 `80ccb22db7a9c7afdb5d0f0c9f99802251423ed578f7a3fca4524b5063664d88`，格式化副本约152166行 `Ilt` 是相同开关、保存按钮和布局。没有声称做了登录后的官网视觉对比。

官方隐藏 #all 不是普通频道归档：隐藏列表、搜索、成员和发帖入口，历史保留。Loom 已有 `workspace.system-channel.read/update`，Kernel 按 workspace/control Room 管理权限执行，`system_hidden` 影响发现与读取；隐藏前 `assertNoActiveRoomWork`，并记录 control Room 事件，恢复保持同一 Room ID。无需把该操作改接 room.archive 或在 UI 删除频道。

## 实现

- `system-settings-adaptation.ts` 校验源码边界后仅替换官方 controller，完整表单 JSX、尺寸、Checkbox、颜色、文字、保存态直接复用；没有编辑被冻结的官方文件。
- `SystemSettings.tsx` 持有表单草稿，读取既有 API；保存调用现有 ManagementClient.control / WriteIntentSlot，使用 control Room 的 basis 和 idempotency key。后台没有新增队列或状态所有者。
- 保存成功更新本地读回，使用官方2秒“已保存”提示。未决时禁用开关及保存，由现有路由所有者阻止离开；unknown 使用既有核实入口重试同一请求，不能静默重发。明确拒绝保持草稿并提示检查权限/活动工作。
- 未获得读取结果不显示可操作表单；读取失败显示错误，重新打开页面重读。隐藏并恢复后仍是原频道，不创建替代 Room。

## 验证与边界

- TDD：接入前两列设置页找不到 Checkbox，针对性浏览器测试失败；实现后通过。
- 87项来源/接线检查、受影响类型检查、`build:web:workbench`、格式与 diff 通过；只保留已有 bundle warning。
- `LOOM_BROWSER_SLICE=system-settings`，1440×1000 / 390×844，DPR1：真实指针切换和保存、提交成功后丢响应、待核实禁用、精确同请求重放、隐藏后 room.list 不含 #all、刷新仍隐藏、恢复相同 Room ID、无页面异常/溢出通过。临时 Core，无付费 CLI 执行。
- 本批没有重测 Kernel 的活动工作拒绝或多 Human 权限矩阵，也没有把 UI 保存成功等同于这些额外验收；既有 Kernel 保护代码未变。
- 正式服务检查活动工作并备份后优雅重启；真实页面仅切换未提交草稿后切回，禁止设置写入，设置和 room.list 前后相同。双尺寸截图与新构建匹配；实际隐藏/恢复写入仅在隔离 Core 验证。
- 未做跨设备实时同步；硬刷新不能恢复内存中的 unknown 句柄。个人资料仍待接：principal.update 使用 profile CAS，没有频道同款幂等键，必须先明确未知结果读回，不套用本页重试。

[结构化证据](../evo/evidence/2026-10-16-system-settings/summary.json)。原始日志、重启回执和真实页截图在 `/Users/sun/.loom/reviews/2026-10-16-system-settings/`。
