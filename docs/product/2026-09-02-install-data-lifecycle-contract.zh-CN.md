# 安装、改名与用户数据生命周期合同

状态：Accepted，2026-09-02。

## 结论

RAH OS 的可替换程序与不可替代用户数据拥有不同生命周期。规范 durable root 是 `~/.rah`；当前应用显示名不进入默认磁盘路径，因此将来改名、替换源码 checkout、升级 SEA 或删除应用本体都不会改变 Room/Agent/Task/Memory/TLS 的身份位置。

`RAH_DATA_HOME` 是规范覆盖变量；`RAH_OS_HOME` 只保留为旧部署的直接根目录别名。两者同时存在但不一致时 fail closed。LaunchAgent 只写 `RAH_DATA_HOME`，不把 secret 放进 plist。

## 旧数据迁移

旧默认 `~/Library/Application Support/RAH OS` 在首次未显式覆盖的启动/安装前迁移：

1. 若 `~/.rah` 不存在，同卷原子 rename 整个旧根。
2. 若 `~/.rah` 已有旧 RAH 的 `runtime-daemon/`、`auth/`、`council/` 等数据，先递归检查所有交叠路径；任何同名文件、类型冲突或符号链接都在移动前拒绝。
3. 通过预检后，旧根先原子 rename 为 `~/.rah/.local-core-migration-v1`，再把无冲突 child 移入稳定根；中途崩溃由下一次启动继续 staging。
4. 完成后写 `0600` migration receipt，根目录收紧为 `0700`。迁移不复制 25 GB 数据，也不覆盖旧 RAH 状态。

显式 `RAH_DATA_HOME` / 兼容 `RAH_OS_HOME` 不触发默认旧目录迁移，避免把用户有意隔离的数据偷偷合并。

## 卸载边界

`rah-os-core uninstall` 与 `npm run uninstall:core:macos` 只执行 launchd bootout 和 plist 删除，并返回保留的数据根。服务卸载接口不再接受 `--purge-data`，因为共享 `~/.rah` 后删除整个根会误删旧 RAH 数据。未来若提供“清除本产品数据”，必须拥有逐目录清单、活动工作 fence、备份/预览和单独确认，不能复用卸载命令。

## 来源与本地适配

- Raft Computer 1.0.18：runner/升级制品在 `~/.local`，身份、Agent memory、runtime session、transport 与 token 状态在 `~/.slock`；程序替换不等于数据删除。
- Multica：`/Applications/Multica.app` 与 Electron `userData`、`~/.multica/profiles` 分离；更新采用临时文件/rename 与回滚。
- RAH OS：保留同一隔离原则，但采用用户指定的稳定 `~/.rah`，并针对同机旧 RAH 数据增加无覆盖合并协议。

## 验收 owner

- `packages/daemon/src/rah-data-home.ts`：解析、冲突、迁移与 crash resume 的唯一 owner。
- `packages/daemon/src/macos-local-core-launch-agent.ts`：LaunchAgent 与无数据删除卸载 owner。
- `packages/daemon/test/rah-data-home.test.ts`：默认、别名冲突、原子采用、并存合并、冲突不动、恢复和显式覆盖。
- Local Core 安装/LaunchAgent 测试：规范环境变量与卸载保留。
