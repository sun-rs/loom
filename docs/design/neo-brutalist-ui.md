# RAH Neo-Brutalist UI

RAH OS owns this library. It adopts authorized Raft assets and inspected behavior,
but the temporary `raft-ui` reconstruction is neither a dependency nor an absolute
standard. This is the maintained product, not an official Raft source distribution.
See [ADR 0028](../adr/0028-owned-neo-brutalist-ui-library.md).

## Start here

- [Library catalog](../../packages/ui-tokens/neo-brutalist-library.json): stable
  component/template IDs, source owners, behavior IDs and executable scenarios.
- [Visual resources](../../packages/ui-tokens/README.md): CSS, fonts, sprites,
  avatars and the distinction between immutable assets and editable source.
- [Components and templates](../../packages/ui-web/README.md): production imports
  and controlled composition examples.
- [Behavior registry](../product/ui-behavior-registry.json): the existing contract
  owner, including official evidence, applicability and local differences.

The catalog links these records; it does not create another business protocol.
The maintained catalog covers ten primitives and five composition templates.
It does **not** certify all pages, states, permissions or official parity.

## Visual grammar

Use semantic CSS variables from the library, not a second palette in a page.

| Family            | Contract                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| Surfaces          | White reading surface, cream navigation, hard black boundaries                 |
| Accent            | Yellow rail/active tabs; pink selected navigation and primary actions          |
| Functional colors | Cyan runtime; lavender model/mention; orange warning; coral destructive action |
| Typography        | Packaged Space Grotesk and Space Mono; retain the quote-glyph fallback         |
| Edges             | Square controls, solid boundaries, hard offset shadows without blur            |
| Motion            | Explicit hover/press/focus/disabled rules; no data-reconciliation animation    |
| Layout            | Shared header tracks, single divider owners, bounded resizable panels          |

Colors are not business facts. Unread attention, Computer connectivity, Agent
presence and diagnostic events have separate existing data owners. Never derive
an Agent's status by choosing a convenient accent color.

CSS is authoritative for rendering values. Do not copy this table into constants.
Historical fallback tokens and extracted aliases still coexist; their consolidation
is recorded debt, not permission to add another override.

## Chat sidebar geometry

Chat sidebar geometry is owned by `SidebarDrag` / `SidebarSection` and the
sidebar CSS. Keep a column flex container around sortable groups so 12px top
and 4px bottom spacing cannot collapse. Empty pinned content is at least 36px,
other empty groups 28px; identify groups semantically, never with `nth-child`.
Group labels/counts are 12px, conversation names/Saved are 14px. Sort/create
actions use 24px buttons, 14px icons and a 4px gap. Icon-only `DiscoveryFilter`
triggers must omit empty label nodes, which otherwise create a second grid row.
See [source and geometry checks](../audits/2026-09-15-sidebar-spacing-and-actions.zh-CN.md).

`SidebarSection` owns disclosure defaults: empty groups start collapsed and
populated groups start expanded. Empty/nonempty transitions reset that default;
other count updates and polling preserve manual disclosure. Empty hints remain
available by manually expanding a group. This is a local product policy, not a
port of Raft's persisted collapse preferences.

The entire `.rah-room-sidebar` owns `user-select: none` and WebKit touch-callout
suppression, including blank padding, group gaps and hints. Do not patch individual
rows or disable touch scrolling to suppress selection. Portaled editors and chat
text keep their own selection rules. Below 768px, group top spacing is 8px (12px
net header gap) and conversation bottom spacing is 2px. Desktop keeps 12px/4px.
The follow-up same-device comparison sets mobile row padding-block to 4px:
32px rows plus 2px gaps, approximately 34px pitch. Text and avatar sizes stay
unchanged. This local iOS density differs from Raft Web's 8px narrow-screen padding.
See [defaults, touch and mobile density evidence](../audits/2026-09-15-sidebar-defaults-touch-density.zh-CN.md).

## Agent choice row colors

Choose colors by component family and interaction state, never by whether the
component is inside a modal, drawer, popover or base page. The
[source-backed matrix and counterexamples](../audits/2026-09-14-agent-choice-hover-contract.zh-CN.md)
are the current contract: member-add/create candidates use full yellow hover;
member browsing and property menus use 30%; autocomplete distinguishes the
current candidate from ordinary hover (including 50%). Task-modal assignee menus
remain 30%, and sidebar Agent search can become full yellow on pointer entry.

