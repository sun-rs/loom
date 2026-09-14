/** Presentation only: Raft Jmt selects the latest opened target and retains its
 * source. Existing Room/Thread/profile owners retain content and drafts. */
export type ConversationOrigin = "room" | "thread";
export type ConversationPanelIntent = {
  latest: "thread" | "profile";
  source: ConversationOrigin;
};
export function conversationPanels({
  thread,
  profile,
  latest,
  source,
  split,
}: ConversationPanelIntent & {
  thread: boolean;
  profile: boolean;
  split: boolean;
}) {
  const showProfile = profile && (!thread || latest === "profile");
  const origin = source === "thread" && !thread ? "room" : source;
  return {
    room: showProfile ? split && origin === "room" : split || !thread,
    thread: showProfile ? split && origin === "thread" : thread,
    profile: showProfile,
    source: origin,
  };
}
