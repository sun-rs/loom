import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
export function generateChannelPreferences() {
  const base =
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/channel/";
  const source = readFileSync(base + "ChannelPreferencesSection.tsx", "utf8");
  const classes = readFileSync(base + "channelSettingsClasses.ts", "utf8");
  let code = ["ChannelPreferencesSectionProps", "ChannelPreferencesSection"]
    .map((n) => extractDeclaration(source, n))
    .join("\n");
  function replace(a, b) {
    if (code.split(a).length !== 2)
      throw Error("Preference source seam changed: " + a);
    code = code.replace(a, b);
  }
  replace(
    "channelId: string;",
    "pin: { pinned: boolean; busy: boolean; onToggle: () => void };",
  );
  replace("  channelId,", "  pin,");
  const start = code.indexOf("  const sidebarOrder ="),
    end = code.indexOf("  // The Switch passes");
  if (start < 0 || end < start)
    throw Error("Preference store boundary changed");
  code =
    code.slice(0, start) +
    "  const isPinned = pin.pinned;\n  const handleTogglePin = pin.onToggle;\n" +
    code.slice(end);
  replace(
    "checked={isPinned}",
    "checked={isPinned}\n            disabled={pin.busy}",
  );
  return (
    '// GENERATED from db5e399 ChannelPreferencesSection; native JSX, Loom pinned authority callback.\nimport {useCallback} from "react";\nimport {useIntl} from "react-intl";\nimport {FormSection,Separator,Switch} from "raft-ui";\n' +
    ["ROW_TITLE_CLASS", "ROW_DESCRIPTION_CLASS"]
      .map((n) => extractDeclaration(classes, n))
      .join("\n") +
    "\n" +
    code +
    "\n"
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialChannelPreferences.generated.tsx",
    generateChannelPreferences(),
  );
