# 设置页接线清单与已归档频道

本批只接已有后端能力，不新增设置协议。代码 `5e15c35`；正式页 http://127.0.0.1:4176/ 。

## 官方来源

- 仓库来源：`frontends/raft` 固定 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2 notices 保留。
- 最新锚点：Raft v1.21.16，`https://app.raft.build/assets/app-shell-L7litFx-.js`，SHA256 `80ccb22db7a9c7afdb5d0f0c9f99802251423ed578f7a3fca4524b5063664d88`。授权取得的本地格式化副本中 `yot`（约140183行）保留相同归档列表、排序、行布局与按钮行为；不是经过登录的官网视觉验收。
- 完整组合：`settingsNavigation.ts` → `SettingsPanel.tsx` 的 server tab / ServerTabContent → `ArchivedChannelsSection.tsx` → `SectionHeader`、`SurfaceListItem`、`Tooltip`、`UnarchiveChannelButton` → `raft-ui@0.5.64`。
- 官方行为：有归档频道才显示；归档日期倒序、名称兜底排序；名称打开频道；取消归档期间禁用其他恢复按钮；移动端上下布局、桌面左右布局；没有另加确认弹窗。

## 设置映射与后续顺序

| 官方区域                                                                                             | Loom 对应                                                                       | 本批结论                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 外观                                                                                                 | 既有 appearance owner / 原生控件                                                | 已接，保留                                                                                                   |
| Server / 已归档频道                                                                                  | `room.list`、`room.unarchive`、ManagementClient / RoomSession / WriteIntentSlot | 本批完成                                                                                                     |
| Account / 个人资料                                                                                   | `principal.me`、`principal.update`（含 expectedProfile）                        | 显示名／只读用户名／头像上传已接入，见[个人资料](2026-10-16-account-settings.zh-CN.md)；云账户功能不支持     |
| Administration / 系统频道                                                                            | `workspace.system-channel.read/update`                                          | 已核对并接入，见[系统频道设置](2026-10-16-system-settings.zh-CN.md)                                          |
| Language & Region                                                                                    | 原生 LocaleProvider；翻译偏好、时区等依赖 translationStore 和服务               | 本地界面仍有中文文案，不能把语言选择当作整站翻译完成；无完整偏好链路，不在本批加入                           |
| Notifications                                                                                        | 官方依赖 desktop native bridge 或 Web Push 配置/订阅                            | 不能用浏览器 permission 替代通知投递验收；暂不接                                                             |
| Account / 密码、社交绑定、退出；Billing；多用户管理；IM bridges；Apps；Labs；managed MCP / Providers | 与本地单 Human 范围、已有能力或明确退役决定不匹配                               | 不直接移植；不新增这些后端能力                                                                               |
| About / 版本                                                                                         | 可用 Loom build provenance                                                      | 官方版本块已接，见[组合交付](2026-10-16-task-board-actions.zh-CN.md)；手机官方下载、反馈和工作区云服务未搬入 |
| 当前运行设置                                                                                         | 既有 runtime.settings owner                                                     | 本地已有功能；不声称官方有同名高级设置，不继续堆参数                                                         |

因此下一批先做个人资料 / 系统频道的可直接对应部分，再回到任务拖动；不为填满空标签创建服务或配置项。

## 实现归属与差异

`settings-archive-adaptation.ts` 在构建时替换官方组件的 store/controller，原始源码文件不改。JSX、原生按钮、图标、日期格式、尺寸、类名、hover、移动端布局直接复用。Loom 的频道类型标签改为“频道”，避免误称为官方允许非成员访问的“公开频道”。原生 server tab 对应本地“运行设置”，嵌在既有同一内容滚动容器。

`ArchivedSettings.tsx` 是本地数据接线：只保存 `room.list` 的展示快照，15秒刷新；离开标签或有未决写入时取消读。恢复操作复用 ManagementClient.archive(false)，服务端负责权限、事务及 Room 事件。导航使用现有路由；未决时禁止跳走。未知结果保留当前行和 busy 状态，显示既有 OperationStatus，以同一 key/basis 核实；不增加业务队列。

读失败与操作失败分开保存，避免正常刷新清除明确拒绝提示。空列表按官方不渲染归档 section；初次加载也不渲染列表。权限仍由现有服务端单 Human 授权检查，不新增上游多用户 capability store。

## 验证与保留边界

- TDD：接线前 browser gate 因找不到归档行失败；拒绝场景复现“自动读回把拒绝提示清除”，分开错误来源后通过。
- 86项来源/接线检查通过；受影响类型检查与 `npm run build:web:workbench` 通过；仅保留原有 chunk/dynamic-import 警告。格式与 diff 检查通过。
- `LOOM_BROWSER_SLICE=settings-archive`：1440×1000 / 390×844，DPR1，以真实指针点击官方行；打开频道/返回、403拒绝保留错误、恢复提交成功后丢响应、同请求精确核实、刷新后持久恢复、无溢出/页面异常通过。隔离 Core，预热关闭，无付费模型调用。
- 正式服务先检查活动工作，备份2库/318文件，优雅重启 `com.loom.evo`；18张业务表关键投影不变，schema89；确认新进程、构建与端口后检查真实页面。
- 正式数据当前没有归档频道：双尺寸只验证运行设置正常、归档 section 空态隐藏及构建匹配，不声称真实用户频道执行过归档/恢复。真实 `room.list` 前后相同；恢复写入证据来自隔离 Core。
- 多人权限切换、跨设备实时推送、硬刷新恢复未决句柄未扩展；现有读回周期15秒，不宣称实时。未跑全后端、全前端浏览器或 paid gate。

证据目录：`/Users/sun/.loom/reviews/2026-10-16-settings-archive/`，含 build/source/browser/rejected-red 日志、restart/page JSON、双尺寸截图。结构化摘要见 [summary](../evo/evidence/2026-10-16-settings-archive/summary.json)。
