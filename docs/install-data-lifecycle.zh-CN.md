# RAH 安装与用户数据生命周期

状态：Accepted，2026-09-02。

## 合同

- 程序/源码目录只承载可替换的代码与 Web 构建；用户状态不写入安装目录。
- `RAH_DATA_HOME` 是规范数据根，`RAH_HOME` 作为兼容别名保留。两者同时设置但解析到不同目录时拒绝启动。
- 默认数据根是 `~/.rah`。daemon 状态和派生缓存位于 `~/.rah/runtime-daemon`，认证、Council 与附件分别位于 `auth/`、`council/`、`attachments/`。
- 安装目录与数据目录不得相同、互相包含；该约束由共享路径 owner 和 LaunchAgent 安装前检查共同执行。
- `rah service-install` 安装的是 per-user macOS LaunchAgent；plist 只带非 secret 环境，启动后必须通过 `/readyz` 证明健康。替换失败恢复旧 plist，并在旧服务此前已加载时重新加载。
- `rah service-uninstall` 只卸载 LaunchAgent 和 plist，永远不删除 `~/.rah`。清除用户数据不是卸载的隐含步骤。
- provider CLI 与其账号仍由用户安装和登录；RAH 只调用、管理本机已有 runtime。

因此，删除源码目录或卸载后台服务后重新安装，只要 `~/.rah` 仍在，RAH 的本地状态即可继续恢复。源码绑定 LaunchAgent 仍依赖该 checkout、Node 和依赖目录；独立签名应用属于后续发行形态。

## 来源与取舍

Raft Computer 1.0.18 把可替换 runner 放在 `~/.local`，把身份、attachment、Agent memory、runtime session 与 transport 状态放在 `~/.slock`；Multica 把应用放在 `/Applications`，把 Electron `userData` 放在 `~/Library/Application Support/Multica`，并把 daemon profiles 放在 `~/.multica/profiles`。两者都证明“程序位置不是用户状态位置”。RAH 采用相同边界，但保留既有 `~/.rah`，避免产品改名或安装载体变化触发数据迁移。

## 验证

- `rah-paths.test.ts` 覆盖默认/覆盖/兼容冲突与安装-数据隔离。
- `rah-macos-service.test.ts` 覆盖非 secret plist、卸载保留数据、替换失败回滚旧服务。
- `rah-cli-management.test.ts` 覆盖 CLI 表面和稳定 pid 路径。
