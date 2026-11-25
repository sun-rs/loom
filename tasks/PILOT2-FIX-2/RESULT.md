# PILOT2-FIX-2 结果

投递 `64e3ea10-3659-465e-afd9-6e1ee6d1934e` 的 holder 事件 1177 只写入了 **1,022／1,221 字节**，返回 `partial`。loomd 当时以 `HOLDER_UNCERTAIN` 停止，未执行自动 Enter。Claude 的 `[Pasted text #3 +15 lines]` 行数与原载荷相符，因为缺失的是靠后的字节，行数无法证明正文完整。原生 `UserPromptSubmit` 与 transcript 第 217 行均含截断正文和 U+FFFD。人工 Enter 触发了旧版的仅凭标记确认。 [现场屏幕](/Users/sun/Code/exp-relay/pilot2-held/t3fj-screen-2.txt) · [holder 回执摘录](partial-receipt.json)

## 修复

- loomd 在 UTF-8 码点边界生成粘贴分片，短写后先根据回执确认已写前缀，再按同一次投递的连续 stdin 区间补发尚未写入的后缀。零写入重试沿用对应 holder write ID。若内核本身在码点内返回短写，剩余字节紧接着写入同一个 bracketed paste。发送前复核人类输入、尺寸、缓冲区和原生轮。遇到无法确认的写入或会话变化时保留草稿并标明已知字节数，完整正文通过校验后才允许 Enter。 [分片和回执验证](../../tui/holder-paste.mjs) · [写入控制](../../tui/holder-terminal.mjs)
- 新 loomd 从持久 inbox、请求簿及 holder journal 认领草稿。连续回执须匹配原载荷的 SHA-256、长度与字节范围。它核对自写入以来的人类输入、几何变化、其他写入和原生轮证据。agy 在未收到粘贴结束符时可能无新输出，loomd 可凭已验证的 UTF-8 前缀续写，随后等待新重绘、校验完整正文，再通过原子 guard 提交一次。完整性或提交状态不明时保留草稿，附 `heldDraftBytes` 并通知 Super。 [草稿接管](../../tui/index.mjs) · [通知](../../daemon/supervisor.mjs)
- Claude v3 的 `UserPromptSubmit` 或已绑定 transcript 必须同时证明标记和用户正文。移除原生的粘贴包裹后比较 SHA-256，保留包裹之外的实际字符。发现不一致时将投递记为 `corrupted`，清除旧的送达／回复记账，通知 Super 和仍活跃的发送方，不自动重发。升级后会重新核查旧版已确认的 Claude v3 投递。 [原生正文比较](../../inbox/message.mjs) · [投递对账](../../inbox/engine.mjs)

## 验证

- 真实 Claude 2.1.331，绝对 CLI、隔离 HOME、独立 hc、本地 mock。A 在测试中故意扣留一个已经完整粘贴且显示 `+16 lines` 的草稿。B 从原 holder 接管，原生 session ID、Claude PID 58318、holder PID 58168 和窗格保持，草稿原生确认 1 次，人工输入 0。B 还完整送达 **1,624 字节**的多字节正文，原生确认 1 次。 [只包含本卡修复的实机结果](/Users/sun/Code/exp-relay/pilot2-fix-2/r-Eceboz/summary.json)
- 同一实机测试中，A 将一个刻意截断的输入记为已送达。B 将其改为 `corrupted`，保存不同的摘要，生成 Super 通知并向隔离的原发送方排队一条通知。 [投递与通知日志](/Users/sun/Code/exp-relay/pilot2-fix-2/r-Eceboz/claude/steps.jsonl)
- 另一次实机故障测试让原版 loomd 遭遇实际短写，B 升级后继续显示 `draft-held`，状态和 Super 通知记录 **1,022／2,411 字节**，原生确认 0 次。 [不完整草稿结果](/Users/sun/Code/exp-relay/pilot2-fix-2/r-3Cm3B5/summary.json) · [回归测试](../../tui/holder-paste.test.mjs) · [历史回执回归](../../inbox/inbox.test.mjs)

## agy 与 Neon 公告

- Addendum 2 已覆盖。原卡 `2563eea1` 的首个粘贴分段只写入 **1,022／1,058 字节**，紧接着 Super 投递 `9d7c2757` 从同一个 stdin 区间写入。新 loomd 从旧请求簿识别这种未提交的写入，即使旧 daemon 标记为 `released` 且画面显示空白，Super 仍须等待。回归测试验证禁止发送新文本或清理按键。 [现场捕获](/Users/sun/Code/exp-relay/pilot2-held/t3fk-partial-paste.txt) · [回执摘录](agy-receipts.json) · [回归测试](../../tui/holder-paste.test.mjs)
- 旧 Leader 的原生第 67 步在同一条 `USER_INPUT` 中记录了两条投递。按已保留的摘要定位第二条完整正文后，`2563eea1` 校正为 `corrupted`，`9d7c2757` 记为 `received`。仅当第二个标记有独立预留，且其完整后缀匹配时才拆分。正文内引用的标记不影响本条有效回执。 [解析](../../inbox/message.mjs) · [对账回归](../../inbox/inbox.test.mjs)
- v3 在正文外检测到已知的 Neon 公告时暂停粘贴。若同一请求仍持有可验证的前缀，发送一次带固定 ID 的 Escape。只有 holder 回执证明该键与前缀连续，且新重绘确认公告消失，才续写已验证的后缀。回归使用 t3fm 捕获的公告文字，覆盖 Escape 后更换 loomd、公告消失后恢复、Escape 无重绘时继续保持草稿。 [捕获与回执](agy-receipts.json) · [回归测试](../../tui/holder-paste.test.mjs)
- **t3fm 的现场草稿 `5b58581e` 仍需人工决策。** holder 事件 10 和 12 分别匹配 **259** 和 **1,022** 字节，共 **1,281／4,621 字节**，事件 12 停在 UTF-8 码点中间。事件 14 已显示公告，事件 17 记录了一次旧 loomd 的 Escape，后面没有重绘，读取现场时公告仍在。现有回执无法证明 Escape 被消费为关闭公告，也无法证明此后缓冲区仍是精确前缀。热升级会保留这条草稿并通知 Super；不能仅凭已有回执自动补发或提交。这次只读取现场，未键入或部署。 [现场事件摘录](agy-receipts.json)

## 独立补丁

- 在干净的 `d29515e7` 工作树运行 `git apply --check` 后应用补丁，`git diff --check` 通过。`npm test` 通过 **311／311**，无失败或跳过。 [fix.patch](fix.patch) · [独立工作树](/Users/sun/Code/exp-relay/pilot2-fix-2/split-stekbffq/checked) · [测试日志](/Users/sun/Code/exp-relay/pilot2-fix-2/split-stekbffq/npm-test.log)
- 以该工作树构建的 B 通过独立 agy 实机复现：旧版实际短写 1,022 字节，B 仅升级 loomd，补齐并提交了 2,901 字节正文；原生确认 1 次、正文摘要一致、人工输入 0。agy PID 48044、holder PID 47827、原生会话和窗格均保持。 [agy 实机记录](/Users/sun/Code/exp-relay/pilot2-fix-2/r-IJmfe2/summary.json)
- 同一补丁构建的 B 重新通过 Claude 实机复现：接管完整草稿，完整送达长多字节消息，并校正旧版错误回执，生成两条通知。Claude PID 47951、holder PID 47821、原生会话和窗格均保持，人工输入 0。 [Claude 实机记录](/Users/sun/Code/exp-relay/pilot2-fix-2/r-lBWaon/summary.json)

STATUS: done
