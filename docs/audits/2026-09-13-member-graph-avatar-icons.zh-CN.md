# 关系图头像底色与图标修复

## 根因与采用规格

关系图已通过 `MemberNodeAvatar` 复用 `AgentAvatar` 和持久 avatarKey，但局部 CSS
把所有节点的背景强制设为 cyan，覆盖头像预设自身底色。本批删除该覆盖，继续让共享
头像组件独占预设图案、背景和上传图片呈现；保留图节点 36px 圆形裁切。

Raft `index-MqTUR4Ez.js`（SHA-256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）的
I6e/Ec 是 Lucide `git-branch`：`M15 6a9 9 0 0 0-9 9V3`，以及
`(18,6,r3)`、`(6,18,r3)` 两个圆。pretty 137050 侧栏使用 14px，169882 页头使用 18px。

关系区块来源 <https://app.raft.build/assets/MemberGraphSection-DCwxw7xB.js>，
SHA-256 `138fd463d6cd70fa6f5b1bfc177fedda861508022ffad6ecf932333e820864f5`。
它从上述主 bundle 导入 `dP`（Ec），SectionHeader 使用 16px。
Chrome 真实页面验证三处几何与 14/18/16px 尺寸相同。

三处原有 `share-2` 替换为 `git-branch`，路径原样移入维护中的 interaction sprite，
保留来源注释。只是授权前端几何采用，不引入上游 bundle 生产依赖；许可边界沿用
[复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)。

## 验证

先在真实浏览器临时夹具新增非蓝底 skull 头像，比较图节点与共享头像组件的计算背景色
和全部像素颜色/坐标：修复前失败，修复后 1280px 与 390px 均通过。另验证两处图标引用、
零连接节点、36px 圆形尺寸和无页面横向溢出。图标存在性测试先失败再通过。

`npm run check` 通过：核心 1573 通过/17 跳过、Web 407 通过及其余子门禁通过。
后续仅侧栏图标 16→14px 的微调再次通过组件源码/浏览器规格、格式、diff 和正式构建，
没有宣称对此微调又重复执行全量检查。

Chrome 正式页面逐一比较四个 Agent 及 owner 的图节点与侧栏：预设底色、全部像素
坐标/颜色及上传头像地址一致。页头与计数分别为 18/16px，侧栏收紧为上游 14px。
本批只修改展示，不改变头像配置、成员/连接计算或任何执行状态。

最终构建 `1111ce083c155b004869c3b297fc73d20f4434ac5f350b532eab97f2f74345c2`。
正式重启沿用单一状态目录，空闲检查、备份校验后 SIGTERM 并等待旧 PID 退出，再由
用户级 launchd 加载冻结资源。最终备份为
`~/.rah/backups/pre-graph-final-09977c97-6904-458b-9d13-30693b422fc1`。
未提交、推送或运行付费 CLI。
