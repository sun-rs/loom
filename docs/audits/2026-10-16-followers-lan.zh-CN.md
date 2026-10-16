# 关注成员管理与局域网部署

代码 `c534fef`。本批收掉有明确官方UI与后端接口的一组接线，并按Owner要求启用既有认证局域网入口；没有新增后端能力或修改安全策略。

## 官方组合与实现

固定官方 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2 notices 保留。组合：ThreadPanel header actions → ThreadAgentFollowers → raft-ui Popover／Button／Tooltip → ThreadAgentFollowerRow → ChannelMemberRow；移除后使用原生5秒Toast撤销。

`thread-followers-adaptation.ts` 在构建时替换原生store/socket控制器，保留完整名单弹层JSX；行点击改接已有实例详情，移除上游profile cache写入。未接入的运行状态副行／在线徽标省略，不能把“未知”伪装成离线。官方尺寸、头像堆叠、数量、空态隐藏、失败重读、锚点跟随与关闭规则保留。固定官方文件未修改；这属于原生展示复用加本地数据接线，不称为整页逐字复制。

认证Human经既有 `thread.followers` 读取、`thread.follower.remove` 移除、`thread.follower.restore` 撤销。Kernel唯一负责关注状态、管理权限和短期撤销token。前端10秒读取展示快照，不新建业务队列。移除／撤销失败只重新读取，不自动重发；丢失移除响应意味着拿不到撤销token，不能伪造撤销成功。读取失败清除旧可操作名单。未知成员映射不输出裸ID代替姓名。

## 两项旧待办纠正

核对授权取得的 v1.21.16 发布包 `app-shell-L7litFx-.js`（hash沿用[顶栏审计](2026-10-16-native-topbar.zh-CN.md)）：

- `kSt`／desktop-search-overlay（约187054行）只提供固定定位、内容列锚点、Escape和点击外部关闭，没有拖动处理。不能因为仓库存在通用floating定位hook就宣称该浮层可拖。
- `C_t`／app-top-bar（约172776行）提供leadingEnd／trailing组合槽；`desktop.history.*`目前只找到翻译条目，没有确认独立历史菜单的完整Web宿主。保留“未确认”，不自造按钮；既有搜索词历史、最近访问和常用对象不受影响。

## 局域网

服务配置选择 `RAH_LAN_ORIGIN=https://192.168.1.86:4176`、`RAH_LAN_BIND_HOST=192.168.1.86`。同一 `com.loom.evo`、原data home、原daemon，不启用无认证trusted-network，不创建第二份后端。此模式替换此前同端口的loopback HTTP；本机与其他设备使用相同HTTPS地址。

使用既有本地CA和精确IP SAN证书。用户端需安装并信任 `/Users/sun/.loom/evo/tls/local-ca.crt`，再通过 `/_rah/pair` 使用一次性配对码。私钥、session cookie和配对码均不进入Git；验证设备在验证后撤销，为Owner另生成短期邀请。实际物理手机／平板安装CA与访问尚未代替用户完成。

## 验证

- TDD：修正测试自身语法后观察缺失模块失败；原生JSX保真断言最初错误匹配了effect cleanup，改为精确JSX return后通过，未弱化保真比较。
- 100项来源／接线检查、类型／`build:web:workbench`、格式／diff；12项launcher与LAN gateway定向测试通过。
- 1440×1000、390×844、DPR1隔离Core：真实名单、移除、服务端token撤销、移除已提交但响应丢失后只读回、Escape及无溢出通过。fixture仅有假的CLI发现器，无付费执行；被激活的假CLI因未提供MCP清单而拒绝运行，不冒充真实模型验收。
- 活动检查、2库／318文件备份、优雅重启，新进程实际监听所选私网IP；18张业务表关键投影与备份相同。
- 初始健康检查漏带浏览器Accept:text/html，静态壳正确返回200，被脚本误判“未就绪”；补读并确认同一新进程，无额外重启。设备撤销正确返回204，脚本原预期200已纠正。
- 正式TLS经CA链验证；未配对API401、浏览器入口跳配对、非同源写入403。已配对双尺寸真实消息列名单弹层、Escape、构建与截图通过，禁止业务写入，Room／Task读取前后相同。
- 初次Playwright ignoreHTTPSErrors与拦截请求组合使CSS出现ERR_TOO_MANY_RETRIES，截图发现无样式。最终改为精确叶证书SPKI信任并断言计算样式，重验截图正常；未修改网关或放松产品认证。已有外部字体被CSP阻止、成员读取console诊断仍记录，不称“控制台零错误”。
- 没有全仓／全浏览器／付费门禁，也不声称其他物理设备已验收。

[结构化证据](../evo/evidence/2026-10-16-followers-lan/summary.json)。原始证据保存在 `/Users/sun/.loom/reviews/2026-10-16-followers-lan/`。
