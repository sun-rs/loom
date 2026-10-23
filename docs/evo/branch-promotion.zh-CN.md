# 主线晋升（2026-10-23）

Owner 要求：当前可施工问题先处理；没有具体新缺陷时，evo 转为 main，原 main 保存为 chatbox。

## 首次晋升操作（后继裁定见下）

- 原 main：`f1bc8c9d2f70b44aa5e1cacc2362e8905ed4c612`，旧 Raft 复刻 UI 基线，完整保留到 chatbox。
- 晋升基线：`51ce2565717ee32797f0f8ce49a136e799a17be6`，官方源码前端及 Loom Role/Instance 后端。
- 独立 `../rah` 的远端为 `sun-rs/rah`，不是本仓库的 main；本次不修改它。
- 保留 origin/evo 为晋升前历史引用；当前工作目录改为 main。原 main 工作树 `../loom-main` 改为 chatbox，路径不动。
- 原 main 比 evo 多一个旧 UI 检查修复提交。采用保留当前树的合并提交承接其历史，使远端 main 可快进更新，不强推、不删除历史，也不恢复已退役 UI。
- GitHub 默认分支仍是 main，现有 main CI 继续适用。部署标签 `com.loom.evo`、数据目录、证据和文档路径不变，不触发服务重启。

## 当前能推进什么

已采用页面的主要接线及最近可复现缺陷已处理。没有证据支持再启动无边界的 UI 重写或成本优化。
剩余工作按性质保留：

1. Firefox 关闭全部 Loom 页面后的实际通知横幅与点击恢复、iOS/Android 真机键盘／安全区／后台通知：真实环境验收，不能以模拟测试替代。
2. 五 CLI 真实质量与效率门禁、部分 Fork/Side SEA helper、原生上下文指标缺失：继续按 target-contract/status 登记的范围与限制，不随主线晋升宣称完成。
3. 官方 UI 后续版本升级：按锁定依赖、候选 diff、受影响接线和专项验收推进，不承诺全站无改动升级。

后台通知结构已沿用官方 Worker push/click 处理；最近19项专项通过，真实闭页横幅仍待验。
此次仅整理 Git 主线和入口文档，不改变产品行为，不为改名重跑全产品或付费模型测试。

## 最终分支布局（同日 Owner 更正）

负责人明确不要旧复刻版 chatbox，要求吸收同级 rah 项目并删除 evo。

- main：当前 Loom，官方源码前端与 Role/Instance 协作后端不变。
- chatbox：逐提交引入 `../rah` 当前 main，源提交 `871ace825954750a546a027a832d76332cbd467e`，远端来源 `git@github.com:sun-rs/rah.git`。保留全部可达历史与原始文件，不将其代码合并进 Loom main。
- 源 rah 工作区干净，原仓库、远端与其他审计分支未改。`audit/d925e01-surgery` 是不同版本，本次未替 owner 选择它。
- 旧 chatbox 分支被替换；干净旧工作树 `../loom-main` 已移除。旧复刻代码仍可从既有 `milestone-ui-raft` 标签及 Git 历史追溯，不重写或清除历史。
- 远端 evo 分支删除；提交已包含在 main 历史中。docs/evo、运行标签、数据目录继续保留原路径，与 Git 分支存在与否无关。
- 替换采用远端旧 SHA 校验及原子 push，避免覆盖并发更新。Chatbox 导入按提交／tree 相同验证，不代表重新构建、部署或验收其功能。

今后 Loom 在 main 工作，Chatbox 在 chatbox 工作，两者分别遵守各自 AGENTS.md。
“吸收”本轮是同仓库独立分支托管，不是合并两套后端、包管理或服务部署。

## 分支接入收尾

Chatbox 初次导入的 CI 仍只监听 main，导致 chatbox 推送不触发检查。
后继提交 `74088af6` 将其 push 过滤改为 chatbox，保留原 RAH 质量门禁，
补充先失败后通过的触发配置测试及分支身份说明。Loom main 的 CI 不变，
其9项配置检查通过；Chatbox 定向检查1项通过。两者产品代码均未变化。
此处只证明本地配置检查通过并推送，不证明 GitHub 托管完整 CI 已通过，
也不代表导入 Chatbox 已重新完成功能验收。
