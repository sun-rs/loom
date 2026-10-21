// Offline, exact-boundary Loom bindings for immutable official presentation. Not a Vite/runtime transform.
function replaceOnce(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Official thread followers changed; review source");
  return source.replace(from, to);
}
export function adaptThreadFollowers(source: string) {
  const start = source.indexOf("  const roster = useThreadAgentFollowerStore");
  const end = source.indexOf("  const agents = roster?.agents");
  if (start < 0 || end < start)
    throw Error("Official thread followers controller changed");
  return (
    'import { useLoomThreadFollowers } from "loom-thread-followers";\n' +
    source.slice(0, start) +
    `  const {roster,load,remove,restore}=useLoomThreadFollowers(threadChannelId);
  const currentServerId=undefined;
  const [open,setOpen]=useState(false);
  const [removingId,setRemovingId]=useState<string|null>(null);
\n` +
    source.slice(end)
  );
}
export function adaptThreadFollowerRow(source: string) {
  let code = replaceOnce(
    source,
    "  const openProfile = useProfileStore((state) => state.openProfile);",
    "  const openProfile = useLoomFollowerProfile();",
  );
  const start = code.indexOf("    setCachedAgentProfile(currentServerId, {");
  const end = code.indexOf('    openProfile("agent", agent.id);', start);
  if (start < 0 || end < start)
    throw Error("Official follower profile changed");
  code = code.slice(0, start) + code.slice(end);
  code = replaceOnce(code, "        agentId={agent.id}\n", "");
  code = replaceOnce(
    code,
    "        agentFallbackActivity={agentStatusFallbackActivity(followerAgentStatus(agent.status))}\n",
    "",
  );
  code = replaceOnce(
    code,
    "        secondary={<AgentActivityInfo agentId={agent.id} fallbackStatus={followerAgentStatus(agent.status)} />}",
    "        secondary={undefined}",
  );
  return (
    'import { useLoomFollowerProfile } from "loom-thread-followers";\n' + code
  );
}

export function adaptReactionToolbar(source: string) {
  let code = replaceOnce(
    source,
    "  isSaved: boolean;",
    "  isSaved: boolean;\n  loomHideSave?: boolean;",
  );
  code = replaceOnce(code, "  isSaved,\n", "  isSaved,\n  loomHideSave,\n");
  code = replaceOnce(
    code,
    "      <MessageItemToolbarButton\n        active={isSaved}",
    "      {!loomHideSave && <MessageItemToolbarButton\n        active={isSaved}",
  );
  return replaceOnce(
    code,
    '        <Bookmark size={18} fill={isSaved ? "currentColor" : "none"} />\n      </MessageItemToolbarButton>',
    '        <Bookmark size={18} fill={isSaved ? "currentColor" : "none"} />\n      </MessageItemToolbarButton>}',
  );
}