Raft's unqualified `soft-signal` is opaque `#FFD440`. Our historical
`--soft-signal` already contains 30% alpha. Use `--yellow` for opaque yellow and
`--soft-signal` for that existing 30% contract; derive other source-backed alpha
values from opaque `--yellow`. Never infer equivalence from token names or apply
alpha twice. Do not change the global alias to repair one component.

Treat hover, keyboard/pointer current candidate, selected membership and disabled
states separately. Pink 20% plus a checkmark belongs to the create-channel member
selection contract, not every Agent picker. Preserve shared component behavior
when nesting it in a dialog; do not add ancestor-modal hover overrides. New or
changed pickers must cite their source family and verify computed colors on
pointer entry/exit, selected rows and keyboard highlighting as applicable.

### Shared choice-state contract

Component differences do not authorize page-specific palettes. The reusable
contract has three layers: library-owned color values, explicit interaction
states, and a closed set of component profiles. This is a presentation contract,
not a new command/event in `packages/protocol`.

The color vocabulary is opaque yellow (`--yellow`), yellow at 30%
(`--soft-signal`), yellow at 50% (derived once from opaque yellow), and pink at
20% for the member-selection marker. These are the existing source-backed
recipes, not permission to choose arbitrary alpha values. Alpha is composited
over the actual surface; a sampled screenshot RGB must not replace that recipe.

| Profile            | Applicable interaction                         | Ordinary unselected hover | Current candidate                     | Committed selection                            |
| ------------------ | ---------------------------------------------- | ------------------------- | ------------------------------------- | ---------------------------------------------- |
| `member-selection` | Create/edit channel and add-member candidates  | Opaque yellow             | Follow the registered picker behavior | Create/edit members: pink 20% plus checkmark   |
| `member-browse`    | Existing member rows and identity navigation   | Yellow 30%                | No autocomplete current index         | Membership is data, not a selected-row color   |
| `property-option`  | Agent assignee and equivalent property options | Yellow 30%                | Shared menu highlight: yellow 30%     | Preserve the selected-value checkmark          |
| `autocomplete`     | Chat mention and sidebar conversation search   | Yellow 50%                | Opaque yellow                         | Accept the candidate using the existing action |

These profiles are exported by `ChoiceRow` in `ui-web/neo-brutalist/choice-row`.
`profile` is required. `current` is available only for autocomplete/property
options. Member selection explicitly opts into `selection="tint"` plus `selected`;
add-member checkboxes keep the default check-only marker. `as="div"` supports
member rows containing independent controls without nesting buttons.
The API excludes inline `style`; callers retain geometry classes and actions.

State rules are shared:

- `hover` means pointer presence; `current` identifies the keyboard/pointer
  navigation candidate; `selected` means the value already chosen. Keep them
  independent. Sidebar search promotes pointer entry to current, explaining
  opaque yellow without introducing a sidebar-specific color.
- In autocomplete, current wins over ordinary hover. In member multi-selection,
  the committed pink marker remains on hover. Property options retain their
  checkmark while the menu highlight changes. Do not create one universal
  selected/hover priority that erases these distinct meanings.
- Focus indication remains explicit and must not silently commit a selection.
  Disabled options cannot activate and must not gain enabled hover/current
  feedback. Pointer exit removes hover but does not erase a separately owned
  current or selected state.
- Moving the same component into a modal, drawer or page preserves its profile,
  state rules and values. Overlay dimming is a separate surface behavior.

New Agent choice surfaces must select an existing profile and reuse its owner;
pages supply data, state and actions, not color/alpha/hover-style overrides.
An additional profile requires a central contract update with a source-backed
reason and interaction tests; a new window is not itself such a reason.
`ui-tokens` owns rendering values, `ui-web` owns shared row presentation, and
the existing client/component controller continues to own current/selected
state. A visual row must not introduce another business-state owner.

Adopted callers: create-channel candidates, add-member candidates, Human/Agent
Room member browsing, shared DiscoveryFilter property/assignee options, and the
Room/DM/Thread/file-comment mention menu. Reaction options remain their separate
pink family. Agent directory navigation cards, ordinary conversation rows and
native `<select>` controls are not Agent choice rows and retain their own contracts.
There is currently no separate sidebar conversation autocomplete controller to
migrate; the shared autocomplete profile supports its source-backed current state.

