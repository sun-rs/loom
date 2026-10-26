# 手机页面层级与标题栏（2026-10-26）

产品提交 `2a5fb363`。本批修复 Web PanelHeader 与旧手机 PanelSectionHeader 混用导致的背景/分隔线差异，以及 More 仍使用一级导航的问题。

- 手机标题统一使用官方 `layer-frame` / `foreground-on-frame` 和 1px `line-seam`。保留既有 owner 批准的 48px 紧凑高度（原生源码默认56dp），不称为原生逐像素复刻。桌面仍56px白色内容头。
- More 的成员、计算机、设置、记忆进入全屏，无底栏；列表左上角返回原页面，URL保留原搜索条件。详情仍先返回其列表。没有另建业务状态或第二个路由器。
- 搜索字段位于黄色标题栏；没有手工缩放整个页面或降低触控目标。
- 实测频道标签32高/14字号/20行高/16图标，More选项58高/13字号/18行高/20图标，与公开Native源码一致；未因主观观感继续缩小。搜索字段44高同样匹配 `SharedHomeSearchInput`。用户所见App版本未确认，不能宣称与其二进制一致。

## 源码与修改边界

Native repo https://github.com/botiverse/mobile ，commit `eff04722b5904a0d001115d90d3ec49d59fb4f03`。
本地选定源码新增 RaftSectionHeader、RaftTopTabBar、RaftAppServerTab、SharedHomeSearchInput、RaftTabs、RaftMobileNavServer、RaftTypography 原始文件及哈希；LICENSE/NOTICE保留。`source-diff.json`无本地漂移。它们是不可变参考，不是可执行Kotlin Web依赖。

Header原生规则来自 `RaftSectionHeader.kt` 的 RaftTopPageHeader/Frame；参数来自 RaftTabs.kt、RaftMobileNavServer.kt、RaftTypography.kt。Search tab-head黄色背景另由同revision `SettingsHomePage.kt:11754–11802`确认（完整checkout中检查，未复制此大型页面）。Web继续使用官方PanelHeader/InputGroup/MobileNavServerPopover；本地context只提供路由返回intent，手机CSS适配frame与边线。

## 验证

10项定向navigation/source测试、前端typecheck、正式build通过。390×844正式服务实际点击四个More入口，底栏隐藏/返回存在；设置→外观→设置→原搜索“日期”成功。聊天临时未发送草稿往返保留，检查后已清空。动态/任务/记忆/频道标题实测48px/1px，桌面1440×1000仍56px。无console error，无横向溢出。

安全备份2数据库/325文件后重启；20业务表和推送配置不变。详见summary.json。截图 search.png、settings.png、activity.png。

范围限制：本批不是iOS真机或软键盘验收。复杂表单的sheet分类与物理设备键盘/手势仍待后续；已存在的单页面DOM测试不等于全站App一致。
