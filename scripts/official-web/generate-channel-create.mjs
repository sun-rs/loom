import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const path =
  "frontends/raft/upstream/channel-create-2026-10-29/CreateChannelDialog.tsx";
export function generateChannelCreate() {
  const source = readFileSync(path, "utf8");
  const name = source.slice(
    source.indexOf(
      '          <FormField label={formatMessage({ id: "channel.create.nameLabel"',
    ),
    source.indexOf(
      '          <FormField label={formatMessage({ id: "channel.create.visibilityLabel"',
    ),
  );
  const members = source.slice(
    source.indexOf(
      '          <FormField label={formatMessage({ id: "channel.create.membersLabel"',
    ),
    source.indexOf("          {bridgeEditor.available && ("),
  );
  if (!name.includes("<Textarea") || !members.includes("filteredAgents.map"))
    throw Error("Upstream create form changed");
  return `// GENERATED from preserved official CreateChannelDialog; original name/description/member JSX.\n// Unsupported multi-Human/visibility/Slack slots are not exposed; Loom owns commands.\nimport {useState,type ChangeEvent,type ReactNode} from 'react';\nimport {useIntl} from 'react-intl';\nimport {Input,Textarea,Card,InputGroup,InputGroupAddon,InputGroupInput,CheckboxIndicator} from 'raft-ui';\nimport {Search} from 'lucide-react';\nimport {PICKER_GROUP_LABEL_CLASS,PICKER_ROW_CLASS} from '../upstream/channel-create-2026-10-29/memberPickerClasses';\nimport AvatarSlot from '../packages/web/src/components/ui/AvatarSlot.tsx';\nimport SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';\nimport FormField from '../packages/web/src/components/ui/FormField.tsx';\ntype Member={id:string;name:string;displayName?:string;avatarUrl?:string|null;userId:string};\nexport function OfficialCreateChannelFields({name,description,onName,onDescription,agents,selectedAgentIds,toggleAgent,workspace}:{name:string;description:string;onName:(v:string)=>void;onDescription:(v:string)=>void;agents:Omit<Member,"userId">[];selectedAgentIds:Set<string>;toggleAgent:(id:string)=>void;workspace:ReactNode}){\n const {formatMessage}=useIntl();\n const [memberSearch,setMemberSearch]=useState('');\n const filteredAgents=agents.filter(a=>(a.displayName||a.name).toLocaleLowerCase().includes(memberSearch.trim().toLocaleLowerCase()));\n const filteredHumans:Member[]=[];\n const selectedHumanIds=new Set<string>();\n const toggleHuman=(_id:string)=>{};\n const hasMembers=agents.length>0;\n const hasFilteredMembers=filteredAgents.length>0;\n const handleNameChange=(e:ChangeEvent<HTMLInputElement>)=>onName(e.target.value);\n const handleDescriptionChange=(e:ChangeEvent<HTMLTextAreaElement>)=>onDescription(e.target.value);\n const handleMemberSearchChange=(e:ChangeEvent<HTMLInputElement>)=>setMemberSearch(e.target.value);\n return <>${name.replace("<Input\n", '<Input aria-label="名称"\n').replace("<Textarea\n", '<Textarea aria-label="描述"\n')}{workspace}${members}</>;\n}\n`;
}
if (process.argv[1]?.endsWith("generate-channel-create.mjs")) {
  writeFileSync(
    "frontends/raft/loom/OfficialCreateChannelFields.generated.tsx",
    generateChannelCreate(),
  );
  writeFileSync(
    "frontends/raft/upstream/channel-create-2026-10-29/provenance.json",
    JSON.stringify(
      {
        source: "https://github.com/botiverse/raft-source",
        revision: "db5e399f017d584e49597e3a28757645d6807893",
        path: "packages/web/src/components/channel/CreateChannelDialog.tsx",
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        companionSha256: createHash("sha256")
          .update(
            readFileSync(
              "frontends/raft/upstream/channel-create-2026-10-29/memberPickerClasses.ts",
            ),
          )
          .digest("hex"),
        license: "FSL-1.1-ALv2; ../../LICENSE retained; owner-authorized reuse",
        adoption:
          "Byte-exact independently acquired source; extracted JSX sections with Loom data bindings and accessible labels; workspace folder slot; omitted visibility/multi-Human/Slack",
      },
      null,
      2,
    ) + "\n",
  );
}
