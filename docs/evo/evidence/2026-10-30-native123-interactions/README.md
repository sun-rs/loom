# Web1.21.23 原版与 Loom 候选的双边交互验收

本批保持 `db5e399` 完整Web及原始UI0.7.0不变。两个独立构建运行相同中文、固定时间、主题、DPR1及官方字体；原版只接独立native HTTP夹具，候选只接严格SDK夹具。参考答案不调用产品DTO转换器。测试完成即关闭临时服务器；这些URL不是正式服务。

## 结果与范围

- [交互报告](interaction.json)：21组截图逐RGBA像素零差异，无遮罩／容差；两个浏览器的操作结果、分栏几何相同。截图路径均指向本目录保留的原始PNG。
- [基础页面回归](pixel-regression.json)：原有7场景×桌面1440×1000／手机390×844共14组仍零差异；故意横移1px的校准继续能检测差异。
- [真实Core侧栏](core-sidebar.json)：临时数据库、Fake运行时、零付费调用。原生菜单置顶、鼠标移入分区、排序模式、刷新保存均读取真实Kernel确认；并发更新后旧页面在写入前拒绝，重新加载已确认偏好。故意丢失一次真实已提交响应，原生界面保持待核实；点击核实复用同一个key／payload，数据库版本不重复增加。
- [基础Core回归](core-regression.json)：1440和390宽度的消息发送、55条历史翻页、备注修订、头像随稳定Role ID更新、冻结执行修订不变、创建频道与实例、只创建Role不生成实例仍通过。
- [单测24项](unit.txt)、[HumanSidebar六项](kernel-sidebar.txt)、根类型检查、候选类型／构建、原产品兼容构建通过。原始源文件hash和单React／ReactDOM／UI根门禁见[native-boundary.json](native-boundary.json)。不是付费CLI或成本验收。

| 双边实际操作                             | 断言                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 空置顶区、背景／频道／分区右键菜单       | 原生提示、位置、大小与截图一致；Escape关闭菜单                                                  |
| 菜单置顶／取消、刷新                     | 相同分区与稳定ID；确认保存后刷新仍保持                                                          |
| 分区排序选择                             | manual／A-Z模式保存一致；不据空分区推断所有最近活跃排序数据已正确                               |
| 频道菜单移出分区                         | 原生悬停子菜单与写回结果一致                                                                    |
| 新建／编辑／删除分区                     | 原生表单、Enter提交、删除确认弹窗；不另造菜单或弹窗                                             |
| 鼠标拖入置顶、再拖入自定义分区、同组排序 | 实际DndKit PointerSensor启动／移动／释放，界面及保存一致；不是直接设置store代替拖动             |
| Escape取消拖动                           | 两边都无持久写入、原分区不变                                                                    |
| 拖动聊天分隔线                           | 默认240px，最小180px，最大320px；保存270px后刷新仍270px                                         |
| 390／767／768／1023／1024／1440宽度      | 原版和候选边界几何相同；选中对话在窄屏进入单栏，768起显示聊天侧栏及分隔线                       |
| 未选择条目的动态页                       | 该固定1.21.23原版为全宽；1440时正文1383px、无可见分隔线。不能套用较新官网常驻右侧空白的布局要求 |

### 测试实际发现并修复的缺陷

1. 置顶读取错误地输出`type`，原生契约需要`kind`；已改为严格身份转换。Role配置不是单聊，只有核实过的独立频道实例可映射原生Agent DM。未核实旧peer明确不可用，不按不透明ID猜身份。
2. 候选没有接原生sidebar-order写入；现接到已有HumanSidebar，保持稀疏字段、显示版本CAS和同一个WriteIntentSlot。未知结果不会回退成假失败后再造新请求。
3. 自定义分区排序不能保存；只给现有JSON偏好增加可选sortMode，不迁移数据库或创建新状态所有者。[预期失败](red-sort-field.txt)保留。
4. 新分区被放到错误位置：适配器丢弃原生`system:joint`排序槽，导致其与联合频道分区互换。[原始失败](failed-order-before-fix.json)记录3600／3556个差异像素，[差异图](failed-order-diff.png)保留。现有偏好只增加这个纯布局标识；不引入联合频道业务服务／成员／创建操作。[协议红测](red-layout-slot.txt)保留；修复后21组为零。

这证明交互门禁能抓到hash／构建／初始空页面截图漏掉的问题；不是只宣称“原版所以必然一样”。本批未改官方源码、CSS或组件参数。

## 尚未验收与下一步

菜单的静音、手动未读、归档，独立单聊关闭／创建、聊天tab拖动，只读映射以外的最近活跃排序，分区本身拖动，触控长按和键盘箭头导航没有在本批全部验收。已有映射不等于完整操作通过。三栏线程／资料与搜索主从列的动态宽度也仍待相应实体接通后验收。

实例启停／重启／恢复、完整私聊／线程、文件／记忆／通知、Loom已批准移动策略等仍按[完整迁移矩阵](../2026-10-30-native123-intake/README.md)推进。原版云账单读取在参考夹具明确501；SW仅在像素夹具禁用，真实Core浏览器允许SW。不能将这些结果外推为真机PWA、性能、官方最新版或全站业务完成。

正式服务保持旧稳定产物，本批没有切换或重启为候选；只读检查原服务进程不变且首页200。测试数据仅在临时Core，未进入发布产品。

## 复跑

```sh
npm run build:official-web:native123 -- --install --reference
npm run test:official-web:native123
node --test packages/kernel/test/human-sidebar.test.ts
npm run test:official-web:native123:interactions
npm run test:official-web:native123:pixel
LOOM_BROWSER_SLICE=native123-interactions LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=native123 LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
```

有意让两臂的新分区UUID不同，只在语义结果对比时按同名分区归一化；截图不改像素。抓图前检查真实官方字体已加载；页面异常、未知业务路由、错误几何或任意差异均失败。原版缺少的云服务只列明精确例外，不静默吞掉其他501或运行错误。

样例：[原版频道菜单](reference-channel-menu.png)／[Loom频道菜单](loom-channel-menu.png)、[原版分区表单](reference-create-section-form.png)／[Loom分区表单](loom-create-section-form.png)、[真实Core结果](core-sidebar.png)。
