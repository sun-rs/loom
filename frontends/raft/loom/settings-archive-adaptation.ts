/** Preserve the official section's complete presentation; replace its store controller only. */
export function adaptArchivedChannels(source: string) {
  const start = source.indexOf("  const nav = useAppNavigate();");
  const end = source.indexOf("\n  if (!capabilities.archiveChannels", start);
  if (
    start < 0 ||
    end < 0 ||
    !source.slice(start, end).includes("await unarchiveChannel(channel.id);")
  )
    throw Error("Official archived channels controller changed");
  let code =
    source.slice(0, start) +
    "  const { nav, capabilities, loading, archivedChannels, busyChannelId, error, handleUnarchive } = useArchivedSettings();\n" +
    source.slice(end);
  const wrapper =
    "  const serverId = useServerStore((state) => state.current?.id ?? null);\n  return <ArchivedChannelsSectionContent key={serverId} />;";
  if (code.split(wrapper).length !== 2)
    throw Error("Official archived channels scope changed");
  code = code.replace(wrapper, "  return <ArchivedChannelsSectionContent />;");
  // Loom's local channels are not upstream public/nonmember channels.
  code = code.replace(
    "formatMessage({ id: channelTypeMessageId(channel.type) })",
    '"频道"',
  );
  return (
    'import { useArchivedSettings } from "loom-archived-settings";\n' + code
  );
}
