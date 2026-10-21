import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
export function generateActivity() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/agent/AgentActivityLog.tsx",
    "utf8",
  );
  return (
    '// GENERATED exact official timeline primitives; no upstream store or socket.\nimport type {ReactNode} from "react";\nimport {Status,type Presence} from "raft-ui";\ntype FormatTimestamp = (timestamp:number)=>string;\n' +
    extractDeclarations(source, [
      "LOG_ITEM_CLASS",
      "LOG_PIXEL_CLASS",
      "LOG_TITLE_CLASS",
      "LOG_DETAIL_CLASS",
      "LOG_TIME_CLASS",
      "LogItem",
    ]).join("\n\n") +
    "\nexport {LogItem,LOG_TITLE_CLASS,LOG_DETAIL_CLASS};\n"
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialActivity.generated.tsx",
    generateActivity(),
  );
