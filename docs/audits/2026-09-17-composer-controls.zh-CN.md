# Composer 单加号与停止验收

范围：本机路径引用、浏览器设备上传入口，以及频道／私聊／消息列共享的
发送／停止控件。当前合同与源码来源见
[Composer controls](../design/composer-controls.md)。已有其他施工改动保持原样，
本批不签发版本、不提交、不推送、不运行付费 Provider。

## 已复现并修复

1. 停止请求落在 Runtime 启动前时，Worker 授权围栏令启动失败，但普通 retry
   会把 Activation 推进下一 attempt，旧 SOS target 永远 requested。失败测试
   明确得到 `stopping + pendingTargetCount: 1`；现在 retry 在无存活 Runtime、
   无未结束 RunAttempt 后优先完成既有 cancellation。
2. 停止过程中 Host 中断并恢复，目标已证明停止但 operation 尚未收口。
   假时钟回归复现 `stopping + pendingTargetCount: 0`；恢复 owner 现在在
   lease/quarantine 恢复事务里完成 SOS，已有修正输入按同一合同恢复。
3. 窄屏通用 dialog 样式把文件选择框顶到屏幕上方；390x844 的几何失败测试
   复现，现独立文件窗口保持居中，并保留 backdrop、Escape、焦点恢复。

## 验证边界

| 内容           | 证据与结果                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| 权限与文件范围 | AgentHost 临时根目录测试、HTTP 未认证／Agent 拒绝、路径越界与符号链接拒绝通过；返回路径不含正文                |
| 停止协议       | Channel/DM、其他 Room 隔离、手动 SOS 保留、启动竞态、Host 恢复、修正消息／Task 与幂等冲突测试通过              |
| 浏览器控件     | Chromium、WebKit 在 1440x900 与 390x844 通过；频道／消息列／私聊、路径插入、菜单、停止失败、重试、重载及重发   |
| 原有上传       | Chrome、Firefox 桌面与窄屏门禁通过；原生 chooser、过滤、多选、取消、重复选择、字节一致下载、迟到响应与草稿隔离 |
| 图片验收       | 已查看桌面与 390x844 文件选择截图；窗口居中、按钮可点击，内容不横向溢出                                        |
| 全量检查       | 收口记录见下节                                                                                                 |
| 真实 Provider  | 未运行；真实子进程使用显式 Fake CLI，不作付费 CLI 停止能力验收声明                                             |
| iPhone 实机    | 未运行；WebKit 触摸仿真不等于实机照片／相机选择器验收                                                          |
| Raft 双边      | 引用已有授权源码证据；单加号和自动恢复是用户要求的本地差异，不声明 1:1 双边功能验收                            |

可复跑入口：`npm run test:web:composer-controls`、
`RAH_UI_BROWSER=webkit npm run test:web:composer-controls`、
`npm run test:web:composer-drop`。正式只读验收使用显式
`RAH_FORMAL_ORIGIN` / `RAH_FORMAL_DATABASE` 与
`node scripts/test-composer-formal-browser.mjs`；禁止 stop、上传或发消息，
前后核对 Room 事件序列不变，仅允许已有浏览已读进度更新。

## 收口与正式部署

- `npm run check` 全量通过，包含 17 项未启用的付费门禁 skip；
  `npm run format:check`、`git diff --check`、`npm run build:web:workbench`
  通过。正式验收补充已有头像 GET 白名单后，专门的只读请求策略测试 15/15
  通过；Stop、上传和发消息仍不在正式验收白名单内。
- Chromium 与 WebKit 的最后单独运行均通过。一次并行浏览器运行记录到 WebKit
  页面切换期间 `rooms/sync` 的 access-control 错误，单独复跑通过；没有过滤或
  忽略 pageerror 来使门禁通过。实机 iPhone 验收仍未执行。
- 重启保护曾因另一轮构建替换了候选 Web build ID 而拒绝继续，旧实例未被停止。
  随后重新构建并冻结：Web build
  `9811f908371d5daf4abf9ccbbc12f6c3d967f40f6074ee15061a9bbbf339321c`，
  development identity `57fb6ebbd2e726f9`，不冒充正式签发的版本号。
- 正式状态备份已核验：`~/.rah/backups/pre-restart-97587b69-38f8-4ea1-8d1e-745d84bc1015`。
  旧 PID 80749 正常退出，后继 PID 78408；监听集合仍为原本的 loopback、显式
  LAN 与 Tailnet，三个入口 health 均返回一致身份。
- 新浏览器正式验收在 1440x900、390x844 均通过：真实 home 目录非空、窗口居中、
  Escape 关闭、重新加载、执行状态读取均正常，Room 事件序列前后不变。
  本轮没有通过正式实例停止 Agent、发消息或上传附件，运行停止使用隔离 Fake CLI
  子进程验收。正式检查截图位于本机临时证据目录
  `rah-composer-formal-1s0bmp`；不会将私人目录列表复制进仓库。

未提交、未推送。Provider 实际停止与 iPhone 原生 picker 的验收不由上述自动化替代。