`npm run check:ui-library` runs `ui-choice-contract.mjs`: it discovers ChoiceRow
consumers and their geometry classes, rejects inline styles/prop spreads/raw
profile attributes, and rejects local background/opacity/filter/custom-property
rules targeting those rows, including enclosing-container button rules. Layout
and child-icon rules remain permitted. `npm run test:ui:choice` verifies computed
colors in Chromium/Firefox at desktop and 390px widths, pointer exit, current,
selected, disabled, nested placement and the actual shared property picker.
The browser gate is also part of `npm run check`; broad global CSS must still be
reviewed and tested, not assumed safe solely because a static selector scan passes.
New picker work must use this API. Evidence and scope:
[code adoption](../audits/2026-09-14-choice-row-code-contract.zh-CN.md).

## Ownership and composition

Sidebar touch interaction follows the
[source-backed touch contract](../audits/2026-09-14-sidebar-touch-and-mobile-navigation.zh-CN.md).
Touch scrolls or opens the context menu on long press; it does not reorder rows
or groups. Mouse and keyboard sorting remain available regardless of viewport
width. Navigation labels and menus suppress native selection/callouts, while
inputs and message text remain selectable. ContextActions owns release-click
suppression after its existing library long press; do not introduce a second
timer or block all touchmove events. Desktop WebKit automation is not physical
iOS Safari/PWA acceptance.

1. Load `@rah-os/ui-tokens/neo-brutalist.css` once at the application boundary.
2. Import primitives from `@rah-os/ui-web/neo-brutalist/*`.
3. Pass labels, values, disabled/pending state and callbacks from the existing
   product owner. Components do not fetch, persist Room state or parse providers.
4. Pages retain composition and typed SDK/client-core integration. A template is
   a composition of the same components, not cloned HTML or simulated success.
5. Edit a migrated family's library owner and remove its obsolete page rule.
   Do not fix it with a late `!important`, duplicated selector or new theme.

Identity composition is owned by `apps/web/src/workspace-entities.ts` and its
application-boundary provider. Consumers resolve stable Human/Agent principal,
Agent definition, Computer and Runtime bindings there rather than joining names
or maintaining page-local copies. It is an authorized-input read model, not a
new backend truth. Missing ownership/creator facts stay unknown. See the
[staged identity closure plan](./ui-entity-network-closure.md).

The status-dot primitive owns its complete shape/state even without a parent
page class. The library gate rejects unresolved CSS variable names; real browser
checks still own scoped cascade, actual values and interaction verification.

Body primitives now include `EntityCard` and `EmptyState`. Cards accept an
already-authorized identity, runtime subtitle and one trailing presence slot;
they cannot infer presence from CLI availability. `AgentEntityCard` connects the
existing view and status projector, not a second data store. Computer and
created-Agent lists consume this same presentation owner.

`ProfileSection` owns the 20px horizontal / 16px vertical spacing and 1px muted
divider for the Human profile body. The typed `human.profile` query supplies
current Workspace membership and immutable creation IDs; the entity directory
joins those IDs to the authorized catalog. A principal is not a Computer owner.
Human profile navigation uses principal ID and never creates a self-DM. Fields
without canonical data (email, hardware ownership) are omitted,
not filled from OS data. Agent/Computer section adoption is described below;
the complete Human directory and ownership relations remain separate work.

`ProfileField` owns the multiline description edit state, 3000-character limit,
Save/Cancel, Escape focus return, pending state and error/draft retention.
`HumanIdentity` joins authorized candidates through the entity directory and
opens the same Human route from message avatars, mentions, creators and graph.
Profile and account edits share `useHumanProfileMutation`; only the existing
authenticated `principal.update` owner writes identity or image references.
See [Human page family](human-page-family.md) for source and scope boundaries.

Agent and Computer bodies also consume ProfileSection. The `field` variant owns
the 4px heading gap; `divided=false` is the Agent inline-field 12px vertical variant.
Default sections use natural content height with 20px horizontal/16px vertical
spacing and a 1px muted leading divider. Never restore fixed per-page section
heights. The title action slot uses the shared edit affordance. Profile/preview
CSS is maintained here, not layered underneath page-specific overrides.
See [Agent/Computer family](agent-computer-profile-family.md) for projection,
permission and local adaptation boundaries. UI009 is a scoped implementation
record, not a full-product parity certification.

