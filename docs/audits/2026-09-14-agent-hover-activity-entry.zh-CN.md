# Agent悬浮卡精简与动态入口

## 来源和边界

Raft授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
pretty源码Wrt（141482–141509）的最近动态按钮为10px粗体、2px图标间距、10px右箭头、
50%黑色文字，悬停黑色与下划线。本地结构移植到维护型ui-tokens，复用内部chevron-right，
不是整段字节复制；原发布包仅用于授权分析，保留既有来源记录，不修改冻结快照。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/agents/components/agent-live-peek-card.tsx`显示当前任务和最新任务，
不是Raft的五条运行动态导航，本项未复制该实现（Apache2及附加条款）。

用户指定移除描述行，仅影响悬浮卡，资料页仍保留描述。AgentMessageIdentity负责内容和入口；
PreviewCard负责浮窗寿命、键盘焦点和关闭；App既有鉴权navigation.resolve负责右侧Agent入口，
AgentDirectoryPane负责页签。鉴权导航成功后递增只属于UI导航的activityRequest，
同一Agent已打开资料页时也切换动态，不重挂载资料组件、不清除草稿。运行动态仍受原有创建者/管理权限和五条上限约束，不新增轮询。
空列表、权限不足继续不显示动态区；读取失败保留准确错误和可打开完整页面的入口。

交互内容使用非模态dialog语义，普通纯展示卡保持tooltip；Tab可从头像进入动态按钮，
Enter打开，Escape关闭并归还焦点，指针离开、外部点击沿用共享机制。

## 验证记录

新增描述不可见及点击/键盘导航断言，先复现描述行仍存在的失败。
原专项中的默认运行时文案已被近期运行时配置合同更新，同步断言为“未选择模型”和显式默认
推理强度行，未修改运行时产品实现。浏览器专项覆盖桌面1440与移动390、权限/空/失败、
动态投影更新不重挂载、浮窗寿命和鼠标/键盘入口。

Chrome/Firefox悬浮卡专项与完整工作台导航专项均通过。导航专项使用临时Kernel、Fake CLI
消息复现同Agent停留资料页的问题，再验证动态→资料→点击入口→动态。没有真实付费CLI。
截图人工检查后为共享SVG补齐10×10px CSS规格，并加入尺寸断言。

完整 `npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 通过。界面样式匹配证据及内部目录同步更新。

正式工作台通过空闲校验、持久状态备份和优雅重启，备份为
`/Users/sun/.rah/backups/pre-restart-295fe291-b8cb-439d-940a-732d850be1b9`，
冻结构建 `d81ce138c2763cafe6c1f65e51f023adb8afa906ff21a9f627b45dc78653afe4`。
新真实浏览器在已有Agent Council聊天验证无描述行、10px箭头、打开动态、同Agent资料→动态
及刷新后再次打开，未发送消息或更改Agent配置。截图
`/tmp/rah-agent-hover-formal-preview.png` 和 `/tmp/rah-agent-hover-formal-activity.png`
已检查。长聊天的虚拟窗口会替换首个消息节点，正式验收改为当前可见的同Agent头像定位，
刷新后选择该Agent最近的已挂载头像；未修改产品滚动逻辑来迁就测试。

本批是来源支持的本地实现及真实页面验收，没有新增Raft在线双边像素验收，也没有付费CLI门禁。
