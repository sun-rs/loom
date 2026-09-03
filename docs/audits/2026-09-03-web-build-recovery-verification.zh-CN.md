# Web 构建代际恢复验证审计

日期：2026-09-03

裁决：**本批通过。旧标签页与新 gateway 混用不再把 parser 错误写进消息；提示、继续、刷新、
typed deep link 和两种尺寸均有真实 Chrome 证据。**

## 1. 实现审查

| 风险                       | 修复后的 owner                                                                         | 审查结论                                 |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| restart 后旧 JS 解析新 API | gateway 每个 static/API 响应发 `x-rah-web-build-id`；全局 fetch fence 在 parser 前等待 | 不再由 Message renderer 逐行复制错误     |
| lazy chunk 已被新发布替换  | Raft 式 `vite:preloadError` + `unhandledrejection` 分类                                | 显示同一刷新合同，不白屏                 |
| 自动刷新丢 draft           | modal 明示风险，默认聚焦立即刷新，但保留 Human 的“仍然继续”                            | Human authority 保留                     |
| 刷新落回错误页面           | `location.replace` 只增临时 `rah_recover`，新页 bootstrap 立即移除                     | Room/Settings/Task typed query 保留      |
| cache 清理越权             | 只清 `rah-os-shell-*` / `rah-os-assets-*`                                              | 不删除同源其他 cache                     |
| 相同 build 每次生成目录    | ID 改为 emitted content SHA-256                                                        | 连续构建同 ID，同一 frozen snapshot 路径 |
| 构建写到一半被启动         | runner 要求 metadata 与 index meta 唯一且相等                                          | 缺失/不一致均 fail closed                |

Raft 来源、SHA 与 offsets 见
[产品合同](../product/2026-09-03-web-build-recovery-contract.zh-CN.md)。本批移植的是 Raft 的
Human 可见恢复合同；build response header 是 RAH OS 本地 gateway 可提供的可靠增益，不冒充
Raft Server 源码。

## 2. TDD 与自动门禁

- 第一轮定向测试先出现预期失败：Web recovery module 不存在、gateway response 无 build
  header；实现后 8 项通过。
- Vite 8 下最初在 `generateBundle` 读取最终 HTML 失败，门禁报
  `Product index.html is missing from the Web bundle`；改为 `transformIndexHtml + closeBundle`
  后才放行。
- 完整 `npm run check`：packages `835` 项（`833` 通过、`2` 个付费 Provider opt-in 跳过），
  Web `242/242`，parity callbacks `34/34`。
- build/recovery/asset/gateway 定向门禁最终 `28/28`。
- `npm audit --omit=dev`、`npm run format:check`、`git diff --check` 通过；最终复核结果以本报告
  末尾记录为准。

## 3. 隔离真实 Chromium

`npm run test:web:build-recovery` 先构建正式 bundle，再以隔离服务器故意返回不同
generation header：

- desktop `1280×800`：modal 可见；“立即刷新”获得初始焦点；typed query 保持；点击“仍然
  继续”后出现新版本 banner，再点击 banner 的“刷新”进入当前 generation；
- mobile `390×844`：card 完全在 viewport；两按钮纵向、等宽；“立即刷新”可由真实鼠标点击；
- 两个场景 console error 均为空。

人工逐张检查 `/tmp/rah-web-build-recovery-desktop.png` 与
`/tmp/rah-web-build-recovery-mobile.png`：边框/阴影/粉色 primary 与 RAH 现有 token 一致，桌面
横排和移动端纵排没有截断或溢出。`/tmp` 图片是验收临时证据，不作为产品输入。

## 4. 正式实例两次代际切换

正式端口 `127.0.0.1:4173` 使用持久状态，不启动付费模型：

1. 旧 formal gateway 没有 header；确认所有 active activation/run/process/input/reminder/
   reassignment/lease/computer operation 均为 `0`，保留一个 `submitted` Task。
2. 在线备份到
   `/Users/sun/.rah/backups/pre-web-build-recovery-20260903-h0Mqyl`；Room、runtime registry、
   Web Push 三库均以 immutable read 验证 `quick_check=ok`，Room schema `43`，Agent memory
   文件 `35` 个。
3. graceful SIGTERM 后部署 generation A；已打开 Chrome typed Notifications 页面。部署 B 后，
   旧 A 标签页在 16 秒 probe 窗口内出现 modal，URL 不变、console error 为空；走 Continue→
   banner→Refresh 后仍回 Notifications。
4. 切换到最终确定性 generation C 后，旧 B 标签页再次出现 modal；走 Immediate Refresh，
   Notifications 标题和 typed query 恢复，prompt/banner 均消失，console error 为空。
5. 最终 generation：
   `53d68d60e9d5ec2bc1c61924e450127f3ee2e4c1d81a6794fff6ae4b4efb858f`。

## 5. 性能与剩余项

- 15 秒 probe 是单个 `HEAD /`，无正文、不触发 Room sync、Provider CLI 或模型上下文；focus /
  visibility probe 同样不产生业务事件。
- `.workbench-web` 在本批前已有 `115` 个目录、约 `1.8 GiB`；随机 UUID 方案会继续放大，已被
  内容 ID 替换。旧目录尚未删除，因为必须先识别 active/pinned release 与 retention；这是 P1
  磁盘 GC，不影响本批正确性。
- production `mount-app` chunk 约 `1.208 MiB`（gzip 约 `359 KiB`）仍触发 Vite size warning；
  这是 P2 code-splitting/启动成本，不是本批 parser 错误。
- daemon 常驻 RSS 的 1h/24h owner 分解仍是独立 P1；本批只增加无正文 HEAD 和一个短 build
  ID header，不能替代长期 soak。

本报告只允许宣称跨 Web build 的旧页自愈闭环，不扩大为任意 daemon/API schema 的长期兼容，
也不宣称历史 release GC 或常驻内存优化已经完成。
