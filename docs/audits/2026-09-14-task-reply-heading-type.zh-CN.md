# Task回复提示字号

用户指出Task弹窗“回复的开头”和回复数量偏小。Raft授权归档
`index-MqTUR4Ez.js`（SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）
148352–148374的Tde为text-xs/font-mono/text-black/40，59731及59748的replyCount
同为text-xs/font-mono/text-black/40。配套index-DPaRRgFJ.css的text-xs为.75rem，
line-height为calc(1/.75)，即12px/16px。沿用既有上游许可/来源记录，没有引入发布bundle。
Multica无同款Room/Thread回复分隔标题组件，未采用其代码。

共享ThreadPane的rah-thread-history-heading当前为11px/16px，现改为12px/16px；
普通字重、灰度、等宽字体和间距保留。Task详情和普通消息列共用该表现所有者，
没有增加Task专属重复样式或改变回复计数、滚动及后端协议。

既有task-detail-history浏览器测试增加两行计算字号/行高/字重断言，先复现11px不等于
12px失败，再修改共享字号。继续验证默认最新回复、晚加载高度、用户滚动保护、
操作时间线及负责人候选逻辑。

## 交付验证

Chromium、Firefox的任务详情专项通过，完整npm run check、format:check、
git diff --check及build:web:workbench通过。正式实例经空闲检查、持久数据备份校验后
优雅重启，冻结构建为
`38544089f064d909483806dc1e998132f787b49870b9418e08c4eaa0379dffdf`。
本机/LAN/Tailnet新页面打开真实Task，桌面与390×844检查两行均12px/16px/400，
已查看截图并关闭弹窗；未修改任务、发送消息或调用付费Provider。
源码参数对齐及本地正式验证通过，未做同前提在线Raft双边验收。
