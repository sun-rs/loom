# Runtime 设置页与默认 Guide

用户要求：仅分析投递/生命周期/prompt 差异并给建议，撤回该部分未交付施工；实际优化设置页，支持的 Guide 默认开启。

## 实现边界

- 逐项撤回中断批次对 standing prompt compiler/lease/composition、Claude busy gate/driver、Runtime effective-mode helper 及相关测试的未交付修改。原有正式 Guide 功能不回滚。后端差异与修改建议见 [独立审查](./2026-09-11-delivery-lifecycle-prompt-review.zh-CN.md)，本批不宣称这些问题已修复。
- Settings Runtime 使用 860px 内容上限、条目间 18px 间距、分离标题/投递方式/说明/控件；移动端开关独立一行。图标和颜色来自现有 Raft-derived 共享库：code-xml/bot/globe/blocks 与 cyan/orange/lavender/yellow。它们是产品区分图标，不伪称各 CLI 的官方品牌标识或 Raft 原页面的精准参数。
- 使用共享 checkbox 样式和既有 Settings 容器；独立 CSS owner 位于 ui-tokens/runtime-settings.css。颜色不代表在线、执行或消息已读状态。
- 新建设置默认启用 Codex/Claude；Kimi/OpenCode 当前 Guide 未接通，继续等待。已经保存的显式开关不会在每次重启时被强行覆盖；本次按用户新选择，将正式实例的支持项开启。

## 验证边界

先验证新的默认值断言失败、间距/图标浏览器断言失败，再实现并复跑。隔离 Chrome 检查 1440×900 与 390×844，涵盖间距、有效图标、鼠标与键盘开关、禁用状态和无横向溢出；已查看双尺寸截图。未调用付费模型。

## 正式交付验证

- `npm run check`、`npm run format:check`、`git diff --check` 通过；正式 Web 构建及隔离浏览器检查通过。
- 确认正式实例无活动执行后备份状态并温和重启，历史、配置与私有记忆保留。备份位于 `/Users/sun/.rah/backups/pre-restart-9d15a188-34ea-4437-ad11-da80b97925d5`。
- 本轮冻结 Web build 为 `16c13e091631fe6e9afb2e2b61f79e6825ef22e3b367e850b86e900473da90ce`；重启后监听 4173 的进程为 27527（仅本轮交付时观测）。
- 正式 Chrome 实测认证读取、鼠标切换、刷新后持久化、未接通项禁用、桌面与手机尺寸无横向溢出通过；已亲自查看双尺寸截图。按用户要求，正式设置最终为 Codex/Claude 开启，revision 12。
- 截图证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-settings-redesign/`，文件为 `formal-runtime-guide-desktop.png` 与 `formal-runtime-guide-mobile.png`。
- 未执行付费模型实验，未提交或推送 Git。本轮浏览器验证不是 Raft 双边生命周期验收。
