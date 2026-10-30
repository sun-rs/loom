# Owner 头像素材替换（2026-10-30）

## 来源与边界

用户明确要求以本机 `pokemon-avatars-named-539.zip` 完整替换头像来源。
归档来自 `/Users/sun/Documents/kimi/tasks/2026-10-30/00-01-46-51122842/`，
SHA-256：`053e8d3ff952ae2086dd761baaebb2fac6df096341605675d43fa205cdf5084c`。539张均为512×512 PNG，共17,498,602 bytes；
未重绘、缩放、转码或修改原图。每项原名称、归档路径、字节数及SHA-256记录于
`frontends/raft/loom/avatars/pokemon.provenance.json`，包含未知图腾28种、
飘浮泡泡4种、代欧奇希斯4种形态，不以图鉴编号覆盖不同形态。
素材是owner提供的本地资源，不冒称Raft官方资源或新增公开分发授权。

## 实现与维护

- 头像选择与随机按钮只使用这539项，按图鉴地区分组，中文名及编号可搜索。
  新Role经既有Kernel创建事务在幂等回放之后取一次头像并持久化。
- `pixel:pokemon-*` 是已有头像引用契约下的新稳定身份；前后端共享身份校验，
  通过现有资料修订和冻结实例路径显示，不另建业务状态或迁移用户配置。
- PNG使用带内容hash的同源独立URL；原图不内嵌JS、无外部CDN。运行目录与
  大型来源清单分离；选择器首次只挂载60项，点击更多增加60项，搜索覆盖全库，
  单图lazy/async加载。网关现有immutable缓存策略直接适用。
- 官方AvatarSlot、资料布局、状态角标、单图frame不改；生成器添加一个资源URL缝。
  旧8×8/32×32数据仅为原有Role、冻结实例及历史显示保留，不在选择和随机池内。
  没有批量重写Role修订、改变实例或更换用户上传图片。
- 可复现导入：`python3 scripts/official-web/import-pokemon-avatars.py /path/to/pokemon-avatars-named-539.zip`。
  共享头像源码仍经`node scripts/official-web/generate-shared-content.mjs`生成，不能手改。

## 定向验证

- [先失败记录](red.txt)：新图库数量、PNG资源和协议身份在实现前失败。
- [24项检查](checks.txt)：全部539个原图hash/尺寸/身份、随机池、原图兼容、
  Role创建/幂等/重启/冻结实例、资料权限、原件完整性、生成可复现和原生弹窗规则。
- [前端类型](types.txt)、[后端类型](backend-types.txt)、[产品构建](build.txt)通过。
  构建既有大chunk提示保留；不宣称本轮优化了所有bundle。
- [Chromium](browser.txt)及[WebKit](webkit.txt)：1440×1000与390×844，
  真实临时Core、无付费模型。验证默认随机、60→120分批、全库搜索、皮卡丘、
  未知图腾问号、代欧奇希斯防御形态、小约克的选择/保存/刷新，原图尺寸512×512，
  原有描述/提示词及修订保护保持。无页面异常；每个完整流程仅请求80–124张，
  未一次加载539张。为头像库打开后的多次搜索/选择累计，不是网页初始下载量。
- 截图：[桌面](picker-1440.png)、[手机视口](picker-390.png)，末次WebKit截图；
  浏览器视口模拟不等于实体iOS PWA验收。

## 部署

产品提交推送后按既有服务维护合同执行备份、空闲检查、平滑重启和正式只读页面复核。
具体产品revision、WebBuildId和保护表结果以部署收据为准；不对正式Role写入测试头像。
