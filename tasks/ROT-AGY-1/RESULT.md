# ROT-AGY-1 结果

## 根因和证据

- t3nd 的会话记录确认 Herdr 已完成放置，`holder-v3` 已启动，`compactHandover` 已生效。首投 `06284501-c3a5-4d9e-97ca-a2b84802ed63` 在约 120 秒后记为 `waiting-writable`，随后 `self-rotation-overdue`。holder 日志有屏幕输出、零次守护写入，`requests.jsonl` 为空。首投未进入粘贴。
- agy 在第一次 `PreInvocation` 前没有原生空闲信号，因此首投依赖 holder 的安静、无人工输入、可写屏幕和空输入框判定。1.5.18 实际欢迎屏有双边框、光标和亮黑色 `Accept-edits mode` 占位提示，下边框后没有快捷键或模型页脚。旧判定得到 `screen=unknown`、`composerEmpty=false`。同一字节流在修复后得到 `idle`、`composerEmpty=true`、`ready=true`，原生阶段仍未出现。 [只读重放](/private/tmp/loom-rot-agy-replay.log)
- 现有的带快捷键页脚夹具可由原判定接受。继任者实际缺的是这项屏幕证据。首任 t3kg 的欢迎画面字节不在提供的材料里，无法确定其首次绘制的具体差异。`812270f0` 与任务基线使用相同的 agy 屏幕及 holder 可写判定。缩短交接文案只影响判定通过后的输入，Herdr 放置完成也不能代替输入框判定。

## 修复和验证

- 识别欢迎画面的原生占位样式和光标位置，处理软折行的边框。该形态可作为空输入框证据，继续保留 holder 静默窗口、人工输入、原生状态和弹窗拦截，以及粘贴后核对。带相同文字的普通草稿仍不会写入。
- 换班失败即关闭有归属的继任会话。失败记录可供重启后重试回收，前任继续担任角色并接收排队工作。
- 两项回归修复前分别复现 `waiting-writable` 和未调用终端关闭。修复后交接首投仅提交一次，经原生 transcript 核验。超时回归模拟关闭失败与重启，确认只回收继任终端。定向测试 5 项通过。 [RED](/private/tmp/loom-rot-agy-red.log) · [GREEN](/private/tmp/loom-rot-agy-green.log)
- `npm run lint` 与 `git diff --check` 通过。全量 `npm test -- --test-concurrency=4` 875 项通过，失败、取消、跳过均为 0。 [全量日志](/private/tmp/loom-rot-agy-full.log)

STATUS: done
