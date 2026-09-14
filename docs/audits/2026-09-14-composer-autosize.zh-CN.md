# 聊天与文件评论输入框自动增高

## 源码证据与规格

Raft授权源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
Jw（pretty 121819–121841）调用oS的compact变体作为文件评论输入框。
oS（117376–117456）：文字区与底部按钮行分离，外框2px、8px内边距和间距；
textarea rows=1，resize-none、leading-5、min-h-5 md:min-h-10、max-h-32，
字号text-base md:text-sm。发送按钮size-7，图标14px。
qt（116053–116059）以scrollHeight计算自然高度并受minHeight/上限约束；
虽然JS上限是160px，CSS的max-h-32进一步将实际高度限定为128px。

| 规格                       | 桌面≥768px  | 窄屏        |
| -------------------------- | ----------- | ----------- |
| 文字区最小高度             | 40px        | 20px        |
| 字号 / 行高                | 14px / 20px | 16px / 20px |
| 文字区最大高度             | 128px       | 128px       |
| 文件评论完整输入框初始高度 | 96px        | 76px        |
| 评论发送按钮 / 图标        | 28px / 14px | 28px / 14px |

Firefox原生textarea的scrollHeight可能比整行高度多1px；自然高度保留浏览器测量值，
最大高度仍严格为128px。最小高度和空内容高度使用对应CSS参数。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/chat/components/chat-input.tsx:613–642`采用编辑器与50%/max-h-96容器限制，
并非Raft textarea规格，本项未采用其代码。

## 本地所有者与改动

RAH此前频道textarea固定40px，文件评论textarea允许手工纵向缩放；评论还被通用
`.rah-dialog form`规则覆盖成12px等宽字体，发送按钮绝对定位在文字区域上。

共享 `use-composer-autosize.ts` 作为唯一高度计算所有者接入Room/DM、Thread与文件评论。
读取维护型CSS的有效上下限，值变化、初始挂载和宽度变化时重新测量；ResizeObserver只响应宽度，
避免高度观察反馈循环；挂载/卸载使用原有ref并清理观察器。保留光标、草稿和长文本滚动位置。
CSS由ui-tokens的composer样式统一定义，文件评论复用composer-box及独立按钮行。
通用弹窗表单选择器显式排除文件评论，避免跨组件覆盖；其他编辑表单保留原缩放行为。
没有修改发送、IME、Enter/Shift+Enter、提及、附件权限或消息持久化所有者。

本项为原算法和布局参数的结构移植；ResizeObserver、共享React hook为RAH接线。
发送按钮spec的旧24px/12px记录按oS源码更正为28px/14px，不改变全局按钮规则。

## 验证

隔离浏览器先复现频道五行文字仍固定40px的失败，然后验证短文本、五行自然增高、
长文本128px上限、内部滚动、清空回缩、桌面/390px、评论发送后回缩。
专项包含原有评论权限、类型排除、文件计数、预览关闭与reload断言。
Chrome、Firefox专项均通过，额外验证长草稿随窗口变窄重新换行增高、变宽回缩，
以及Room Enter发送后恢复初始高度。`npm run check`、`npm run format:check`、
`git diff --check`和`npm run build:web:workbench`通过。

正式工作台确认无活动工作后，执行完整状态备份与优雅重启。备份：
`/Users/sun/.rah/backups/pre-restart-14ebbd36-229a-42e4-9282-a233d71fa08d`。
冻结并运行的正式Web构建：
`f076331b0be5ccae66196631e2e46562b730818b801913820139cb8c6e6f9a1d`。
新浏览器中针对现有Room、Thread和Markdown文件评论验证自动增高、上限、内部滚动、
清空回缩、按钮行不遮挡；文件评论完整框在1440px为96px、390px为76px。
已检查截图，并验证刷新和LAN/Tailnet访问的是同一构建。正式验证未发送消息，
临时输入后恢复原草稿。没有运行付费CLI测试；没有宣称同前提Raft双边实测验收。
截图证据：`/tmp/rah-composer-size-formal-1440.png`、
`/tmp/rah-composer-size-formal-390.png`。
