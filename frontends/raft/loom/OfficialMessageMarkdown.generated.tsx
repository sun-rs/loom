// GENERATED from immutable Raft db5e399 declarations. Imports bind existing presentation and Loom callbacks; do not edit.
import Tooltip from "../packages/web/src/components/ui/Tooltip";
import {useCallback,useMemo,Children} from "react";
import type {ReactNode} from "react";
import type {IntlShape} from "react-intl";
import {Badge,MessageItemSearchMatch,MessageReferenceChip,MessageReferenceText,Spinner,TaskChip,TaskStatusIcon} from "raft-ui";
import type {Components} from "react-markdown";
import {createRaftBareTaskRefRegex,createRaftChannelRefRegex,createRaftChannelThreadRefRegex,createRaftDmRefRegex,createRaftDmThreadRefRegex,createRaftMalformedDmKindRefRegex,createRaftMessageRefRegex,createRaftStructuredUserRefRegex,createRaftUserRefRegex,formatRaftRefTarget,parseRaftPermalink,parseRaftRefTarget,resolveRaftMentionHandle} from "@botiverse/raft-shared";
import type {ExternalMessageAuthorProjection,RaftRefTarget} from "@botiverse/raft-shared";
import {toRuiTaskStatus} from "../packages/web/src/components/task/taskStatusUi";
import type {Channel} from "../packages/web/src/store/channelStore";
import type {Agent} from "../packages/web/src/store/agentStore";
import type {ServerMember} from "../packages/web/src/store/serverStore";
import type {ChannelExternalMember} from "../packages/web/src/hooks/useChannelMembers";
import type {Task} from "../packages/web/src/store/taskStore";
import {matchesUnavailableQuotedPermalink} from "../packages/web/src/components/message/quotedMessagePermalink";
import MentionLink from "../packages/web/src/components/message/MentionLink";
import {PermalinkReferenceChip} from "../packages/web/src/components/message/PermalinkReferenceChip";
import MarkdownContent,{MarkdownCode,MarkdownLink} from "../packages/web/src/components/markdown/MarkdownContent";
import {isCustomProtocolHref} from "../packages/web/src/components/markdown/CustomProtocolLink";
import {formatReminderReceiptTime,formatReminderReceiptTooltip} from "../packages/web/src/utils/reminderReceiptTime";
import type {TimeFormatOptions} from "../packages/web/src/utils/timeFormatting";
import type {ThreadRefIntent} from "../packages/web/src/utils/threadRefNavigation";
import {MESSAGE_MARKDOWN_REHYPE_PLUGINS,messageMarkdownRemarkPlugins} from "@loom/raft-web-source/messageMarkdownSecurity";
import {highlightThreadSearchInTree,normalizeThreadSearchQuery} from "./OfficialMarkdownSearch.generated";
import {messageTokenNode,plainTextOf,replaceLinksInTree,replaceTokensInTree} from "@loom/raft-web-source/remarkMessageTokens";
import type {TextTokenMatcher} from "@loom/raft-web-source/remarkMessageTokens";
import {repairGeneratedMarkdown,unwrapDmKindStrikethrough} from "@loom/raft-web-source/repairGeneratedMarkdown";
import type {Root as MdastRoot} from "mdast";
import type {VFile} from "vfile";
import {findDmByPeer} from "../packages/web/src/utils/refTarget";
function useRenderMessageMarkdown(
  content: string,
  channels: Channel[],
  mentionMap: Map<string, MentionEntry>,
  structuredMentionMap: Map<string, MentionEntry>,
  onNavigateChannel: (channel: Channel) => void,
  onNavigateDm: (channel: Channel) => void,
  onNavigateAgent: (agentId: string) => void,
  onNavigateHuman: (userId: string) => void,
  onNavigateExternal: ((profile: ExternalMessageAuthorProjection) => void) | undefined,
  onNavigateComputer: (machineId: string) => void,
  onOpenThread?: (intent: ThreadRefIntent) => void | Promise<void>,
  resolvingThreadRefKey?: string | null,
  onOpenTaskRef?: (taskNumber: number) => void,
  onOpenMessageRef?: (channel: Channel, messageId: string, threadParentShortId: string | null) => void | Promise<void>,
  onOpenPermalink?: (href: string) => void,
  currentServerSlug?: string,
  refAuthorityServerSlug?: string,
  threadRefAuthorityUnavailable = false,
  knownTaskNumbers?: Set<number>,
  taskByNumber?: ReadonlyMap<number, Task>,
  timeFormatOptions: TimeFormatOptions = {},
  threadSearchHighlightQuery?: string,
  formatMessage?: IntlShape["formatMessage"],
  channelParticipantAgentsById?: ReadonlyMap<string, Agent>,
  channelParticipantMembersById?: ReadonlyMap<string, ServerMember>,
  channelParticipantExternalsById?: ReadonlyMap<string, ChannelExternalMember>,
  unavailableQuotedPermalinkUrl?: string | null,
  mentionsDisplayOnly = false,
) {
  // Inline task refs render rui's inline `TaskChip` when the referenced task is
  // loaded in the client store. The chip is designed for running text —
  // borderless and body-sized — so a mixed line (#mention-mix) keeps its
  // baseline; it reads the same `task-status-*` tokens as every other surface,
  // so the status colour still matches (task-status unification).
  // Unknown tasks keep a neutral badge so the chip never claims a status it
  // does not know.
  //
  // The inline badge shows the status icon + `#N` and deliberately NOT the
  // assignee: the badge sits inside the sender's sentence, and an `@name`
  // there reads as a mention the author never wrote (task #1252 — "等 #211
  // @peng 做完", where @peng came from the badge). The footer badge is not
  // inside a sentence and keeps the assignee; the task detail shows it too.
  //
  // No Tooltip wrapper here on purpose: the footer badge's tooltip mounts a
  // base-ui trigger with an auto-generated id, and the evidence contract in
  // tests/taskRefChannelScope.evidence.test.tsx requires the rendered ref
  // markup to be byte-identical across renders of the same number.
  const renderTaskBadge = useCallback((taskNumber: number) => {
    const task = taskByNumber?.get(taskNumber);
    if (!task) return null;
    return (
      <TaskChip
        variant="inline"
        status={toRuiTaskStatus(task.status)}
        data-status={task.status}
        data-testid="message-task-ref-badge"
        render={
          <a
            href="#"
            className="cursor-default"
            data-message-affordance="open-linked-task"
            onClick={(e) => {
              e.preventDefault();
              onOpenTaskRef?.(taskNumber);
            }}
          >
            <TaskStatusIcon status={toRuiTaskStatus(task.status)} />
            <span className="shrink-0">{taskNumberSigil(task.taskNumber)}</span>
          </a>
        }
      />
    );
  }, [taskByNumber, onOpenTaskRef]);
  // Task #762: every ref below is recognised on the parsed markdown tree
  // (remarkMessageTokens), so code, links and escapes are skipped by the
  // parser itself. Matchers run in this order; each sees only the text the
  // earlier ones left alone, which is the precedence the old placeholders
  // enforced (thread refs before mentions, `dm:@peer` before `@peer`).
  const messageRefsPlugin = useMemo(() => {
    const channelNameSet = new Set(channels.map((c) => c.name.toLowerCase()));
    const crossServerAuthority = !!refAuthorityServerSlug
      && !!currentServerSlug
      && refAuthorityServerSlug !== currentServerSlug;
    let mentionIdentityMap: Map<string, MentionEntry> | null = null;
    const resolveMentionByIdentity = (type: "agent" | "user" | "external", id: string) => {
      mentionIdentityMap ??= buildMentionIdentityMap(mentionMap);
      return mentionIdentityMap.get(`${type}:${id}`);
    };
    const plain = (text: string) => messageTokenNode("span", text);
    const raftRefAnchor = (target: RaftRefTarget, label: string) =>
      messageTokenNode("a", label, {
        dataRaftRefKind: target.kind,
        dataRaftRefTarget: formatRaftRefTarget(target),
      });
    const mentionAnchor = (name: string, entry: MentionEntry) => {
      const resolvedMention = resolveMentionByIdentity(entry.type, entry.id);
      const visibleLabel = resolvedMention?.displayName ? `@${resolvedMention.displayName}` : `@${name}`;
      return messageTokenNode("a", visibleLabel, {
        dataMention: name,
        dataMentionType: entry.type,
        dataMentionId: entry.id,
      });
    };

    const matchers: TextTokenMatcher[] = [
      // `<target>` refs. `\<target>` is the escape: it stays literal text and
      // no later matcher may claim part of it.
      {
        pattern: /<([^<>\n]+)>/g,
        replace: (match, { escaped }) => {
          const target = parseRaftRefTarget(match[1]);
          if (!target) return false;
          if (escaped) return plain(match[0]);
          return raftRefAnchor(target, formatRaftRefTarget(target));
        },
      },
      {
        pattern: createRaftMessageRefRegex(),
        replace: (match) => {
          const [, channelName, threadParentShortId, messageId] = match;
          const target = parseRaftRefTarget(
            threadParentShortId
              ? `#${channelName}:${threadParentShortId} msg=${messageId}`
              : `#${channelName} msg=${messageId}`,
          );
          return target ? raftRefAnchor(target, formatRaftRefTarget(target)) : false;
        },
      },
      // Thread refs MUST run before the mention matchers: `dm:@peer(:shortId)?`
      // contains `@peer`, and letting mentions claim it first breaks the ref
      // into `dm:` + mention chip (+ `:shortId`) — the production regression
      // where `dm:@artin:1f1def75` stopped being clickable.
      {
        pattern: createRaftChannelThreadRefRegex(),
        replace: (match) => {
          const [text, chanName, shortId] = match;
          if (threadRefAuthorityUnavailable) return plain(text);
          if (!channelNameSet.has(chanName.toLowerCase()) && !crossServerAuthority) return false;
          const chan = channels.find((c) => c.name.toLowerCase() === chanName.toLowerCase() && (c.type === "channel" || c.type === "private" || c.type === "joint"));
          return messageTokenNode("a", `#${chanName}:${shortId}`, {
            dataThreadRef: shortId,
            dataThreadParent: crossServerAuthority ? "" : chan?.id || "",
            dataThreadParentName: chanName,
          });
        },
      },
      {
        pattern: createRaftDmThreadRefRegex(),
        replace: (match) => {
          const [text, peerName, shortId] = match;
          if (threadRefAuthorityUnavailable) return plain(text);
          const dm = findDmByPeer(channels, peerName);
          // Unresolvable refs must read identically to the source — claim the
          // whole token as plain text instead of letting the mention matcher
          // chip `@peer` out of it.
          if (!dm && !crossServerAuthority) return plain(text);
          return messageTokenNode("a", `dm:@${peerName}:${shortId}`, {
            dataThreadRef: shortId,
            dataThreadParent: crossServerAuthority ? "" : dm?.id || "",
            dataThreadParentName: crossServerAuthority ? peerName : dm?.name || peerName,
            dataThreadParentType: "dm",
          });
        },
      },
      // Bare `dm:@peer` refs: claim the whole token (same preemption rule) and
      // render through the raft-ref anchor path, which navigates to the DM.
      {
        pattern: createRaftDmRefRegex(),
        replace: (match) => {
          const [text, peerName] = match;
          if (!findDmByPeer(channels, peerName)) return plain(text);
          return raftRefAnchor({ kind: "dm", peerName }, text);
        },
      },
      // `dm:@name~bot` (unknown peer kind) is not a ref: keep it plain text so
      // neither `dm:@name` nor the mention matcher turns it into another target.
      { pattern: createRaftMalformedDmKindRefRegex(), replace: (match) => plain(match[0]) },
      // A selected mention is an identity-backed entity, not a fresh username
      // guess. Keep it mentionable after left-boundary edits such as
      // `草案@Mona` and before CJK suffixes such as `@Mona的`; a Latin right
      // boundary still prevents a stale `@Mona` entity from claiming `@Monica`.
      ...[...structuredMentionMap].flatMap(([name, entry]): TextTokenMatcher[] => {
        const pattern = createRaftStructuredUserRefRegex(name);
        return pattern ? [{ pattern, replace: () => mentionAnchor(name, entry) }] : [];
      }),
      // Free text still uses the conservative grammar so emails/package-like
      // strings never become notifications merely because a directory name
      // happens to match.
      {
        pattern: createRaftUserRefRegex(),
        replace: (match) => {
          const [, prefix, token] = match;
          const resolved = resolveRaftMentionHandle(
            token,
            (name) => structuredMentionMap.has(name) || mentionMap.has(name),
          );
          if (!resolved) return false; // Not a known name — keep as plain text
          const entry = structuredMentionMap.get(resolved.handle) ?? mentionMap.get(resolved.handle);
          if (!entry) return false;
          return [
            { type: "text", value: prefix },
            mentionAnchor(resolved.handle, entry),
            { type: "text", value: resolved.suffix },
          ];
        },
      },
      // "task #205" always links; bare "#205" only if it's a known task.
      {
        pattern: createRaftBareTaskRefRegex(),
        replace: (match) => {
          const [, prefix, taskKeyword, taskNumber] = match;
          if (!taskKeyword && !knownTaskNumbers?.has(Number(taskNumber))) return false;
          return [
            { type: "text", value: `${prefix}${taskKeyword ?? ""}` },
            messageTokenNode("a", `#${taskNumber}`, { dataTaskRef: taskNumber }),
          ];
        },
      },
      // #channel refs: only a known channel becomes a link.
      {
        pattern: createRaftChannelRefRegex(),
        replace: (match) => {
          const [, name] = match;
          if (!channelNameSet.has(name.toLowerCase())) return false;
          return messageTokenNode("a", `#${name}`, { dataChannel: name });
        },
      },
    ];

    return () => (tree: MdastRoot, file: VFile) => {
      repairGeneratedMarkdown(tree, file);
      unwrapDmKindStrikethrough(tree, file);
      replaceLinksInTree(tree, (link) => {
        // `[label](<target>)` and `<dm:@peer>`: the parser made these links,
        // and only the angle-bracket forms are refs (`[x](#general)` is not).
        const source = file.value ? String(file.value).slice(link.position?.start.offset ?? 0, link.position?.end.offset ?? 0) : "";
        const isLabelled = /\]\(<[^<>\n]+>\)$/.test(source);
        const isAutolink = source === `<${link.url}>`;
        if (!isLabelled && !isAutolink) return null;
        const target = parseRaftRefTarget(link.url);
        if (!target) return null;
        return raftRefAnchor(target, isLabelled ? plainTextOf(link) : formatRaftRefTarget(target));
      });
      replaceTokensInTree(tree, matchers, file);
      highlightThreadSearchInTree(tree, threadSearchHighlightQuery ?? "");
    };
  }, [
    channels, mentionMap, structuredMentionMap, knownTaskNumbers, threadRefAuthorityUnavailable,
    refAuthorityServerSlug, currentServerSlug, threadSearchHighlightQuery,
  ]);
  const remarkPlugins = useMemo(
    () => messageMarkdownRemarkPlugins(messageRefsPlugin),
    [messageRefsPlugin],
  );

  // Chat body shares its visual styling (code blocks, lists, headings, table,
  // etc.) with attachment preview via BASE_MARKDOWN_COMPONENTS in
  // MarkdownContent. We override only the elements that need chat-specific
  // behavior — `a` (mentions / channel refs / task refs / thread refs /
  // raft permalinks) and `span` (reminder receipts).
  // stdrc 2026-05-08 #proj-uiux:6110c1ce (task #137).
  const markdownComponents = useMemo(() => ({
    code: ({ children, className }) => (
      <MarkdownCode className={className}>
        {className
          ? children
          : highlightThreadSearchInlineCode(children, threadSearchHighlightQuery)}
      </MarkdownCode>
    ),
    // Links — handle @mention, #channel, and regular URLs
    a: ({ href, children, node }) => {
          const raftRefTarget = getRaftRefProp(node, "dataRaftRefTarget");
          if (raftRefTarget) {
            const target = parseRaftRefTarget(raftRefTarget);
            if (!target) return <span>{children}</span>;

            if (target.kind === "user") {
              const entry = structuredMentionMap.get(target.name) ?? mentionMap.get(target.name);
              if (!entry) return <span>{children}</span>;
              if (mentionsDisplayOnly) return renderDisplayOnlyMention(children);
              return (
                <MentionLink
                  mentionType={entry.type}
                  mentionId={entry.id}
                  fallbackLabel={target.name}
                  fallbackAgent={entry.type === "agent" ? channelParticipantAgentsById?.get(entry.id) : undefined}
                  fallbackMember={entry.type === "user" ? channelParticipantMembersById?.get(entry.id) : undefined}
                  fallbackExternal={entry.type === "external" ? channelParticipantExternalsById?.get(entry.id) : undefined}
                  onNavigateAgent={onNavigateAgent}
                  onNavigateHuman={onNavigateHuman}
                  onNavigateExternal={onNavigateExternal}
                >
                  {children}
                </MentionLink>
              );
            }

            if (target.kind === "computer") {
              return (
                <MessageReferenceChip
                  variant="link"
                  className="cursor-default"
                  render={
                    <a data-testid={`computer-reference-${target.machineId}`}
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigateComputer(target.machineId);
                      }}>
                      {children}
                    </a>
                  }
                />
              );
            }

            if (target.kind === "app") {
              return (
                <Tooltip content={formatMessage?.({ id: "message.messageItem.appReferenceOnly" })}>
                <MessageReferenceText
                  variant="primary"
                                    render={
                    <span data-testid={`app-reference-${target.appId}`} />}>
                  {children}
                </MessageReferenceText>
                </Tooltip>
              );
            }

            if (target.kind === "channel" || target.kind === "channel-thread" || target.kind === "message") {
              const crossServerAuthority = !!refAuthorityServerSlug
                && !!currentServerSlug
                && refAuthorityServerSlug !== currentServerSlug;
              const channel = channels.find(
                (entry) =>
                  entry.name.toLowerCase() === target.channelName.toLowerCase() &&
                  (entry.type === "channel" || entry.type === "private" || entry.type === "joint"),
              );
              const crossServerThreadTarget = crossServerAuthority
                && (target.kind === "channel-thread" || (target.kind === "message" && !!target.threadParentShortId));
              if (!channel && !crossServerThreadTarget) return <span>{children}</span>;

              if (target.kind === "channel") {
                if (!channel) return <span>{children}</span>;
                return (
                  <MessageReferenceChip
                    variant="accent"
                    className="cursor-default"
                    render={
                      <a href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigateChannel(channel);
                        }}>
                        {children}
                      </a>
                    }
                  />
                );
              }

              if (target.kind === "channel-thread") {
                if (threadRefAuthorityUnavailable) return <span>{children}</span>;
                if (!onOpenThread) return <span>{children}</span>;
                const routeServerSlug = refAuthorityServerSlug ?? currentServerSlug;
                if (!routeServerSlug) return <span>{children}</span>;
                const parentChannelId = crossServerAuthority ? null : channel?.id ?? null;
                const threadRefKey = `${routeServerSlug}:${target.channelName.toLowerCase()}:${target.threadShortId.toLowerCase()}`;
                const isResolvingThreadRef = resolvingThreadRefKey === threadRefKey;
                return (
                  <MessageReferenceChip
                    variant="link"
                    className={`${isResolvingThreadRef ? "cursor-wait opacity-80" : "cursor-default"}`}
                    render={
                      <a href="#"
                        aria-busy={isResolvingThreadRef}
                        onClick={(e) => {
                          e.preventDefault();
                          if (isResolvingThreadRef) return;
                          void onOpenThread({
                            serverSlug: routeServerSlug,
                            parentChannelName: target.channelName,
                            parentChannelId,
                            shortId: target.threadShortId,
                          });
                        }}>
                        <span>{children}</span>
                        {isResolvingThreadRef ? (
                          <Spinner size="xs" className="ml-1 align-[-1px]" aria-label={formatMessage?.({ id: "common.loadingLabel" })} />
                        ) : null}
                      </a>
                    }
                  />
                );
              }

              if (target.threadParentShortId && onOpenThread) {
                if (threadRefAuthorityUnavailable) return <span>{children}</span>;
                const routeServerSlug = refAuthorityServerSlug ?? currentServerSlug;
                if (!routeServerSlug) return <span>{children}</span>;
                return (
                  <MessageReferenceText
                    variant="primary"
                    className="cursor-default"
                    render={
                      <a href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          void onOpenThread({
                            serverSlug: routeServerSlug,
                            parentChannelName: target.channelName,
                            parentChannelId: crossServerAuthority ? null : channel?.id ?? null,
                            shortId: target.threadParentShortId!,
                            focusedMessageId: target.messageId,
                          });
                        }}>
                        {children}
                      </a>
                    }
                  />
                );
              }

              if (!onOpenMessageRef) return <span>{children}</span>;
              if (!channel) return <span>{children}</span>;
              return (
                <MessageReferenceText
                  variant="primary"
                  className="cursor-default"
                  render={
                    <a href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        void onOpenMessageRef?.(channel, target.messageId, target.threadParentShortId);
                      }}>
                      {children}
                    </a>
                  }
                />
              );
            }

            if (target.kind === "dm" || target.kind === "dm-thread") {
              const crossServerAuthority = !!refAuthorityServerSlug
                && !!currentServerSlug
                && refAuthorityServerSlug !== currentServerSlug;
              const dm = findDmByPeer(channels, target.peerName);
              if (!dm && !(crossServerAuthority && target.kind === "dm-thread")) return <span>{children}</span>;
              if (target.kind === "dm") {
                if (!dm) return <span>{children}</span>;
                return (
                  <MessageReferenceChip
                    variant="accent"
                    className="cursor-default"
                    render={
                      <a href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigateDm(dm);
                        }}>
                        {children}
                      </a>
                    }
                  />
                );
              }
              if (!onOpenThread) return <span>{children}</span>;
              if (threadRefAuthorityUnavailable) return <span>{children}</span>;
              const routeServerSlug = refAuthorityServerSlug ?? currentServerSlug;
              if (!routeServerSlug) return <span>{children}</span>;
              return (
                <MessageReferenceChip
                  variant="link"
                  className="cursor-default"
                  render={
                    <a href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        void onOpenThread({
                          serverSlug: routeServerSlug,
                          parentChannelName: crossServerAuthority ? target.peerName : dm!.name,
                          parentChannelType: "dm",
                          parentChannelId: crossServerAuthority ? null : dm!.id,
                          shortId: target.threadShortId,
                        });
                      }}>
                      {children}
                    </a>
                  }
                />
              );
            }

            if (target.kind === "task" && onOpenTaskRef) {
              const taskBadge = renderTaskBadge(target.taskNumber);
              if (taskBadge) return taskBadge;
              return (
                <a
                  href="#"
                  className="cursor-default"
                  data-message-affordance="open-linked-task"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenTaskRef(target.taskNumber);
                  }}>
                  <Badge variant="muted">{children}</Badge>
                </a>
              );
            }

            return <span>{children}</span>;
          }

          // @mention → clickable, navigates to agent or human detail
          const mentionName = node?.properties?.dataMention as string | undefined;
          if (mentionName) {
            const mentionType = node?.properties?.dataMentionType as string | undefined;
            const mentionId = node?.properties?.dataMentionId as string | undefined;

            if (mentionsDisplayOnly) return renderDisplayOnlyMention(children);
            if (!mentionId || (mentionType !== "agent" && mentionType !== "user" && mentionType !== "external")) {
              return (
                <span className="font-bold text-foreground underline decoration-foreground-hint decoration-[1.5px] underline-offset-[3px] select-text">
                  {children}
                </span>
              );
            }

            return (
              <MentionLink
                mentionType={mentionType}
                mentionId={mentionId}
                fallbackLabel={mentionName}
                fallbackAgent={mentionType === "agent" ? channelParticipantAgentsById?.get(mentionId) : undefined}
                fallbackMember={mentionType === "user" ? channelParticipantMembersById?.get(mentionId) : undefined}
                fallbackExternal={mentionType === "external" ? channelParticipantExternalsById?.get(mentionId) : undefined}
                onNavigateAgent={onNavigateAgent}
                onNavigateHuman={onNavigateHuman}
                onNavigateExternal={onNavigateExternal}
              >
                {children}
              </MentionLink>
            );
          }
          // Thread reference → clickable, opens thread panel
          const threadRef = node?.properties?.dataThreadRef as string | undefined;
          if (threadRef && onOpenThread) {
            if (threadRefAuthorityUnavailable) return <span>{children}</span>;
            const parentId = node?.properties?.dataThreadParent as string | undefined;
            const parentName = node?.properties?.dataThreadParentName as string | undefined;
            const parentType = node?.properties?.dataThreadParentType === "dm" ? "dm" : "channel";
            const routeServerSlug = refAuthorityServerSlug ?? currentServerSlug;
            const crossServerAuthority = !!refAuthorityServerSlug
              && !!currentServerSlug
              && refAuthorityServerSlug !== currentServerSlug;
            if (!routeServerSlug || !parentName || (!parentId && !crossServerAuthority)) {
              return (
                <MessageReferenceChip
                  variant="link"
                  className="opacity-60"
                  render={
                    <span />}>
                  {children}
                </MessageReferenceChip>
              );
            }
            const threadRefKey = `${routeServerSlug}:${parentName.toLowerCase()}:${threadRef.toLowerCase()}`;
            const isResolvingThreadRef = resolvingThreadRefKey === threadRefKey;
            return (
              <MessageReferenceChip
                variant="link"
                className={`${isResolvingThreadRef ? "cursor-wait opacity-80" : "cursor-default"}`}
                render={
                  <a href="#"
                    aria-busy={isResolvingThreadRef}
                    onClick={(e) => {
                      e.preventDefault();
                      if (isResolvingThreadRef) return;
                      void onOpenThread({
                        serverSlug: routeServerSlug,
                        parentChannelName: parentName,
                        parentChannelType: parentType,
                        parentChannelId: crossServerAuthority ? null : parentId,
                        shortId: threadRef,
                      });
                    }}>
                    <span>{children}</span>
                    {isResolvingThreadRef ? (
                      <Spinner size="xs" className="ml-1 align-[-1px]" aria-label={formatMessage?.({ id: "common.loadingLabel" })} />
                    ) : null}
                  </a>
                }
              />
            );
          }
          // #channel → clickable, navigates to channel
          const channelName = node?.properties?.dataChannel as string | undefined;
          if (channelName) {
            const channel = channels.find(
              (c) => c.name.toLowerCase() === channelName.toLowerCase() && (c.type === "channel" || c.type === "private" || c.type === "joint")
            );
            if (!channel) {
              return (
                <MessageReferenceChip
                  variant="accent"
                  className="opacity-60"
                  render={
                    <span />}>
                  {children}
                </MessageReferenceChip>
              );
            }
            return (
              <MessageReferenceChip
                variant="accent"
                className="cursor-default"
                render={
                  <a href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigateChannel(channel);
                    }}>
                    {children}
                  </a>
                }
              />
            );
          }
          // #205 → clickable, resolves a task in the current channel context.
          // Task refs reuse the message-side task badge (task #662); unknown
          // tasks keep a neutral badge that claims no status color.
          const taskRef = node?.properties?.dataTaskRef as string | undefined;
          if (taskRef && onOpenTaskRef) {
            const taskNumber = Number(taskRef);
            if (!Number.isInteger(taskNumber) || taskNumber <= 0) {
              return (
                <span className="opacity-60">
                  <Badge variant="muted">{children}</Badge>
                </span>
              );
            }
            const taskBadge = renderTaskBadge(taskNumber);
            if (taskBadge) return taskBadge;
            return (
              <a
                href="#"
                className="cursor-default"
                data-message-affordance="open-linked-task"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenTaskRef(taskNumber);
                }}>
                <Badge variant="muted">{children}</Badge>
              </a>
            );
          }
          const raftPermalink = href
            ? parseRaftPermalink(
                href,
                typeof window !== "undefined" ? window.location.hostname : undefined
              )
            : null;
          if (href && raftPermalink) {
            const quotedMessageUnavailable = matchesUnavailableQuotedPermalink(
              href,
              unavailableQuotedPermalinkUrl,
              typeof window !== "undefined" ? window.location.hostname : undefined,
            );
            const channel = channels.find((entry) => entry.id === raftPermalink.channelId);
            const channelLabel = quotedMessageUnavailable
              ? (formatMessage
                ? formatMessage({ id: "message.messageItem.unavailableLinkedMessage" })
                : "Unavailable linked message")
              : channel
              ? channel.type === "dm"
                ? `@${channel.peerDisplayName || channel.peerName || channel.name}`
                : `#${channel.name}`
              : (formatMessage
                ? formatMessage({ id: "message.messageItem.linkedMessageFallback" })
                : "linked message");
            return (
              <PermalinkReferenceChip
                href={href}
                quotedMessageUnavailable={quotedMessageUnavailable}
                channelLabel={channelLabel}
                onOpenPermalink={onOpenPermalink}
              />
            );
          }
          // Custom-protocol links (obsidian:// and friends, per the sanitize
          // href allowlist) delegate to the canonical MarkdownLink, which
          // confirms before handing off to the OS (task #734).
          if (isCustomProtocolHref(href)) {
            return <MarkdownLink href={href}>{children}</MarkdownLink>;
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground-link underline decoration-2 underline-offset-2 hover:decoration-attention select-text"
            >
              {children}
            </a>
          );
        },
        // Reminder-receipt span: when ReactMarkdown sees `<span data-reminder-fire-at="...">...</span>`
        // (rehypeRaw + sanitize lets that data attribute through), re-render
        // with a humanized fire time + tooltip. Other `<span>`s pass through
        // unchanged.
        span: ({ children, node, ...props }) => {
          const reminderFireAt = (node?.properties?.dataReminderFireAt
            || node?.properties?.["data-reminder-fire-at"]) as string | undefined;
          if (reminderFireAt) {
            return (
              <Tooltip content={formatReminderReceiptTooltip(reminderFireAt, timeFormatOptions)}>
              <span
                {...props}
              >
                {formatMessage
                  ? formatReminderReceiptTime(reminderFireAt, formatMessage, new Date(), timeFormatOptions)
                  : reminderFireAt}
              </span>
              </Tooltip>
            );
          }
          return <span {...props}>{children}</span>;
        },
        mark: ({ children }) => (
          <ThreadSearchFragmentHighlight>{children}</ThreadSearchFragmentHighlight>
        ),
      } as Components), [
      threadSearchHighlightQuery, structuredMentionMap, mentionMap,
      channelParticipantAgentsById, channelParticipantMembersById, channelParticipantExternalsById,
      onNavigateAgent, onNavigateHuman, onNavigateExternal, onNavigateComputer, onNavigateChannel,
      onNavigateDm, onOpenThread, onOpenMessageRef, onOpenTaskRef, onOpenPermalink,
      formatMessage, channels, refAuthorityServerSlug, currentServerSlug,
      threadRefAuthorityUnavailable, resolvingThreadRefKey, renderTaskBadge,
      timeFormatOptions, unavailableQuotedPermalinkUrl, mentionsDisplayOnly,
    ]);
  return (
    <MarkdownContent
      source={content}
      density="compact"
      enableMermaid
      remarkPlugins={remarkPlugins}
      rehypePlugins={MESSAGE_MARKDOWN_REHYPE_PLUGINS}
      components={markdownComponents}
    />
  );
}

