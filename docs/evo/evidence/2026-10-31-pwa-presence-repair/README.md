# PWA首屏／横屏取色与实例头像状态一致性修复

本次修复现役产品入口，未切换尚未接齐能力的adapter123候选；官方完整源、UI依赖、Role／Instance业务和移动密度政策均不升级。

## 根因和修复

1. 原网页把Apple的全屏／状态栏meta放在阻塞型app-theme-bootstrap.js之后；网络慢时，解析器先停在脚本，不能及时看到这些声明。颜色层本身又在React里，应用模块未到达时根本不存在。现在由外部`pwa-chrome.ts`在HTML构建边界把meta、critical CSS与唯一顶边节点提前，应用脚本未到也可取到frame。保留script-src self，没有内联JS或放宽CSP。
2. 旧样式只看CSS display-mode。iOS navigator.standalone为true但CSS匹配为false时，横屏边缘层会消失。设备模式bootstrap增加原生standalone观测，文档在旋转时保留已确认的安装模式；不增加持久偏好或定时重写。全屏普通浏览器退出后仍可恢复，普通桌面不增加顶部padding；原5px采样边缘与安全区按原移动策略保留。
3. 正文头像将Room工作状态idle涂灰，设置页采用共享Host在线观测，导致同一实例灰／绿。正文改用同一AppearanceRuntime中的catalog＋Host presence，按稳定Agent definition ID关联Instance principal；在线绿、工作／思考黄、离线灰、错误用原生错误色。保留当前频道成员围栏与离开状态，缺少观测不凭enabled猜在线。移除为头像取色而读取Room工作诊断的额外请求；任务空闲不再等于离线。

官方组件Status／AvatarBadge、尺寸、边框和颜色token不改；不手编辑生成文件或完整官方源。根因是原Host接线和首屏时序覆盖不足，未把它归因于模型随机性或新UI包。

## 验证

- 31项定向检查：修前保留3项实际不变量红测试，另有阻塞脚本／meta顺序及Room工作诊断独立性红测试；修后通过。相关前端类型与产品构建单独执行。
- `chromium.json`／`webkit.json`：真实临时Core＋假运行时目录，付费调用0。暂停主题脚本时，Apple声明已存在、根背景为rgb(255,212,64)；暂停应用模块时，React尚未挂载而顶边已存在。390／844／1130宽度均成立，CSS standalone特意为false、navigator.standalone为true；SPA换页和旋转后仍为同一个顶边节点。
- 两引擎各在1440和390宽度保持Room工作idle，依次将同一Host观测设为online／working／thinking／offline／error，核对正文和成员设置的实际computed background相同；缺失Host观测清除正文角标。不是付费CLI实际运行测试。
- 上述浏览器报告完成后，最后进一步移除头像对Room工作读取的依赖；空诊断与已知Host在线的单测保留，最终构建和既有消息状态流程另行复验。PWA呈现和已覆盖的状态颜色未改变。

既有消息状态门禁先通过了Host状态／离开／未知检查，随后遇到旧的桌面16px断言。独立读取修前仍在服务的构建d1b6ec8，桌面md与手机默认均为14px（`baseline-fonts.json`）；本次没有修改字号。保留失败，按修前事实纠正门禁，不通过改UI字号使测试通过。

实际OS时间／信号栏不在普通浏览器截图范围内；桌面WebKit与注入standalone标志不能冒充iOS／鸿蒙真机通过。部署后需要在原已安装PWA中复看冷开、旋转及搜索页；不要求重新安装来掩盖失效。

## 部署

产品代码`acde15a7`与最终门禁`d1bc067f`均已推送；正式服务从后者构建，于本地时间2026-10-31 01:58完成备份校验、schema91迁移预检与精确进程平滑重启。未强杀工作，未切换adapter123候选。部署收据见[deployment.json](deployment.json)：原本地CA、LAN／Tailnet及无配对模式保持，五个入口均返回同一构建。

部署后，Firefox桌面1440×1000／手机390×844与Chromium触控1130×712，六个大页共18项真实页面检查通过；无脚本异常、失败API、配置／内容写入或横向溢出，普通浏览器不显示PWA顶边。只允许正常阅读回执，未创建正式测试对象或调用付费模型。[正式页面报告](formal-browser.json)不是全站像素或实体设备验收。

浏览器检查后再次核对14个保护表，账本、Role／实例及个人偏好哈希仍与部署前一致；实际服务HTML中的Apple声明／critical CSS在阻塞脚本前，顶边在React root前，script-src self保持。[上线后核查](postdeploy.json)。

当前Web构建ID为`1d21b61b6d6e624638ee4da81efb29fd7fa8186463f39fb321305843a6caae67`。原已安装PWA完全关闭后重开一次以取得新HTML，无需重新安装；实体系统时间／信号栏的冷开、横竖屏和搜索页效果仍由真机确认。
