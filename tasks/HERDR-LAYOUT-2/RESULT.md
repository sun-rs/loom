# HERDR-LAYOUT-2 结果

STATUS: done

基线为 `0ca39c54`。工作树改动未暂存、提交或部署。

- 领队和审计标签页直接使用对应终端。Loom 优先核对记录中的标签页 ID，也能在同一空间按名称找回未登记的标签页。新空间首次创建 Status 时，唯一的临时窗格在成功和报错路径上都由清理逻辑回收。普通启动按实际出现的角色排列标签页。
- Herdr 返回 `unavailable` 时执行有限退避。创建空间的回执丢失时，先查 Herdr 列表再重试。终端放置以 `herdr-app ls` 为准。发布角色记录前核对地址、PID 和创建时间，并在放置或校验失败后关闭已核实终端的 Core `keep`。
- 改动前的回归测试复现了回执丢失、临时终端泄漏和必选布局可连接本机 Herdr。改动后 `npm test` 全量 700 项通过，失败、跳过和取消均为 0，`git diff --check` 通过。测试入口默认关闭 Herdr 集成，独立布局夹具提供一对替身可执行文件。测试前后对比真实 Herdr 的 recent，只新增了本卡的实机探针空间。历史 `loom-hl-*` 名称没有出现在测试夹具或测试源码中，前卡有人工实机探针的记录，现有日志无法逐一确认历史条目的创建来源。
- 使用修复后的实现，在自建临时空间验证了三页顺序、无残余占位终端、`keep=false` 和重复 adoption。已关闭该空间。另一次探针因临时状态目录把 Core 指向隔离实例而失败，已调整探针环境并重跑通过。
- pilot-2 使用正在运行的 `629e49e0` 服务执行了 `bin/loom layout adopt --project /Users/sun/Code/loom-pilot2 --leader t3fn --auditor t3fw`。随后 `bin/loom layout get auditor --project /Users/sun/Code/loom-pilot2` 返回 `t3fw`。前后核对三页的 ID、窗格、终端地址、PID、创建时间和 `keep=false`，均一致。修复代码的实机验证在上述临时空间完成。
