# 外观设置：显示 Agent 模型

## 来源与采用边界

来源：Raft 已发布前端 `https://app.raft.build/assets/index-MqTUR4Ez.js`，
SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`；
分析目录 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。
`SettingsPanel-Ce-jc2IN.js.pretty.js` 的 `ld`（13083 起）接同一外观偏好控制预览和聊天；
主 bundle `t3e`（79195 附近）以 `raftDesktop.isDesktop` 区分原生桌面默认开与 Web 默认关，
不是 viewport breakpoint。`Jrt`/`Zrt`（141927）优先模型显示名、回退绑定值，缺失则不显示；
MessageItem（147402）使用 `font-mono text-[11px] leading-none text-black/40`，放在名字之后、时间之前。

此批根据上述参数作结构实现与 RAH 接线，无上游字节复制或新增第三方资源；
发布 bundle 保持分析专用，既有字体与图标沿用原 provenance/notice。

## 单一所有者与行为

- `settings-preferences.ts` 保存本设备 `rah:settings:agent-model-name`，默认 Web/PWA 关闭。
  现阶段没有原生桌面桥，不能把大窗口伪装成原生桌面。保存失败仍允许本次切换并显示准确提示。
- 外观页面使用现有设置卡片和开关，预览展示 `preview`；开关即时更新预览和消息。
- Kernel 现有 ACL 过滤的 Agent 目录，在当前 definition revision 关联的 execution policy 上投影
  可选 `modelBindingId`（首个明确绑定）。这是已保存配置，不是某条历史消息运行时的模型溯源。
  不新增状态表、权限或按消息请求，旧 daemon 缺少可选字段时不显示。
- ui-web 目录保留该字段，消息通过现有授权实体目录解析本机模型显示名，目录缺失时回退绑定 ID。
  不把 CLI 名称、自动选择或未知模型伪造为已知模型。
- Room、DM、Thread 复用 `MessageArticle` / `MessageModelName`；Human 和未配置模型的 Agent 不显示标签。
  固定 11px / 11px 等宽字，40% 黑色，不跟随消息正文字号缩放。
  预览 metadata 居中对齐、间距8px、时间12/16px；外观开关使用 Raft brutal md 的36×20px、14px滑块、1px内边距、16px位移。

## 验证

先复现偏好函数缺失、目录缺少模型字段、浏览器没有开关三个失败，再实现。
`agent-model-preference.test.ts` 覆盖默认、开关、刷新应用、读取失败与保存失败；
Kernel `agent-created-agents.test.ts` 验证当前策略的目录投影；
ui-web `room-view-model.test.ts` 验证目录字段传递。
`test-agent-model-appearance-browser.mjs` 使用临时 Kernel 和 Fake provider fixture，
验证即时预览、开关与刷新、1440×1000 与 390×844、真实 MessageArticle 的 Agent/Human/未配置分支。
Fixture 页面明确标识，未调用真实付费 CLI。

## 交付验证结果

- `npm run check` 通过；核心测试1592项，1575通过、17项按既有条件跳过；Web单测408通过。
- 最终CSS变更后重跑两个组件规格浏览器门禁、目录生成和UI库/规格/目录/行为合同/Raft回归检查，全部通过。
- `npm run format:check`、`git diff --check` 与 `npm run build:web:workbench` 通过。
- 专项 `npm run test:web:agent-model-appearance` 已通过；截图人工检查了桌面与390×844布局。
- 正式构建 `94ebae7e486821a79a60b89878db043cdfdbbfff83d7520578ab26f7e82d43a9`。
  另一并行交付在本批验收前已将28157平稳替换为38392，独立重启监督进程38342的参数与构建一致。
  备份 `/Users/sun/.rah/backups/pre-restart-4e28c6a9-b4d3-49f4-b763-bdfeb2de2729` 的receipt记录了相同旧实例与构建。
  本批旧PID保护检查拒绝了再次操作，不重复中断已更新实例。
- 独立Chrome新会话分别验收 `127.0.0.1`、`192.168.1.86`、`100.101.107.87` 的4173正式服务：
  构建标识一致，预览切换/刷新保留、已有真实Agent消息的模型开关通过，页面异常为零。
  未发送消息、修改Agent配置或调用付费CLI；用户原浏览器的本地偏好不受测试会话影响。
- 证据：`/tmp/rah-model-check.log`、`/tmp/rah-model-browser-final.log`、`/tmp/rah-model-formal.log`；
  正式截图 `/tmp/rah-model-formal-127.0.0.1.png`、`/tmp/rah-model-formal-chat-127.0.0.1.png`。

本批依据Raft源码和用户截图核对，不宣称同视口Raft双边完整验收；未提交、推送或运行真实付费Provider。
