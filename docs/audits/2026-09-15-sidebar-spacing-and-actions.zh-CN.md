# 聊天列表间距与操作图标（2026-09-15）

## 源码参数

Raft https://app.raft.build 授权发布包 `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，配套
`index-DPaRRgFJ.css`。以下为源码提取，不把用户截图的缩放后像素当 CSS px。

| 对象                            | 源码位置（pretty 行）            | 参数                                                              |
| ------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| 分区标题 FD / rg                | 133605                           | 高 24px，上 12px，下 4px；12px/16px bold；折叠箭头 12px           |
| 分区容器                        | 136579 附近 sidebar-section-list | flex column，禁止相邻组的外边距合并；折叠标题之间净空 16px        |
| 已保存                          | 136533                           | 14px/20px medium，图标 14px，图文间距 6px，下边距 4px             |
| 频道与私信 Tg / Lat / Oat / Dat | 133835–134088                    | 主名称 14px/20px，私信描述 12px/16px；行图文间距 6px              |
| 标题计数                        | 136620、136730 附近              | 12px，mono，40% 黑色                                              |
| 排序 Pa / Yx                    | 135054、133609                   | 24px 方形按钮、14px 图标、0 padding；排序与创建容器 gap-1，即 4px |
| 空置顶 sg                       | 136653 附近                      | 最小 36px，上下 padding 6px，下边距 4px，12px/16.5px mono         |
| 空自定义组 Xx / sg              | 133674、136747                   | 空容器最小 28px，提示上下 padding 4px                             |

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/layout/app-sidebar.tsx` 使用共享 sortable pin 行，但不是这里的频道、
私信和混合分区结构；本次直接采用 Raft 的布局参数，保留 RAH 现有 dnd-kit 与偏好写入。
属于结构移植和 RAH glue，无新增上游运行时依赖，也没有改写排序算法。

## 根因与所有者

- RAH 的分区没有 Raft 的纵向 flex 父容器。相邻标题的 4px 下边距与下一组 12px
  上边距被合并为 12px，实际净空短了 4px。`SidebarDrag` 恢复单一组列表容器。
- 空置顶高度依赖 `.side-section:nth-child(2)`；加入分组包装层后不再命中，实际只有
  16.5px。移除按 DOM 序号猜测身份的规则，改用 `data-sidebar-group="pinned"`。
  其他空组保持 28px，组样式集中在现有 sidebar CSS 中。
- `DiscoveryFilter` 为 `triggerLabel=""` 仍输出空 span，排序按钮的居中 grid 因此
  多出一个轨道，图标中心上偏 4.5px。共享组件不再渲染空标签，避免在排序、表情等
  图标按钮重复写局部隐藏规则。动作容器 gap 从 2px 改为 4px并禁止收缩。
- 分组/计数 12px，名称/已保存 14px原本已经匹配，保持它们并加入实际计算样式测试；
  不为截图里的缩放或间距差异放大全局字体。

## 验证

`npm run test:web:sidebar-geometry` 先复现图标 4.5px 偏移、2px 动作间距、12px
折叠组净空与 16.5px 空置顶高度，再验证修复。覆盖 1440×900、390×844 的字号、
图标/按钮尺寸、中心线、空组/折叠组几何以及排序开关和创建入口。

完整 `npm run check`、`npm run format:check`、`git diff --check` 和正式
`npm run build:web:workbench` 通过。组件规格同步替换失效选择器，空置顶参数从待核实
转为源码确认；没有放宽 CSS 校验。组件规则报告与内部目录通过维护工具重建。

专项几何门禁在 Chromium、WebKit 通过。分组拖动、跨组预览、持久保存、失败恢复与
取消在 Chromium、Firefox 通过；触摸菜单在 Chromium、WebKit 通过，Chromium 另验
原生手势滚动；共享空标签修正后的消息选择条/表情对齐回归通过。
拖动测试更新为在列表让位后的实际目标范围内释放，仍检查预览归属、持久保存和单次
写入；原来的旧坐标会落到已移动目标之外。WebKit 触摸脚本补充页面挂载等待，避免
读取尚不存在元素的 boundingBox。没有为通过测试修改排序算法。

正式旧进程 95088 经空闲检查、状态备份验证后优雅退出，新进程 6365 使用冻结构建
`951e24c02b6267f1c5850f568f9f184201d2d01954338ad5bf236d4a00067a1e`。
备份 `/Users/sun/.rah/backups/pre-restart-6f26103a-3380-4343-a38d-a42f74a2ea0e`，
原 Room、Agent、私有记忆和 loopback/tailnet/LAN 监听配置保留，三个入口均返回新构建。

正式新浏览器在 1440×900、390×844 验证现有频道、私聊、自定义分区的展开/折叠、
字号、操作几何、排序开关、创建入口和重载。正式页面零异常，零 sidebar.patch /
rooms.create 请求；已人工查看截图，证据目录 `rah-sidebar-formal-EDeUml`，隔离
几何截图目录 `rah-sidebar-geometry-YScUJm`（本机临时证据，不是生产 fixture）。
PWA 重载恢复当前对话后，经“返回主页”重新检查列表，符合既有导航规则。

未做物理 iPhone 或线上 Raft 同条件双边验收；本批为授权源码对照、隔离浏览器与
正式产品页面验证。未调用付费 Provider，未提交或推送。