Identity previews use the existing `PreviewCard` lifetime/placement owner and
the internal `preview.css` frame (background, border, shadow and stacking).
Agent and graph page-local frame rules were removed. The graph's existing
compact shadow remains an explicit variant; identity content stays in callers.

Empty states require a named `search`, `profile`, `task`, `activity` or `file` context and `fill` or `section`
placement. Search home fills its remaining stage only when suggestions are
absent. Profile empty content fills the area **after** the diagnostic toolbar.
Loading and read failures belong to the caller and must not show a successful
empty result. Other page families are not silently switched to either context.

Native disabling applies to pointer and keyboard. Tabs use one focus stop,
wrapping arrows, Home/End and disabled-item skipping; these move focus only.
Enter/Space activates the focused tab (Raft `activateOnFocus=false`). Splitters own pointer
capture; existing panel policies own bounds and persistence. Room/DM/Thread
Enter sends; Shift+Enter inserts a line; IME confirmation never sends. The
composer keeps its existing owner and is not part of this initial move.

## TDD, examples and comparison

Run `npm run check:ui-library`, `npm run check:ui-contract`, and
`npm run test:web:foundations`. The latter uses Chrome/Firefox, the real library,
production templates and isolated canonical fixtures. The executable page is
`apps/web/test/ui-foundations.html`, available through the development server at
`/test/ui-foundations.html`; it is not a shipped product route.

Cover rest, hover, pressed, focus, disabled and pending states, plus long names,
empty data, denied capabilities, open inspectors, narrow screens and both sides
of breakpoints. Review screenshots, geometry, focus, pointer targets and callback
assertions. Browser receipts include library source/catalog hashes so moving a
component cannot hide later evidence drift.

Run `npm run test:web:ui-compare` for the foundation and Shell official-capture
replays, with generated JSON/Markdown differences, pinned evidence and source hashes.
See [the comparison and release contract](./ui-evidence-and-release.md). This is
not a fresh official-site scan, and does not cover all component/mouse states.

Further bilateral comparisons target these production owners at matching viewport,
font readiness and data preconditions. Official evidence, reconstructed fixtures
and self-regression have separate labels. An unavailable official state remains
unverified. Never update a baseline merely to turn a failed comparison green.

## Adoption and maintenance

Edit maintained source directly, recording a reason in `adoption.json` when an
adopted file changes. Keep original hashes and immutable historical evidence.
For new official evidence record URL/version/hash and applicable behavior IDs;
do not infer authority from a filename containing `official`.

Upstream updates are reviewed inputs, not automatic replacements. Preserve
authorization/attribution records; do not relabel third-party assets as RAH-authored
or assume this private library has a new redistribution license. Retire old
sources through scoped Git changes after dependency and browser checks.

## Remaining migration

Legacy page CSS in `apps/web` remains active. Settings, Computer, global
discovery and Saved/Search header tracks now consume the library. Search retains
its input composition and uses the compact header action for clear-query;
Saved retains its title/subtitle composition. Page bodies, general buttons,
forms, overlays, empty states and toolbars still
need family-by-family consolidation. Settings shared cards/forms and scoped
profile drafts now use the internal Settings owner; see
[Settings family](./settings-page-family.md). Preview pending/open Escape is
covered by the profile-family regression gate. Expansion of official bilateral
coverage remains open work; local migration does not certify it.
The notification read-failure mislabel found in the Shell review is corrected:
unknown/read failure, unsupported browser, unavailable daemon Push configuration,
permission and subscription are separate view states. Read-only retry and stale
response fencing are tested without creating a subscription. This does not
certify OS notification delivery or all notification settings; see the
[scoped implementation plan](./ui-secondary-headers-and-push-status.md).

Interactive notification popovers now share the internal `interactive-popover` owner,
using pinned Base UI for hover bridges, dismissal and focus. Raft's desktop 0/120 ms
and keyboard-only initial focus are source-backed parameters; mobile opens on click.
InputRequest answering remains a separate modal dialog. See the
[scoped takeover audit](../audits/2026-09-06-notification-popover-takeover.zh-CN.md).

## Mobile root navigation exception

