/** Replace only the native controller; retain its complete form and primitives. */
export function adaptSystemSettings(source: string) {
  const marker = "function SystemChannelsSection() {";
  const start = source.indexOf(marker);
  const render = source.indexOf("\n  return (", start);
  if (
    source.split(marker).length !== 2 ||
    render < 0 ||
    !source.slice(start, render).includes("await hideAllChannel();")
  )
    throw Error("Official system channel section changed");
  return (
    'import { useSystemSettings } from "loom-system-settings";\n' +
    source.slice(0, start) +
    marker +
    "\n  const { formatMessage } = useIntl();\n  const { allChannelHidden, saving, saved, error, dirty, handleSave, handleAllChannelHiddenChange, ready } = useSystemSettings();\n  if (!ready) return null;\n" +
    source.slice(render) +
    "\nexport { SystemChannelsSection };\n"
  );
}
