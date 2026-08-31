# Files 与空间 / Computer 校准

## 来源及决策

2026-08-31 登录 Raft 实页核对：左上角按钮的 accessible name 为“切换服务器（当前：hakasemac）”；当前实测 hover 显示名称 tooltip，点击弹出已加入服务器列表，不是计算机选择器。Computer 导航直接显示第一台计算机。Files 是当前对话已发送附件的列表，行操作为“跳转到原消息 / 下载文件”，不是独立网盘。

- Raft `raft-computer@1.0.18` source map 中 `packages/shared/src/attachmentUploadContract.ts`：200 MiB 上限、上传预约、服务器验证、完成 / 取消 / 过期，发送前的附件不等同已发送消息。
- Multica `server/internal/storage/local.go`：服务端生成存储标识、临时文件后原子发布；`server/internal/handler/file.go`：访问控制、稳定附件标识与下载地址分离；`packages/core/drafts/upload-coordinator.ts`：上传不能依附会被切换销毁的 composer，结果须检查所属 draft。
- 这是上述设计的 TypeScript / 本机存储适配，不宣称逐字复制 Go 或移植 Raft 云端。无需引入 OpenAgents。

## 本批 Files 边界和 owner

1. protocol 定义附件元信息与上传 / 列表合同。
2. Kernel 文件服务持有上传预约、二进制存储、ACL 和发送绑定；消息提交在同一个 SQLite 事务中消费预约、追加 canonical Message / Room event / Inbox。
3. application-service 只认证、校验和流式转发；RahClient 持有 HTTP；页面不直接请求后端或解析 CLI。
4. Web 同一 composer 用于 channel / DM。未发送附件不进入 Files；发送成功才清 draft。文件列表可预览、下载和定位原消息。

本机没有对象存储，采用 prepare → authenticated PUT → 服务端校验并完成上传，而非浏览器先 PUT 云端再回调 complete。单个文件最多 200 MiB；流式写入，不使用 base64 JSON。文件名不参与磁盘路径。下载每次重新校验 Room membership。HTML / SVG 不作为活动页面执行。首批不涵盖 Worker 发布产物、Task 提交产物、线程 composer 附件、多机 blob 同步；不据此宣称 Artifact 全量收口。

Schema v22 是加法迁移：`messages.attachments_json` 默认为空数组，新建 `room_files` 保存上传预约及消息关联；旧消息不变。上传最多保留一小时、每个用户最多 20 个未消费预约、每条消息最多 10 个附件。启动 / 新建预约时分批回收过期未发送字节，保留幂等墓碑；不扫描或删除已发送文件。浏览器普通下载仍会在客户端接收完整 Blob，大文件断点续传 / 范围下载另列后续。

验收：准备 / 未发送不可见、消息关联与幂等、过期 / 取消 / 尺寸不符、跨 Room 和跨成员越权、磁盘重开后恢复、列表分页与原消息跳转、真实浏览器上传下载。既有长消息虚拟窗口与上翻 anchor 继续使用，单独执行现有回归，不新造滚动实现。

## 空间 / Computer 修复方案

- 将当前“点击空间标识打开编辑弹窗”拆成 anchored server/workspace switcher 和独立编辑入口。保留已有 Workspace 更新 / 选择 owner。头像来自空间配置，字母 fallback 来自空间名；初建空间名可取本机名，不能持续把空间当计算机。
- Computer 默认选中第一台，支持 deep link / 记住有效选择；空目录才为空态。
- 独立 Computer read model：hostId、displayName、hostname、description、OS/arch、版本、注册人/时间、heartbeat / lastSeen、该机 Agents、检测到的 Runtime。`runtime.available` 仅代表 CLI 可用，不能当 Computer 在线判断。
- 沿用 Raft 信息分段、编辑铅笔、runtime badges、离线恢复指引。未实现的远程安装与控制暂禁用，不伪造 Raft restart 命令为 RAH 命令。

## 已有能力的范围澄清

已安装 Codex / Claude / Kimi / OpenCode 的调用和模型 / effort 发现已经有实现及独立验收记录；本批不重写。按用户明确的产品边界：CLI 安装、账号配置和登录由用户负责，RAH OS 只发现、调用和管理，不把 CLI 安装向导列为交付缺口。RAH 自身 Computer 服务的安装是不同事项。后续仅在版本变化或可复现问题出现时修复发现链，不能承诺动态上游永久完美。
