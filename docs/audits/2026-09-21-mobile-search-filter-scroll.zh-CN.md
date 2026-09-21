# 窄屏搜索筛选单行滚动

用户明确要求 PWA 搜索筛选单行、横向滑动、不换行。本地 shared Web/PWA 在
max-width:767px 且主指针为 coarse、无 hover 时共用这一呈现；鼠标桌面窗口即使
缩至 767px 以下也保留换行。不增加 standalone 业务分支。

来源核查：Raft release/v1.17.3 `index-CyTLLjYb.js` 搜索筛选容器仍为
`flex flex-wrap items-center gap-2`（SHA-256
`0799a867d1d1fd706b9fb9068ebec05002acc39261ae3ab3ed706e239fd8ca9f`，
https://app.raft.build/assets/index-CyTLLjYb.js）。本次单行行为是用户要求的明确
差异，不称为 Raft 复制。Multica 不涉及这里的筛选状态；复用现有浏览器原生滚动。

唯一布局改动 owner 为 global-discovery.css 的搜索窄屏规则：nowrap、overflow-x:auto，
子项不收缩，文字不换行。菜单继续由 DiscoveryFilter portal 呈现，避免滚动容器
裁切；不改筛选数据、搜索调用、桌面样式或共用 token 源的参考示例。

test-mobile-search-filter-scroll-browser.mjs 先验证原 flex-wrap:wrap 的失败，
再检查 390px 单行、横向溢出、滚到排序、选择最新、刷新和桌面恢复。

Chromium/WebKit 定向回归通过，已复核截图。正式构建与 diff 检查通过；全仓 check
仍阻塞于既有 `/v1/worker/message-present` 未登记，format 为 12 项无关既有告警。
安全守卫完成备份 `pre-restart-b8939ce1-10a9-4dfd-b350-59f2d1db943c` 后重启正式
工作台至 build `62db16bc33bf683d71c0433f8ed618856e399750d5e1c6d135cedbe1d3eb7032`。
新 WebKit 390×844 standalone 模拟页面在正式搜索 Kimi 时验证横向滚动、选择最新、
刷新和 1440px 桌面恢复，全部通过。不声称安装 PWA 真机验收；未提交。

## 桌面窄窗口补验

此前只测量宽窗口内缩窄的筛选区域，遗漏了桌面窗口自身小于 768px 的情况。
新增鼠标环境 600 / 390 / 1440 / 600px 缩放与刷新测试，先确认旧代码实际 nowrap
导致失败，再把单行规则限定到窄屏且无悬停的粗指针设备。桌面继续使用共享 wrap
规则；历史编辑按钮仍按原宽度断点，未受此修复影响。手机/PWA 单行滚动、排序菜单
选择与刷新仍由同一回归覆盖。独立桌面 PWA 使用鼠标时也走换行，不按安装模式分叉。

补验结果：Chromium/WebKit 均通过桌面窄窗口换行和手机单行用例；正式构建通过。
更新 CSS 对应组件匹配报告和生成目录后，全仓 check 仍止于既有
`/v1/worker/message-present` 未登记；全仓格式检查仍为 12 个无关既有文件告警，
本批文件格式及 diff 检查通过。安全备份后已重启正式工作台至
`750874e1d52fbdf825e5149280ecc0de9183aa79187f208f8239f34e903b04e1`。
新正式 WebKit 页面验证鼠标窗口 600→390→1440→390px 无横向溢出，390px 两行；
手机触屏模拟仍单行，排序选择及刷新通过。未声称手机真机验收，未提交。
