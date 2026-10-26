# Mobile原生对比第一批：动态交互

来源：botiverse/mobile eff04722b5904a0d001115d90d3ec49d59fb4f03。独立固定到upstream/raft-mobile-source；6份原文件含LICENSE/NOTICE，sha256在source-lock.json，未修改原件。用户授权复用，不代表官方当前App安装版本一致。

已采用：右滑已读/未读（未关注消息列不开放）；左滑完成/静音/取消关注继续既有规则。两方向均保留边缘24、方向仲裁、半宽展开、60%全幅提交、取消和原有可访问菜单。实际浏览器hook来自锁定Web1.21.34，经受保护生成器添加native start/end语义，不冒称字节原样复用。原生版是Kotlin，不直接导入Web。业务操作仍走activity.mark及既有权限/幂等通道。

下拉刷新：原生Cupertino橡皮筋公式c=0.55、触发100、保留60；浏览器TouchEvent适配仅在触屏窄屏、列表顶部、非横滑/非边缘时接管，取消/短拖/忙碌不提交。UI使用官方Spinner，未复制UIKit系统材质和原生弹簧动画。复用既有feed读请求，不创建新的数据仓库。刷新时保留已授权当前scope的可见数据，完成/错误恢复指示器；完成序号避免React批处理省略loading中间态时卡住。

标题：手机点击/键盘激活动态标题滚动当前列表顶部，尊重减少动画偏好；桌面双击下一未读保留。

证据：两批新增检查先失败后通过；15项source/policy/undo校验、10项实际React DOM手势/撤销/拉刷新测试通过，Loom类型检查及产品构建通过。DOM覆盖右滑仅read一次、左滑撤销/关闭/卸载、边缘/取消/横滑/短拉/重复拉、瞬时刷新settlement。native-source audit当前candidate无差异且干净。浏览器不是iOS真机；不将DOM触摸模拟写成真机通过。

下一阶段仍是复杂表单/选择器的手机面板分类，然后是聊天进退/键盘/草稿的连续使用核对；不宣称已全站对齐iOS。