The user-selected [iOS reference tab bar](../audits/2026-09-14-mobile-ios-tab-navigation.zh-CN.md) uses a translucent rounded surface and gray active capsule on mobile root pages. This is a bounded navigation presentation exception, not a change to dialog, button, Agent choice-row or desktop Rail styles. Detail pages hide the bar. Dimensions and blur are maintained RAH CSS based on supplied screenshots, not extracted native iOS source.

Mobile header geometry and the yellow-title segment variant follow the [density refinement](../audits/2026-09-14-mobile-header-density.zh-CN.md): 60px title track, 36px root icon, 32px navigation action; global task segments on a yellow mobile title use white/inactive and pale-yellow/active with no extra hover color. Header identity sizing is now source-verified at 36px (Raft PanelHeader `size-9` / Avatar `md`), distinct from the 32px action (`icon-md` / `size-8`); the 60px track remains screenshot-derived. Reuse shared owners rather than per-page overrides. See the [mobile follow-up](../audits/2026-09-15-pwa-navigation-and-task-stability.zh-CN.md).

The mobile capsule sits at `max(8px, safe-area-bottom - 12px)`, uses a 55% white surface with 12px backdrop blur, and keeps scrollable content underneath. These are explicit local native-reference parameters. The Home bell's selected appearance follows popover `aria-expanded`, never sticky touch hover. Task segments suppress native tap highlight; loaded task empty states stay mounted during background refresh.

Mobile Room task tools use one row: creator, assignee, a compact “＋新建” create action, and view segments. Bulk clear stays desktop-only; each shared filter menu retains its own clear action. Room segments on white use white/inactive and full yellow/active; global task header segments keep their pale-yellow signal-surface variant. Task card touch gestures belong to native two-axis scrolling (touch-action:auto, no TouchSensor), while MouseSensor and KeyboardSensor retain desktop dragging. See [task touch and compact toolbar evidence](../audits/2026-09-15-task-touch-and-compact-toolbar.zh-CN.md).

Task creation is a title-only, max-448px dialog on both desktop and mobile. Task cards and colored task references open approval details (desktop overlay with X, mobile full-screen with back); reading previews retain the split Thread. Message actions use the shared MessageItem owner: fine-pointer hover, keyboard focus, or an explicit touch tap, never a touch-media default. Default icons use 50% black. See [task presentation and actions](../audits/2026-09-15-task-presentation-and-message-actions.zh-CN.md).

### PWA 列表索引与直接点击

移动端只展示列表索引时，不渲染桌面的默认/记忆选中项（包括已保存、设置、成员及计算机）。
返回索引必须由导航 owner 同时恢复对应根导航；不要只揭开隐藏列表，留下详情 surface。
共用消息子控件直接响应第一次触摸点击；PWA 不显示卡片操作条或点击黑框，长按打开共享菜单，不能在 pointerup
阶段改变祖先呈现或吞掉子控件事件。任务筛选/创建入口复用共享 tap-highlight 禁用规则，
不改变实际筛选状态色。证据见 [PWA 首次点击修复](../audits/2026-09-15-pwa-first-tap-and-visible-selection.zh-CN.md)。

全局与 Room 任务工具栏共享两级间距：桌面筛选/创建按钮 8px、看板/列表 4px；
PWA 筛选/创建统一采用现有全局页面的 6px 适配，看板/列表仍为 4px。
Room 创建者/负责人复用 DiscoveryFilter 多选与计数，数字出现时按钮自然变宽。
窄屏放不下时工具栏单行横向滚动，不压缩间距、隐藏数字或裁掉操作入口。
筛选器的 hover 边框仅适用于细指针悬停设备；真实展开黑边和实际筛选状态分别由
`aria-expanded`、`is-selected` 决定。

Room 筛选属于本次 Room 访问：离开后从聊天列表重新进入，显示聊天并清空筛选；
同一 Room 内打开/关闭消息列或人员资料不结束访问。全局任务筛选由 App 按工作区保存在
当前页面内存，跨导航保留、刷新清空；不缓存业务数据，也不恢复旧的任务/消息列目标。
详见 [任务多选与筛选生命周期](../audits/2026-09-15-task-filter-scope.zh-CN.md)。

### Chat approval overlays and mobile identity return

Chat avatars retain brightness feedback without a pressed translation. At the
mobile breakpoint, Human/Agent inspectors use the shared 32px left back action;
desktop inspectors keep their right close action. A chat Task badge opens an
approval overlay without changing the underlying Room/Thread selection, focus
request, DOM identity or scroll offset. Dialog focus return uses `preventScroll`.

