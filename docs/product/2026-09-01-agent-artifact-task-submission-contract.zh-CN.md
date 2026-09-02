# Agent Artifact → TaskSubmission → Room Files 合同

日期：2026-09-01

## 目标

让真实 Agent 在 Task 执行期间显式发布文件，并在提交 Task 时把同一批文件
原子投影到 Task Thread Message、不可变 `TaskSubmission` 和 Room Files。
这条链不依赖 Provider transcript，也不把工作目录中的路径自动当成产物。

```text
Agent 明确调用 artifact-publish
  -> Activation credential / Task owner / Room / RunAttempt 校验
  -> RoomFiles 预约、流式写入、精确长度与 SHA-256 校验
  -> completed、尚未归属的 Task-scoped 暂存文件
  -> task-submit 的单一 SQLite 事务
       -> Task Thread Message(attachments)
       -> TaskSubmission(frozen artifact references + digest)
       -> room_files consumed/message owner
       -> task.submitted Room event
  -> Room Files、Thread、Review 读取同一份 canonical evidence
```

## Owner 与边界

- `packages/protocol`：Worker Artifact prepare、上传结果、冻结 Artifact
  reference 与扩展后的 TaskSubmission schema。
- `packages/kernel/RoomFiles`：Blob、Task-scoped 暂存、校验、消费、ACL。
- `packages/kernel/TaskReviewService`：submission number、Artifact evidence、
  canonical digest 与 Review 固定引用。
- `packages/kernel/RoomKernel`：Task state、Message、Submission、Files、Event
  的单一事务。
- `packages/application-service`：Activation credential 鉴权与有界 JSON/
  二进制转发，不解析路径或 Provider 输出。
- `packages/agent-host/worker-cli`：在 Agent 进程的 Computer 上安全打开显式
  路径、先 prepare 再流式 PUT；路径本身不进入 Room protocol。
- Web/PWA：继续消费已有 Message attachments 与 Room Files 投影，不创建
  另一套 Artifact 状态。

## 公共合同

`rah worker artifact-publish` 至少接收：

- `--task-id`：当前 Agent 正在执行的 canonical Task；
- `--path`：Computer 本地显式文件路径；
- `--idempotency-key`：稳定发布身份；
- 可选 `--filename`、`--mime-type`，缺省分别为 basename 与
  `application/octet-stream`。

CLI 必须拒绝目录、符号链接、空文件、超限文件及读取过程中发生的身份变化。
服务端只接收文件元数据和字节，不接收需要 daemon 自行解析的主机路径。

`task-submit` 不新增手工 Artifact 列表参数。它绑定当前 Agent 为该 Task 已
完成且尚未归属的全部暂存文件。这样保持 Multica 已验证的 task-scoped
完成语义，同时用 RAH Activation/RunAttempt fence 加强来源证明。

## 冻结证据

每个 submission Artifact reference 包含：

- `attachmentId`、filename、MIME、size、SHA-256；
- producer、Task、RunAttempt；
- ordinal，保证 digest 输入顺序稳定。

`TaskSubmission.submissionDigest` 的 domain 升级为 v2，并覆盖完整 Artifact
reference。旧 submission 没有 Artifact 时仍可按 v1 证据读取；不得重算并
改写旧 digest。

## 事务与失败

- prepare/upload 可以先于 `task-submit`，但未提交文件不出现在 Room Files。
- 上传中断、尺寸或摘要不符、Task 已释放/改派/提交、credential 失效时失败，
  且不能生成 Message、Submission 或 Files 条目。
- `task-submit` 内任何一步失败必须回滚 Task state、Message、Submission、
  Artifact references、文件消费与 Room event。
- 相同 idempotency key 重放返回原 submission；不能再次消费文件或创建第二条
  Thread reply。
- 失败/取消 Run 不自动发布文件。过期未归属字节沿用现有 RoomFiles 回收。

## 首批验收

1. protocol 拒绝伪造 owner/Room/RunAttempt 和非法 metadata。
2. Kernel 证明未提交不可见、成功提交三方投影一致、digest 覆盖文件、重放
   幂等、跨 Task/Agent/Room 注入失败、已归属文件不可抢占。
3. Worker HTTP/CLI 证明 credential scope、流式上传与显式路径边界。
4. 隔离真实浏览器在正式 Web 组件中看到 Agent Task Thread 附件与 Room
   Files 行，并验证跳转原消息、预览/下载和 reload 后持久存在。

## 实现与验收状态

2026-09-01 首批合同已实现：

- strict protocol、Kernel、Worker Application Service、Worker CLI、Runtime
  standing prompt 和 fake CLI fixture 已接入同一链路；没有新增浏览器侧或
  Provider 专用 Artifact truth。
- 定向 94 项测试全部通过；覆盖 prepare/upload/submit、ACL、冻结引用、v1/v2
  digest、路径不出 Computer、幂等与失败回滚。
- `1440x1000` 真实浏览器从 Human 勾选 Task 并 Enter 发送开始，观察到 Alice
  claim/start/progress、显式发布 `browser-gate-task-evidence.txt`、submit；随后
  同一文件同时出现在 Task Thread reply 与 Room Files。
- 真实浏览器完成文件预览、关闭预览、下载入口与“跳转到原消息”；reload 后
  exact-message deep link 自动打开原 Task Thread，并聚焦带附件的提交回复。
- 浏览器验收发现并修复了 Node 25 `FileHandle.createReadStream()` 生命周期导致
  预览关闭后 daemon 崩溃的问题。下载现在由独立 `createReadStream` 拥有 fd，
  并在 `open` 时再次校验 membership；关闭预览后等待仍无 `Failed to fetch`、
  console error 或进程退出。

首批尚未宣称：跨机器 Worker/Blob transport、Range 下载、Finder reveal、
自动 cwd 扫描、frozen Git diff/base/head、构建日志或 verifier evidence。