export interface MentionEntry {
  displayName: string;
  /** `external` = linked provider member — never linkable, renders as text. */
  type: "agent" | "user" | "external";
  id: string;
  agent?: Agent;
}

function taskNumberSigil(taskNumber: number): string {
  return `#${taskNumber}`;
}

function buildMentionIdentityMap(mentionMap: Map<string, MentionEntry>): Map<string, MentionEntry> {
  const cached = mentionIdentityMapCache.get(mentionMap);
  if (cached) return cached;
  const map = new Map<string, MentionEntry>();
  for (const entry of mentionMap.values()) {
    map.set(`${entry.type}:${entry.id}`, entry);
  }
  mentionIdentityMapCache.set(mentionMap, map);
  return map;
}

function highlightThreadSearchInlineCode(
  children: ReactNode,
  query: string | undefined,
): ReactNode {
  const normalizedQuery = normalizeThreadSearchQuery(query ?? "");
  if (!normalizedQuery) return children;

  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;

    const lowerText = child.toLocaleLowerCase();
    const fragments: ReactNode[] = [];
    let cursor = 0;
    let matchIndex = lowerText.indexOf(normalizedQuery);
    while (matchIndex !== -1) {
      fragments.push(child.slice(cursor, matchIndex));
      const matchEnd = matchIndex + normalizedQuery.length;
      fragments.push(
        <ThreadSearchFragmentHighlight key={`${matchIndex}:${matchEnd}`}>
          {child.slice(matchIndex, matchEnd)}
        </ThreadSearchFragmentHighlight>,
      );
      cursor = matchEnd;
      matchIndex = lowerText.indexOf(normalizedQuery, cursor);
    }
    fragments.push(child.slice(cursor));
    return fragments;
  });
}

function getRaftRefProp(node: any, prop: string): string | undefined {
  const value = node?.properties?.[prop] ?? node?.properties?.[`data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`];
  return typeof value === "string" ? value : undefined;
}

function renderDisplayOnlyMention(children: ReactNode) {
  return (
    <MessageReferenceText variant="secondary" render={<span data-message-mention="display-only" />}>
      {children}
    </MessageReferenceText>
  );
}

function ThreadSearchFragmentHighlight({ children }: { children?: ReactNode }) {
  return (
    <MessageItemSearchMatch data-testid="thread-search-fragment-highlight">
      {children}
    </MessageItemSearchMatch>
  );
}

const mentionIdentityMapCache = new WeakMap<Map<string, MentionEntry>, Map<string, MentionEntry>>();
export default useRenderMessageMarkdown;
