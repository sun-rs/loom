import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import {
  useEffect,
  useContext,
  useMemo,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  completeComposerMention,
  completeComposerChannel,
  composerChannelMatch,
  filterComposerChannels,
  type ComposerChannel,
  composerMentionMatch,
  filterComposerMentionAgents,
  prioritizeComposerParticipants,
} from "../composer-mention.ts";
import { ComposerChannelContext } from "./composer-channel-context.tsx";
import { ChannelMentionRow } from "./composer-channel-row.tsx";
type Candidate = WorkspaceAgentView | ComposerChannel;
const candidateId = (candidate: Candidate) =>
  "roomId" in candidate ? candidate.roomId : candidate.participantId;

import { AgentAvatar } from "./agent-avatar.tsx";

export function useComposerMention({
  agents,
  channels: suppliedChannels,
  recentParticipantIds,
  body,
  id,
  setBody,
  textareaRef,
}: {
  agents: readonly WorkspaceAgentView[];
  channels?: readonly ComposerChannel[];
  recentParticipantIds?: readonly string[];
  body: string;
  id: string;
  setBody: (body: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const directory = useContext(ComposerChannelContext);
  const channels = suppliedChannels ?? directory;
  const [activeIndex, setActiveIndex] = useState(0);
  const [caret, setCaret] = useState<number>();
  const [dismissedToken, setDismissedToken] = useState<string>();
  const [focused, setFocused] = useState(false);
  const match = useMemo(
    () =>
      caret === undefined
        ? undefined
        : (composerMentionMatch(body, caret) ??
          composerChannelMatch(body, caret)),
    [body, caret],
  );
  const isChannel = match !== undefined && body[match.start] === "#";
  const token = match
    ? `${isChannel ? "#" : "@"}:${String(match.start)}:${String(match.end)}:${match.query}`
    : undefined;
  const candidates = useMemo<readonly Candidate[]>(
    () =>
      match
        ? isChannel
          ? filterComposerChannels(channels, match)
          : prioritizeComposerParticipants(
              filterComposerMentionAgents(agents, match),
              recentParticipantIds ?? [],
            )
        : [],
    [agents, channels, match, isChannel, recentParticipantIds],
  );
  const open =
    focused &&
    match !== undefined &&
    candidates.length > 0 &&
    dismissedToken !== token;

  useEffect(() => setActiveIndex(0), [token]);

  function syncSelection(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart);
  }

  function select(agent: Candidate) {
    if (!match) return;
    const result =
      "roomId" in agent
        ? completeComposerChannel(body, agent.name, match)
        : completeComposerMention(body, agent.handle, match);
    setBody(result.text);
    setDismissedToken(undefined);
    setCaret(result.caret);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      element?.focus();
      element?.setSelectionRange(result.caret, result.caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !open ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        return (current + offset + candidates.length) % candidates.length;
      });
      return;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      const candidate = candidates[activeIndex];
      if (candidate) select(candidate);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedToken(token);
    }
  }

  return {
    activeDescendant:
      open && candidates[activeIndex]
        ? `${id}-${candidateId(candidates[activeIndex])}`
        : undefined,
    candidates,
    activeIndex,
    open,
    onBlur: (_event: FocusEvent<HTMLTextAreaElement>) => setFocused(false),
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      setDismissedToken(undefined);
      setBody(event.currentTarget.value);
      syncSelection(event.currentTarget);
    },
    onFocus: (event: FocusEvent<HTMLTextAreaElement>) => {
      setFocused(true);
      syncSelection(event.currentTarget);
    },
    onKeyDown,
    onSelectionChange: (element: HTMLTextAreaElement) => syncSelection(element),
    select,
  };
}

export function ComposerMentionMenu({
  activeIndex,
  agents,
  id,
  onSelect,
  open,
}: {
  activeIndex: number;
  agents: readonly Candidate[];
  id: string;
  onSelect: (agent: Candidate) => void;
  open: boolean;
}) {
  useEffect(() => {
    if (open)
      document
        .getElementById(
          `${id}-${agents[activeIndex] ? candidateId(agents[activeIndex]) : ""}`,
        )
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);
  if (!open) return null;
  const channelMode = agents.some((agent) => "roomId" in agent);
  return (
    <div
      aria-label={channelMode ? "引用频道" : "提及 Agent"}
      className={`mention-menu rah-composer-mention-menu${channelMode ? " rah-channel-mention-menu" : ""}`}
      id={id}
      role="listbox"
    >
      {agents.map((agent, index) =>
        "roomId" in agent ? (
          <ChannelMentionRow
            key={agent.roomId}
            channel={agent}
            id={`${id}-${agent.roomId}`}
            current={index === activeIndex}
            onSelect={() => onSelect(agent)}
          />
        ) : (
          <ChoiceRow
            profile="autocomplete"
            current={index === activeIndex}
            aria-selected={index === activeIndex}
            className={`mention-row${index === activeIndex ? " is-active" : ""}`}
            id={`${id}-${agent.participantId}`}
            key={agent.participantId}
            onClick={() => onSelect(agent)}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
            type="button"
          >
            <AgentAvatar agent={agent} showStatus size="compact" />
            <span className="rah-composer-mention-copy">
              <span>
                <b>{agent.displayName}</b>
                <small>AGENT</small>
              </span>
              <span>{agent.role}</span>
            </span>
            <span className="handle">@{agent.handle}</span>
          </ChoiceRow>
        ),
      )}
    </div>
  );
}