On phones this badge overlay contains Task details, canonical operation history
(maximum 240px / 30dvh with internal scrolling), status, assignee and creator. It
has a dimmed backdrop and right close action, no discussion or composer. Desktop
badge overlays retain the shared Thread discussion. Task-card entry from global
or Room boards keeps its full detail presentation. `ChatTaskApproval` owns this
presentation split; existing Task controls, MessageSession and Room mutation
barriers remain authoritative. This compact mobile presentation is the user's
explicit adaptation, not a claimed byte-exact port of the Raft iOS source.

### 消息长按、选择与本地导出

2026-09-15 当前合同取代旧的 PWA 轻点显示消息操作条：Room、DM、Thread 和完整 Task
讨论复用 MessageItem；移动布局隐藏黑框及角落操作条，500ms 长按显示共享菜单，移动超过
8px 取消长按以保留滚动。正文禁用浏览器原生选择/长按 callout；“复制文本”独立全屏页
恢复文字选择，保留正文排版和右上角关闭。桌面 hover 操作条与直接文字选择保留。

菜单不提供复制链接；“打开消息列”沿用原导航；普通消息的“转为任务”紧邻收藏，无分隔线。
已关联任务的完成/重开操作位于关注消息列之后，单独放在末组，用分隔线区分。
仅已完成任务提供重开；已关闭任务按 Raft 提供标记完成。文案和提交目标共用
`messageTaskMenuTarget`，不能分别推断。普通回复不继承母任务或母消息列的菜单操作。
普通 Thread 母消息复用 canonical task.convert。移动菜单分隔为 1px、12% 黑色。
菜单通过统一 portal/focus owner 显示在 Thread/Task 模态之上，恢复焦点不滚动正文。

多选沿用唯一的内存 selection store，跨 Room/DM/Thread 切换所有权。黄色操作条按
已选数量、全选、取消、复制 Markdown、生成图片排序；移动布局省略图片。选中圆圈
黄底黑勾，消息 20% 粉底。图片为本地 PNG 预览，仅复制和下载，不提供转发或外部分享。
未解析的选中消息禁止生成图片；失败可重试，超尺寸明确报错，不截断成功。

选择属于发起选择的可见消息页面实例。桌面头像 inspector、消息列和审批覆盖层不清空
仍可见原页面的选择；切换大页、Room 任务/文件、移动全屏替换原页面时退出。
同一 Thread 在审批层与原消息列中同时渲染时不能互相认领或清空选择。
工具栏按实际容器宽度从右向左隐藏文字：图片、Markdown、取消、全选；不换行。
当前 Raft 发布包全选使用 list-checks，文字态和紧凑态均保留图标。按钮保持白底，
28px 高、12px 字号、2px 边框；hover 上移 1px、阴影 2px 增至 4px，按下整体
位移 1px并保留 4px 阴影，100ms。按下不消除右下方的粗阴影。
桌面按钮间距 6px；PWA 为用户要求的 8px（Raft 网页原值 4px），在 4px 阴影之外
保留 4px 净空，外侧 padding 8px。逐项收起文字须测量此实际 gap，不能缩回间距。
菜单边框 2px、硬阴影 4px；角落表情按钮仅为图标布局，不能由隐藏文本占据额外网格行。
参数及回归见 [菜单与选择条细化](../audits/2026-09-15-message-selection-refinement.zh-CN.md)。
当前源码、手机条目节距、首页地址及可局部选择文本页见
[首页与复制文本细化](../audits/2026-09-15-sidebar-copy-home-refinement.zh-CN.md)。
PWA 复制文本页使用浅黄底黑框的只读内容区：通过 contenteditable 提供原生光标，
拦截输入、粘贴、剪切和拖入写操作；不自动全选、不把主消息页的禁选规则带入。
正文大小沿用同一 msg-body，默认 14px，用户大小档 12/14/16px。
场景条件与保留差异见 [消息菜单矩阵](../audits/2026-09-15-message-menu-matrix.zh-CN.md)。

PWA 紧凑 Task 审批状态和负责人共一组，负责人省略超长文字；创建人按可用宽度换行。
来源与测试见 [消息长按和导出](../audits/2026-09-15-message-touch-selection-export.zh-CN.md)。
