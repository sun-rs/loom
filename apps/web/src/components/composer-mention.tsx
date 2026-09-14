import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import {
  useEffect,
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
  composerMentionMatch,
  filterComposerMentionAgents,
} from "../composer-mention.ts";
import { AgentAvatar } from "./agent-avatar.tsx";

export function useComposerMention({
  agents,
  body,
  id,
  setBody,
  textareaRef,
}: {
  agents: readonly WorkspaceAgentView[];
  body: string;
  id: string;
  setBody: (body: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [caret, setCaret] = useState<number>();
  const [dismissedToken, setDismissedToken] = useState<string>();
  const [focused, setFocused] = useState(false);
  const match = useMemo(
    () => (caret === undefined ? undefined : composerMentionMatch(body, caret)),
    [body, caret],
  );
  const token = match
    ? `${String(match.start)}:${String(match.end)}:${match.query}`
    : undefined;
  const candidates = useMemo(
    () => (match ? filterComposerMentionAgents(agents, match) : []),
    [agents, match],
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

  function select(agent: WorkspaceAgentView) {
    if (!match) return;
    const result = completeComposerMention(body, agent.handle, match);
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
    if (event.key === "Enter" || event.key === "Tab") {
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
        ? `${id}-${candidates[activeIndex].participantId}`
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
  agents: readonly WorkspaceAgentView[];
  id: string;
  onSelect: (agent: WorkspaceAgentView) => void;
  open: boolean;
}) {
  if (!open) return null;
  return (
    <div
      aria-label="提及 Agent"
      className="mention-menu rah-composer-mention-menu"
      id={id}
      role="listbox"
    >
      {agents.map((agent, index) => (
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
      ))}
    </div>
  );
}
