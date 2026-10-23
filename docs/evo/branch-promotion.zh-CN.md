# 主线晋升（2026-10-23）

Owner 要求：当前可施工问题先处理；没有具体新缺陷时，evo 转为 main，原 main 保存为 chatbox。

## 身份与操作

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
