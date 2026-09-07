# 文件预览下载反馈与重试

## 问题与修复

FileCard 原有 pending/error，但 FilePreview 的下载按钮不消费它们：请求期间可重复触发，
错误只显示在模态弹层背后。先由真实隔离 daemon/浏览器复现 pending 断言失败，
再让三个下载入口复用 FileCard 的状态和同步 in-flight guard。弹层内显示错误，失败后可重试；
无新增传输、附件状态或鉴权方式。

## 来源与有意差异

沿用[文件合同](../product/2026-09-03-file-preview-parity-contract.zh-CN.md)。
授权 Raft frozen `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，
SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：
`B8` 获取 `/attachments/{id}/url?disposition=attachment` 后触发下载，`_it/Ait`
共享下载回调；没有据此声称上游具备相同 pending/error 合同。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/use-download-attachment.ts` 在失败时显示 toast，
`attachment-preview-modal.tsx` 复用该下载 hook。本地保持现有 header-authenticated
Blob 下载，在当前 dialog 显示失败；不引入云端签名 URL 或复制未知 Server。
本次为 RAH 生命周期/反馈 glue，视觉仍沿用内部既有预览组件。

## 本地浏览器证据

日志：`/Users/sun/Code/reviews/rah_os/2026-09-07-file-download`。
`red-final.log` 是实际 content 请求被保持期间下载按钮仍可用的预期失败。
早期 red.log 有门禁路由设置错误，不能作为有效复现。

`test:web:file-download` 使用临时 daemon、独立无 Agent Room 和真实文件上传：
上传→发送→重载→预览→保持下载请求→503/403→显示错误→重试→下载内容逐字节一致→
Escape 关闭并返回原触发焦点。Chrome/Firefox ×1440×900/390×844 通过。
只注入下载失败响应，成功路径走真实本地附件 owner；不使用付费 Provider。
已查看窄屏错误截图。该门禁不是官网双边验收，也不证明完整文件菜单或大文件媒体预览。

剩余文件边界：完整菜单焦点/键盘/共享 primitive 收口、复杂类型与大文件/PDF/音视频安全
流式预览、官方非空文件树同条件比较。后续仍按既定顺序处理 Computer 与必要 Settings。
本次没有关闭文件页面族整体，也没有缩小这些既有缺口。

## 最终检查与正式恢复

`npm run check`、`npm run format:check`、`git diff --check`、正式 Web build 和
`test:web:file-download` 均通过；后者另验证 pending 时关闭再打开预览，所有入口仍保持
同一下载状态，未新增请求。
最终浏览器证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-file-download-ANdXKA`。

正式 idle/备份验证/精确优雅重启完成：

- build：`86ef546135fbd89d1f72bdb8ff5a4e8ebd6d037df34c03d3fff8a5c95a2653cf`。
- 备份：`/Users/sun/.rah/backups/pre-restart-918ea6ec-2fe7-462e-9d52-251305b82705`。
- 正式地址 <http://127.0.0.1:4173>，交付时进程 72131。
- `test:web:formal-discovery` Chrome/Firefox 新页面通过；已查看正式桌面截图。
- 正式证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-4Kphze`。

前后 6 Rooms、43 messages、2 Tasks、4 Agents、37 memory files 保留，消息/任务/记忆摘要一致。
**整体快照不是完全相同**：事件由 378 增至 380，Agent revision 由 35 增至 36。
已逐字段追查，来源是 `local-workbench-runtime-bindings.ts` 既有启动迁移：Claude executable
由本机 `versions/2.1.234` 变为 `versions/2.1.263`，生成新 runtime profile revision；
一个 Agent 的 allowedOfferIds 更新到对应 offer，再生成 policy/Agent revision。
新旧 runtime manifest 只有 adapter.executable 不同；policy 业务字段仅 allowedOfferIds 改变，
模型、effort、角色内容不变。没有把迁移产生的正常修订隐瞒为“配置摘要完全一致”。
本批没有安装 CLI、运行付费 Provider 或修改该迁移机制，无 commit/push。
