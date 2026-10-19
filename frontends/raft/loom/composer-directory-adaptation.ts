export function adaptComposerDirectory(source: string) {
  const before = "const channels = useChannelStore((s) => s.channels);";
  if (source.split(before).length !== 2)
    throw Error("Official composer directory boundary changed");
  return (
    'import { useComposerChannels } from "loom-composer-directory";\n' +
    source.replace(before, "const channels = useComposerChannels();")
  );
}
