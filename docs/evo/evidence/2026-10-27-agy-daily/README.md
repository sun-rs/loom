# AGY 日常路径定向收口

2026-10-27；产品源码基线 ed76bb2f，验收前 HEAD a60052b0。
本批没有产品代码修改、没有模型生成、没有服务重启；不重复创建验收角色或实例。

## 本轮实查

- 正式网页 127.0.0.1:4176，独立 Playwright Chromium，桌面 1440×1000、手机模拟 390×844。
- 新建角色：计算机能力来源→Antigravity→13 个目录模型→Gemini 3.8 Flash Low。推理选项只有 low；取消退出，不保存。真实创建/实例调度的证据沿用此前运行时验收，不将本轮草稿检查称为重新创建成功。
- 编辑现有 Gemini AGY：逐个选择全部 13 个模型，逐个打开推理菜单，断言只有模型 ID 对应的 low/medium/high；每次检查无快速模式。未保存配置。详情原配置保持 Gemini 3.8 Flash Low。
- 手机表单边界 x≥-1、right≤viewport+1，截图见 runtime-mobile.png。手机顶部关闭控件退出草稿；首次脚本错误地寻找桌面“取消”按钮超时，改用实际移动端“关闭”后通过。没有因测试选择器问题改动 UI。
- 实例动态中的“查看用量”打开真实运行记录：输入 19,573、输出 2、生成 1；上下文、压缩、费用保留未知。见 usage.txt / usage.png。此记录是已存在的恢复准备轮，不是新增付费测试或成本对照。
- 本机定向测试 18/18 通过：模型目录、adapter 绑定/会话恢复、driver 取消/失败/截断/会话被替换、附加目录，以及 usage 数值边界。只运行假 CLI，没有真实取消正在工作的实例。

## 代码链路核对

- 创建及编辑共享 `frontends/raft/loom/RoleRuntimeFields.tsx`，使用官方 RuntimeFormV2Fields 和 dependent_select；没有新增 AGY 专用页面。
- 实例停止沿既有 Host 进程生命周期。agy-print-driver 取消测试确认子进程结束、保留用量且不能发布 final；失败流同样不能伪造回复。真实停止/登录失效的系统级体验没有在本批制造故障验证。
- Fork/Side 由 `branch-client.ts` 的运行时 sessionBranches 能力判定；`useInstanceBranches.tsx` 在能力不支持时禁用创建并解释不可用。AGY 没有宣告这些能力；本轮为源码核对，未点击创建分支。
- `RunUsageDialog.tsx` 沿 agent.run.usage.get 展示 durable 用量和缺口；没有 AGY 专属估算或重复叠加累计 result.usage。

## 日常使用与限制

在 Agent 页创建角色，选择本机 Antigravity 和目录模型，填写角色 Prompt，再添加实例到频道即可。角色只是配置，实例才执行；修改角色不会改变既有实例，采用新配置须显式重启时选择。

可供日常试用的基础路径已有证据，不等于所有模型都生成验收通过：目前仅 Gemini 3.8 Flash Low 有真实运行证据。Fast、Fork/Side、独立可执行文件打包仍不支持；自动记忆禁用、长任务效率、子代理完整计量未验收。停止的新增证据为假 CLI 测试；手机为模拟浏览器，不是真机。

本轮没有复现需修复的新缺陷。保留原功能与限制，避免为“收口”制造新实现或额外付费实验。
