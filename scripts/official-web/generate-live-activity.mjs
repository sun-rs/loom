import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
export function generateLiveActivity() {
  const source = readFileSync(
    "frontends/raft/upstream/compatibility/live-activity/LiveAgentActivityBar.tsx",
    "utf8",
  );
  let body = [
    "ACTIVITY_STATUS_VARIANT",
    "ACTIVITY_STATUS_BRUTAL_COLOR",
    "LiveAgentActivityBarPresentation",
  ]
    .map((n) => extractDeclaration(source, n))
    .join("\n");
  // Exact previously adopted 0.6 design-system compatibility changes; never restore retired theme families.
  for (const [before, after] of [
    ["theme-brutal:[--status-color:var(--color-status-busy)]", ""],
    ["theme-brutal:[--status-color:var(--color-brutal-orange)]", ""],
    ['beam={false} className="theme-brutal:px-3!"', 'className=""'],
    ["theme-brutal:border-black", ""],
  ]) {
    if (!body.includes(before))
      throw Error("Live activity compatibility boundary drift: " + before);
    body = body.split(before).join(after);
  }
  return `// GENERATED from original a98ae003 LiveAgentActivityBar presentation, not current db5e399.
// Preserves previously adopted design-system compatibility; Loom alone supplies actual activity.
import {useIntl} from "react-intl";
import {AvatarImage,LiveAgentActivityBar,LiveAgentActivityBarAvatar,LiveAgentActivityBarContent,LiveAgentActivityBarRow,LiveAgentActivityBarText,Status} from "raft-ui";
import type {StatusProps} from "raft-ui";
import type {AgentActivity} from "@botiverse/raft-shared";
import type {LiveAgentActivityItem} from "../packages/web/src/utils/liveAgentActivity";
import {formatActivityTextDescriptor} from "../packages/web/src/utils/activity";
import {AgentAvatar,isCustomAvatar} from "../packages/web/src/components/agent/PixelAvatar";
import Tooltip from "@loom/raft-web-source/Tooltip";
${body}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialLiveActivity.generated.tsx",
    generateLiveActivity(),
  );
