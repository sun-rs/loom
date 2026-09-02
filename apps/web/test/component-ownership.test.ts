import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const sourceDirectory = join(import.meta.dirname, "..", "src");

test("WorkspaceScreen composes owner components without owning their DOM", () => {
  const app = readFileSync(join(sourceDirectory, "App.tsx"), "utf8");
  const dialogs = readFileSync(
    join(sourceDirectory, "components", "room-dialogs.tsx"),
    "utf8",
  );
  const agentDialogs = readFileSync(
    join(sourceDirectory, "components", "agent-dialogs.tsx"),
    "utf8",
  );
  const catalog = readFileSync(
    join(sourceDirectory, "components", "workspace-catalog-panes.tsx"),
    "utf8",
  );
  const agentSurface = readFileSync(
    join(sourceDirectory, "components", "agent-directory-pane.tsx"),
    "utf8",
  );
  const navigation = readFileSync(
    join(sourceDirectory, "components", "workspace-navigation.tsx"),
    "utf8",
  );
  const roomSidebarResizer = readFileSync(
    join(sourceDirectory, "components", "room-sidebar-resizer.tsx"),
    "utf8",
  );
  const managedMcpSettings = readFileSync(
    join(sourceDirectory, "components", "managed-mcp-settings.tsx"),
    "utf8",
  );
  const settings = readFileSync(
    join(sourceDirectory, "components", "settings-surface.tsx"),
    "utf8",
  );
  const conversation = readFileSync(
    join(sourceDirectory, "components", "conversation-panes.tsx"),
    "utf8",
  );
  const taskToolbar = readFileSync(
    join(sourceDirectory, "components", "task-toolbar.tsx"),
    "utf8",
  );
  const discoveryFilter = readFileSync(
    join(sourceDirectory, "components", "discovery-filter.tsx"),
    "utf8",
  );
  const messageTimeline = readFileSync(
    join(sourceDirectory, "components", "message-timeline.tsx"),
    "utf8",
  );
  const main = readFileSync(join(sourceDirectory, "main.tsx"), "utf8");
  const dialogProtocol = readFileSync(
    join(sourceDirectory, "dialog-protocol.ts"),
    "utf8",
  );
  const productCss = readFileSync(join(sourceDirectory, "product.css"), "utf8");

  assert.doesNotMatch(app, /function RoomCreateDialog/u);
  assert.match(
    app,
    /activeThreadId === undefined\s*\? \[\]/u,
    "an uncreated thread must not reuse root-message context just because both IDs are undefined",
  );
  assert.doesNotMatch(app, /function RoomMembersDialog/u);
  assert.doesNotMatch(app, /function AgentCreateDialog/u);
  assert.doesNotMatch(app, /function AgentDirectoryPane/u);
  assert.doesNotMatch(app, /function ComputerRuntimePane/u);
  assert.doesNotMatch(app, /function RoomSidebar/u);
  assert.doesNotMatch(app, /function ChatPane/u);
  assert.doesNotMatch(app, /function TaskPane/u);
  assert.match(app, /from "\.\/components\/room-dialogs\.tsx"/u);
  assert.match(app, /from "\.\/components\/agent-dialogs\.tsx"/u);
  assert.match(app, /client\.request\("agent\.provision"/u);
  assert.match(app, /client\.request\("room\.direct\.open"/u);
  assert.match(app, /from "\.\/components\/workspace-catalog-panes\.tsx"/u);
  assert.match(app, /from "\.\/components\/workspace-navigation\.tsx"/u);
  assert.match(app, /from "\.\/components\/room-sidebar-resizer\.tsx"/u);
  assert.match(app, /--rah-room-sidebar-width/u);
  assert.match(app, /from "\.\/components\/settings-surface\.tsx"/u);
  assert.match(app, /from "\.\/components\/conversation-panes\.tsx"/u);

  assert.match(dialogs, /className="rah-dialog rah-room-create-dialog"/u);
  assert.match(dialogs, /这个频道是做什么的/u);
  assert.match(dialogs, /role="radio"/u);
  assert.match(dialogs, /按名称搜索成员/u);
  assert.doesNotMatch(dialogs, />Slug</u);
  assert.match(dialogs, /className="rah-channel-settings-drawer"/u);
  assert.match(dialogs, /<div className="rah-channel-settings-info">/u);
  assert.match(
    dialogs,
    /<div className="rah-channel-settings-info">[\s\S]*?<section className="rah-channel-settings-preferences">[\s\S]*?<section className="rah-channel-settings-access">[\s\S]*?<\/section>\s*<\/div>/u,
    "Raft keeps information, preferences, and access controls in one padded drawer body",
  );
  assert.match(
    dialogs,
    /<div className="rah-channel-settings-field">\s*<label htmlFor="rah-channel-name">\s*名称 <em>\*<\/em>/u,
  );
  assert.match(dialogs, /id="rah-channel-name"/u);
  assert.match(dialogs, /id="rah-channel-description"/u);
  assert.match(dialogs, /rah-channel-settings-description-field/u);
  assert.match(
    dialogs,
    /<span className="rah-channel-settings-optional">可选<\/span>/u,
  );
  assert.match(dialogs, />频道详情与设置</u);
  assert.match(dialogs, />偏好</u);
  assert.match(dialogs, /onUpdate/u);
  assert.match(dialogs, /useDialogProtocol/u);
  assert.match(dialogs, /initialFocus: "container"/u);
  assert.match(
    dialogs,
    /<button\s+aria-label="管理成员"[\s\S]*?onClick=\{\(\) => setView\("members"\)\}[\s\S]*?<span>成员<\/span>[\s\S]*?<span>[\s\S]*?位人类/u,
    "the entire Raft member summary row must be the disclosure target",
  );
  assert.match(dialogProtocol, /initialFocus\?: "container" \| "first"/u);
  assert.match(
    dialogProtocol,
    /initialFocusRef\.current === "container"[\s\S]*?dialogRef\.current\?\.focus\(\)/u,
    "drawers focus their container while ordinary dialogs may focus the first field",
  );
  assert.match(dialogs, /mutationPendingRef\.current/u);
  assert.match(
    dialogs,
    /aria-label="关闭频道设置"/u,
    "a full-width mobile settings drawer needs a visible pointer-close action",
  );
  assert.match(
    navigation,
    /className="sq-btn members"[\s\S]*?aria-label="频道详情与设置"/u,
    "Room settings retains the mobile-visible members action, not a desktop-only button",
  );
  assert.match(dialogs, /disabled=\{!canAdd \|\| mutationBlocked\}/u);
  assert.match(dialogs, /mutationPendingRef\.current \|\| !canRemove/u);
  assert.match(dialogs, /key=\{view\}[\s\S]*?onAddSelection=\{addSelection\}/u);
  assert.match(main, /@rah-os\/ui-tokens\/overlays\.css/u);
  assert.match(productCss, /width: var\(--raft-drawer-width\)/u);
  assert.match(productCss, /background: var\(--raft-drawer-background\)/u);
  assert.match(productCss, /box-shadow: var\(--raft-drawer-shadow\)/u);
  assert.match(
    productCss,
    /height: 54px;\s+min-height: 54px;/u,
    "the settings drawer title matches the measured Raft 54px header",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-drawer:focus \{\s+outline: none;/u,
    "programmatic drawer focus must not draw the browser's blue default ring",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-info \{\s+border-top: 1px solid var\(--ink-10\);\s+padding: 12px 16px 16px;/u,
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-scroll \{[\s\S]*?scrollbar-width: auto;/u,
    "the channel settings drawer must reserve the same 15px desktop scrollbar gutter as live Raft",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-scroll::-webkit-scrollbar \{\s+width: 15px;/u,
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-info footer \.btn \{[\s\S]*?height: 28px;[\s\S]*?font: 700 12px\/12px var\(--sans\);/u,
    "channel settings actions must use Raft's compact drawer button protocol",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-optional \{[\s\S]*?margin-left: 4px;/u,
    "Raft's optional field suffix is a normal inline span with an exact 4px gap",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-field > label \{[\s\S]*?font-size: 14px;[\s\S]*?margin-bottom: 4px;/u,
    "each Raft field uses a block wrapper with a separate native label",
  );
  assert.match(
    productCss,
    /\.rah-channel-settings-description-field \{\s+min-height: 98\.5px;/u,
    "the description field must match Raft's measured baseline without fixing its resize height",
  );
  assert.match(agentDialogs, /useDialogProtocol/u);
  assert.match(agentDialogs, />创建 AGENT</u);
  assert.match(agentDialogs, /计算机 <em>/u);
  assert.match(agentDialogs, /showMore/u);
  assert.match(agentDialogs, /showAdvanced/u);
  assert.match(agentDialogs, /通用 Agent/u);
  assert.match(agentDialogs, /runtimeOfferId/u);
  assert.match(agentDialogs, /instructions/u);
  assert.match(
    agentDialogs,
    /const effectiveInstructions =[\s\S]*?instructions\.trim\(\)[\s\S]*?revision\.role\.trim\(\)/u,
    "managing a legacy Agent without explicit instructions must remain writable",
  );
  assert.doesNotMatch(agentDialogs, /工具与文件权限/u);
  assert.doesNotMatch(agentDialogs, /setToolAccessMode/u);
  assert.doesNotMatch(agentDialogs, /Session 策略/u);
  assert.doesNotMatch(agentDialogs, /setSessionPolicy/u);
  assert.doesNotMatch(agentSurface, /policy\.toolAccessMode/u);
  assert.match(agentSurface, /role="menu"/u);
  assert.match(agentSurface, /role="menuitem"/u);
  assert.match(agentSurface, /创建外部 Agent/u);
  assert.match(catalog, /className="rah-computer-directory"/u);
  assert.match(catalog, /className="rah-computer-sidebar"/u);
  assert.match(catalog, /className="rah-computer-detail"/u);
  assert.match(catalog, /选择一台计算机/u);
  assert.doesNotMatch(catalog, /选择一个频道/u);
  assert.match(catalog, /检测到的运行时/u);
  assert.doesNotMatch(catalog, /className="rah-runtime-grid rah-scroll-main"/u);
  assert.match(navigation, /className="rah-mobile-nav"/u);
  assert.match(navigation, /label="设置"/u);
  assert.match(navigation, /kind === "direct"/u);
  assert.match(navigation, /<SidebarSection\s+label=\{label\}/u);
  assert.match(roomSidebarResizer, /role="separator"/u);
  assert.match(roomSidebarResizer, /aria-orientation="vertical"/u);
  assert.match(roomSidebarResizer, /setPointerCapture/u);
  assert.match(roomSidebarResizer, /nextRoomSidebarWidth/u);
  assert.doesNotMatch(navigation, /disabled icon="gear"/u);
  assert.match(managedMcpSettings, /managedMcp\.executor\.list/u);
  assert.match(managedMcpSettings, /managedMcp\.executor\.discover/u);
  assert.match(managedMcpSettings, /managedMcp\.server\.create/u);
  assert.match(managedMcpSettings, /managedMcp\.server\.state/u);
  assert.match(managedMcpSettings, /managedMcp\.assignment\.create/u);
  assert.match(managedMcpSettings, /managedMcp\.assignment\.revise/u);
  assert.match(managedMcpSettings, /managedMcp\.assignment\.state/u);
  assert.match(managedMcpSettings, /runRoomMutationAtLatest/u);
  assert.match(settings, /ManagedMcpSettingsContent/u);
  assert.match(settings, /LanDeviceSettingsContent/u);
  assert.match(conversation, /className="composer"/u);
  assert.match(conversation, /加载更早消息/u);
  assert.match(conversation, /<MessageTimeline/u);
  assert.match(conversation, /preserveAnchorOnNextChange/u);
  assert.match(conversation, /data-message-id/u);
  assert.match(messageTimeline, /useVirtualizer/u);
  assert.match(messageTimeline, /directDomUpdates: true/u);
  assert.match(messageTimeline, /directDomUpdatesMode: "position"/u);
  assert.match(messageTimeline, /RAFT_MESSAGE_OVERSCAN = 6/u);
  assert.match(messageTimeline, /RAFT_MESSAGE_ANCHOR_SETTLE_MS = 1_200/u);
  assert.match(messageTimeline, /previousItemIndex/u);
  assert.match(messageTimeline, /data-message-timeline-total-count/u);
  assert.match(conversation, /className=\{`kanban/u);
  assert.match(conversation, /<TaskToolbar/u);
  assert.match(taskToolbar, /label="创建者"/u);
  assert.match(taskToolbar, /label="负责人"/u);
  assert.match(taskToolbar, /"看板"/u);
  assert.match(taskToolbar, /"列表"/u);
  assert.match(taskToolbar, /role="radiogroup"/u);
  assert.match(taskToolbar, /<DiscoveryFilter/u);
  assert.match(discoveryFilter, /role="menu"/u);
  assert.match(discoveryFilter, /createPortal/u);
  assert.doesNotMatch(conversation, /RoomAgentDeliverySummary/u);
  assert.doesNotMatch(
    conversation,
    /RoomAgentActivity|agentActivity|rah-agent-activity|aria-live="polite"/u,
    "Room Chat must not render Agent execution diagnostics in its Message stream",
  );
  assert.match(agentSurface, /RuntimeTrajectoryRecord/u);
  assert.match(agentSurface, /agent\.trajectory\.list/u);
  assert.doesNotMatch(agentSurface, /agent\.activity\.list/u);
  assert.doesNotMatch(agentSurface, /RoomAgentActivity/u);
  assert.match(
    agentSurface,
    /className="rah-agent-activity-pane rah-scroll-main"/u,
  );
  assert.match(agentSurface, />活动诊断</u);
  assert.match(agentSurface, /navigator\.clipboard\.writeText/u);
  assert.match(agentSurface, /renderAgentActivityDiagnostics/u);
  assert.match(
    agentSurface,
    /import \{ activityPresentation \} from "\.\.\/identity-presentation\.ts"/u,
  );
  assert.match(agentSurface, /activityPresentation\(activity\.entry\)/u);
  assert.match(agentSurface, /managedMcp\.usage\.list/u);
  assert.match(agentSurface, /MCP 使用记录/u);
  assert.match(agentSurface, /调用参数、凭据与结果正文不会进入此浏览器投影/u);
  assert.match(agentSurface, /aria-live="polite"/u);
  assert.match(agentSurface, /const RAFT_AGENT_TABS/u);
  const agentTabLabels = [
    "动态",
    "资料",
    "聊天",
    "提醒",
    "工作区",
    "应用",
    "MCP",
  ];
  let previousTabIndex = -1;
  for (const label of agentTabLabels) {
    const index = agentSurface.indexOf(`label: "${label}"`);
    assert.ok(
      index > previousTabIndex,
      `${label} must follow the Raft tab order`,
    );
    previousTabIndex = index;
  }
  assert.match(agentSurface, /className="rah-agent-sidebar-head"/u);
  assert.match(agentSurface, /rah-agent-sidebar-resizer/u);
  assert.match(agentSurface, /const MIN_SIDEBAR_WIDTH = 180/u);
  assert.match(agentSurface, /const MAX_SIDEBAR_WIDTH = 400/u);
  assert.match(agentSurface, /const DEFAULT_SIDEBAR_WIDTH = 240/u);
  assert.match(agentSurface, /reconcileAgentRouteIdentity/u);
  assert.match(agentSurface, /agents\.map\(\(\{ agentDefinitionId \}\)/u);
  assert.match(agentSurface, /选择一个 Agent/u);
  assert.doesNotMatch(agentSurface, /选择一个频道/u);
  assert.match(agentSurface, /rah-agent-mobile-back/u);
  assert.match(agentSurface, /function AgentAvatar/u);
  assert.match(agentSurface, /agent\.avatarKey/u);
  assert.match(agentSurface, /agent\.get/u);
  assert.match(agentSurface, /agent\.room\.list/u);
  assert.match(agentSurface, /onOpenDirectRoom/u);
  assert.match(agentSurface, /发消息/u);
  assert.match(agentSurface, /function AgentChatPane/u);
  assert.match(agentSurface, />活动诊断</u);
  assert.doesNotMatch(
    agentSurface,
    /Agent 可访问频道与私信目录尚未形成 typed read model/u,
  );
  assert.match(agentSurface, /currentHuman/u);
  assert.doesNotMatch(
    app,
    /activities=\{roomData\?\.agentActivity/u,
    "the Agent timeline must not be assembled from the selected Room snapshot",
  );
  assert.doesNotMatch(
    conversation,
    /开始 Thread/u,
    "a reply-less Message must not render a permanent Thread prompt",
  );
  assert.match(
    conversation,
    /className="msg-actions"/u,
    "Thread creation belongs to the Raft-style Message hover toolbar",
  );
  assert.match(
    conversation,
    /messageAgent[\s\S]*?<MessageAgentAvatar agent=\{messageAgent\}/u,
    "Agent-authored Room messages must reuse the official Raft avatar pack",
  );
  assert.match(
    conversation,
    /thread !== undefined && thread\.replyCount > 0/u,
    "only Threads with replies may render a persistent channel summary",
  );
  assert.match(
    conversation,
    /className="tp-line"/u,
    "a persistent Thread summary includes recent reply author/body/time rows",
  );

  const openThreadStart = app.indexOf("const openThread");
  const threadSyncStart = app.indexOf("useEffect", openThreadStart);
  const submitThreadReplyStart = app.indexOf("const submitThreadReply");
  const completeTaskStart = app.indexOf(
    "const completeTask",
    submitThreadReplyStart,
  );
  assert.ok(openThreadStart >= 0 && threadSyncStart > openThreadStart);
  assert.ok(
    submitThreadReplyStart > threadSyncStart &&
      completeTaskStart > submitThreadReplyStart,
  );
  assert.doesNotMatch(
    app.slice(openThreadStart, threadSyncStart),
    /client\.request\("thread\.create"/u,
    "opening an empty Message Thread must be read-only",
  );
  assert.match(
    app.slice(submitThreadReplyStart, completeTaskStart),
    /client\.request\("thread\.create"/u,
    "the first reply lazily creates the canonical Thread",
  );
  assert.match(
    app.slice(submitThreadReplyStart, completeTaskStart),
    /recipientIds: \[\]/u,
    "the structural Thread creation must not wake Agents before the reply",
  );
});
