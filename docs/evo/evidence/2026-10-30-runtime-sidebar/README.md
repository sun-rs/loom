# Kimi 目录、AGY 模型／effort 与 Role 侧栏

## 已修复与根因

- Kimi 2.4.0原生启动明确报`Stored token was rejected; re-login required`，旧目录仅4模型。
  Owner重登后，原生provider目录立即新增`kimi-code/k3.1-pro`及highspeed，effort均low/high/max。
  未硬编码模型、改账号或重写已存在实例。Loom注册的Runtime快照在启动时产生，
  API明确标记`restartRequiredToRescan:true`；60秒探测缓存不等于运行中注册目录会热更新。
  本次部署安全重启后再检查正式目录；元数据可见不等于真实付费生成已验收。
- AGY原生13个精确ID按已发布的模型后缀／唯一effort匹配，UI合并成5个模型，effort另选。
  新增纯展示映射，原生RuntimeFormV2渲染／级联逻辑未修改。普通CLI模型保持独立。
  原生搜索控件会显示不同于label的value，因此控件使用可读的临时选择值；
  每次变更先解析回真实binding，RoleForm／Revision／CLI永远不接收逻辑分组ID或label。
  未发布的effort不产生binding，不改变冻结实例；保存／重开／切effort均核对精确ID。
- “角色”此前是不能点击的div；现在与“已删除”均为原生Disclosure，独立折叠、
  键盘Enter可操作，刷新保持。默认角色展开、已删除折叠；计算机分组原折叠语义保留。
- 两个原生SectionControl热区均28×28。SVG size属性被原生Button CSS覆盖为18px；
  此处新增的Loom刷新功能使用明确14px图标，与16px＋匹配视觉密度，保留原生hover／触控区。

## 官网侧栏差异：不能只校验 npm

在正式Chrome登录后查看官方成员页，并以菜单确认缩放100%。从其HTML取得实际资源：
Web1.21.38 `app-shell-CKVQUGrN.js`与`vendor-raft-ui-Dpk9ZoCV.js`。
app-shell SHA与已锁的1.21.38资源相同；这不是新的全站升级。
实际包仍使用旧侧栏配方：外层p-2、行pl-2/pr-2.5和真实1.5px边框、标题px-2。
Loom的npm0.52使用新list-cell：8+12px，标题20px，且外层已移除水平padding；
上一轮只与npm比较的20px结论**不能证明官网页面一致**。

本批锁定独立原始片段及完整资源hash于`upstream/role-sidebar-2026-10-30`，
`generate-role-sidebar-geometry.mjs`生成仅Role列表的水平兼容参数，
`generate-identity-rows.mjs`只增加显式style插槽。保留原件、原生包、既有行主体、hover、
selected、字体和手机密度例外；不修改共享Frame、其他页面或不可变源码。
这是明确的局部结构移植，**不是整个旧官方组件的逐字替换**。

| 相对侧栏左边界           | 修前 | 修后／官网组合   |
| ------------------------ | ---- | ---------------- |
| Role头像                 | 20px | 17.5px = 8+8+1.5 |
| 角色／已删除标题内容起点 | 20px | 16px = 8+8       |
| Computer分组内容起点     | 8px  | 16px = 8+8       |

当前package与Web资源仍分开锁定，未来升级必须比较两者，不能用其中之一推定整页一致。

## 验证范围

先有缺少折叠／模型分组测试失败；新增官网几何断言也实际以20≠17.5失败，再实现。
原生搜索控件的临时value初版露出了内部group标识，浏览器检查发现并修复，没有作为产品部署。
28项定向检查、Loom/root类型、产品构建、受影响源码／表单／生成一致性检查通过。

1440×1000和390×844，真实临时Core、Fake CLI目录、无付费执行：
两个分组独立折叠、刷新保持、Enter展开，两个图标/热区、头像/标题/分组几何；
AGY模型不含effort后缀，low保存／重开／切medium得到对应精确ID；Kimi Pro选项可见。
正式服务不创建测试Role、频道或实例；没有新一轮模型能力、成本或真机验收。

`01987e8a`已推送并备份／平滑重启，schema91，保护账本／Role／实例／偏好校验保持，
LAN与Tailnet原CA验证通过。正式API Kimi目录6项、AGY精确binding13项；
Chrome真实页面确认Kimi Pro／Highspeed可见、AGY展示5模型且effort独立，打开原配置仍无脏稿。
没有保存Role、创建测试对象或执行付费生成；恢复原侧栏状态、关闭临时标签。
见deployment.json、formal-catalog.json和formal-page.json；模拟截图不冒充实体手机。
