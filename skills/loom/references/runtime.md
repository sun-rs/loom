# 特殊 Worker

1. 运行时
2. 发布行为

## 运行时

新增 TUI 或 headless Worker 时实现 OAR runtime 合约，共用现有会话所有权及回执接口。

## 发布行为

下次派工启动新版宿主。loomd 升级保留已运行的 detached session-host。用独立工作树验证启动、停止及回执。
