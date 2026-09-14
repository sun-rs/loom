# 搜索跳转目标关键词补齐

## 原因与所有者

系统及频道搜索的 SearchHitGroup 只传 target，目标 Room/Thread 虽能定位消息，
却没有搜索词。Thread 的 highlightQuery 又只从内部搜索框读取，因此外部搜索跳转只有
蓝底。此前浏览器定位测试只验证蓝底和点击清除，没有检查目标正文的 mark。

ProductNavigationRequest 新增可选 highlightQuery，属于本地表现请求，不发送给
navigation.resolve。既有导航解析成功且代次仍有效后，App 向 Room/Thread 传递关键词；
URL 的 highlight 参数随定位恢复，搜索预览路径同步保留。搜索表单 q 与目标表现参数分开，
普通导航不继承旧关键词。重复选择同一搜索结果也增加现有定位请求代次。
MessageArticle/MessageMarkdown 仍唯一负责文字标黄，useMessageHighlight 统一控制
下一次点击同时清除蓝色定位和黄色文字，滚动保留；清除不改消息位置和搜索条件。
只向被定位的正文传入外部关键词；Thread 内部搜索继续使用自己的搜索词和当前项。
无协议、后端、持久消息或Provider改动。

## 来源

沿用授权Raft `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
格式化源码146062接收threadSearchHighlightQuery，164721和165133按目标消息传递查询词，
与threadSearchActive选中态分开；采用既有共享富文本标黄，不复制发布bundle。
沿用既有上游许可记录。Multica无更完整的本地Room/Thread搜索定位接线，未采用其代码。
定时清除继续明确偏离Raft，按用户要求改为下一次点击清除蓝/黄，滚动不清除。

## 验证

在既有test-message-location-entrypoints-browser中添加目标正文mark断言，先复现
0个mark的失败。覆盖全局/频道搜索的具体回复、刷新恢复、同一结果再次点击、顶层消息，
保留动态导航、蓝底黑框阴影、无旧横幅、滚动保留及点击清除并正常获取输入焦点。
另验证私聊搜索和390×844视口；测试先等待私聊已选中再发出fixture消息，避免Room切换尚未完成时误投原频道。

## 交付

Chromium、Firefox专项通过，已检查蓝底中的黄色关键词截图。完整npm run check首轮
发现旧回调fixture没有提供新增的setFocusHighlightQuery；仅补齐fixture接口，原有
动态导航断言不变，34项回调回归及重新运行的完整check均通过。
format:check、git diff --check、build:web:workbench通过。
正式实例通过空闲检查、状态备份校验和优雅重启，冻结构建
`8f12b763e311903affc66d54203fa7940666576e1f26aeeb708d621b1a98cd07`。
本机/LAN/Tailnet新鲜页面验证已有“时间”搜索结果的目标正文标黄、蓝底、滚动保留、
点击清除、重复定位和390×844下标黄仍存在；未发消息或调用真实Provider。
同前提在线Raft双边验收未执行；源码参数和正式本地浏览器验收分别记录。
