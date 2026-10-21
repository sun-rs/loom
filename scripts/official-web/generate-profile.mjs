import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractDeclarations} from './generate-appearance.mjs';
export function generateProfile(){
 const source=readFileSync('frontends/raft/upstream/raft-web-source/packages/web/src/components/agent/AgentDetailPanel.tsx','utf8');
 return `// GENERATED exact official declarations, with explicit presentation-only type/import bindings.\nimport type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {Pencil} from "lucide-react";
import {DescriptionItem,DescriptionTerm,DescriptionDetails,PanelTitle} from "raft-ui";
import Tooltip from "@loom/raft-web-source/Tooltip";
// The original helper reads only these fields; this is a view projection, not a Raft Agent.
type Agent = {displayName?: string; name: string};
\n`+extractDeclarations(source,['InfoRow','PROFILE_AVATAR_BUTTON_CLASS','RUNTIME_CHIP_CLASS','INFO_ICON_BUTTON_CLASS','AgentHeaderName']).join('\n\n')+'\nexport {InfoRow,PROFILE_AVATAR_BUTTON_CLASS,RUNTIME_CHIP_CLASS,INFO_ICON_BUTTON_CLASS,AgentHeaderName};\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))writeFileSync('frontends/raft/loom/OfficialProfile.generated.tsx',generateProfile());
