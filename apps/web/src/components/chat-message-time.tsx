import { useSyncExternalStore } from "react";
import {
  getLocalDaySnapshot,
  subscribeToLocalDay,
} from "../chat-calendar-clock.ts";
import { chatDateLabel } from "../chat-timeline-presentation.ts";
import { formatChatMessageTime } from "../date-time-presentation.ts";

function useLocalCalendarDay() {
  return useSyncExternalStore(
    subscribeToLocalDay,
    getLocalDaySnapshot,
    getLocalDaySnapshot,
  );
}
export function ChatMessageTime({ value }: { value: string }) {
  useLocalCalendarDay();
  return <time dateTime={value}>{formatChatMessageTime(value)}</time>;
}
export function ChatDateDivider({ createdAt }: { createdAt: string }) {
  useLocalCalendarDay();
  return (
    <div className="rah-chat-date-divider" role="separator">
      <span aria-hidden="true" />
      <time>{chatDateLabel(createdAt)}</time>
    </div>
  );
}
