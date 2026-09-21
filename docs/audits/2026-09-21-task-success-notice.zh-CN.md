# 移除任务更新成功后的占行提示

按用户截图，仅移除 `GlobalTaskBoard.perform` 成功后写入的“任务 #N 已更新”。既有任务投影刷新、保存期间禁用、失败提示及拖动引导不变。空提示已有 `:empty { display: none }`，因此完成后不再占额外行；全局任务页和频道任务页共用该 owner。

`test-task-success-notice-browser.mjs` 先在隔离 Fake Provider 工作台修改任务状态，复现更新后多出提示行，再确认修复后请求成功且该行隐藏。没有修改正式任务数据、没有运行付费 CLI。专项浏览器回归、正式构建、`git diff --check` 通过；全仓检查仍停在既有 `/v1/worker/message-present` 未登记，格式检查仍有 12 个本批之外文件告警。正式工作台已备份并安全重启，构建 `81800f976d2d92734ba17ad9ecd09ec117fe1195c54d63fc66e5c282e7cb52bf`；新浏览器正式任务页响应头、卡片展示和隐藏提示行验收通过。未提交或推送 Git。
