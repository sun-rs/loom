import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
function parse(path) {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/" +
      path +
      ".tsx",
    "utf8",
  );
  const file = ts.createSourceFile(
    "official.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (file.parseDiagnostics.length) throw Error("Official syntax changed");
  return { source, file };
}
function declaration(file, name) {
  const rows = file.statements.filter((n) => n.name?.text === name);
  if (rows.length !== 1) throw Error("Official declaration changed: " + name);
  return rows[0];
}
function replaceOnce(s, from, to) {
  if (s.split(from).length !== 2)
    throw Error("Official compatibility boundary changed: " + from);
  return s.replace(from, to);
}
export function generateSettingsFoundation() {
  const sidebar = parse("settings/SettingsSidebarList"),
    field = parse("ui/FormField"),
    archive = parse("settings/ArchivedChannelsSection"),
    button = parse("settings/UnarchiveChannelButton");
  const sideNames = [
    "SettingsSidebarItem",
    "SettingsSidebarGroup",
    "SettingsSidebarList",
  ];
  let side = sideNames
    .map((n) => declaration(sidebar.file, n).getText(sidebar.file))
    .join("\n");
  side = replaceOnce(
    side,
    '{item.id === "feedback" && <FeedbackUnreadDot className="ml-auto" />}',
    "{/* Cloud feedback is not a Loom settings destination. */}",
  );
  const fn = declaration(archive.file, "ArchivedChannelsSectionContent");
  const ret = fn.body.statements
    .filter((n) => ts.isReturnStatement(n) && n.expression)
    .at(-1);
  if (!ret) throw Error("Official archive render changed");
  let render = ret.getText(archive.file);
  render = replaceOnce(
    render,
    "formatMessage({ id: channelTypeMessageId(channel.type) })",
    '"频道"',
  );
  const guard = fn.body.statements.filter(
    (n) =>
      ts.isIfStatement(n) &&
      n.expression
        .getText(archive.file)
        .includes("!capabilities.archiveChannels"),
  );
  if (guard.length !== 1)
    throw Error("Official archive visibility rule changed");
  let icon = declaration(archive.file, "channelTypeIcon").getText(archive.file);
  icon = replaceOnce(
    icon,
    'ArchivedChannel["type"]',
    '"channel" | "private" | "joint"',
  );
  const notice =
    "// GENERATED pinned official presentation. Explicit imports bind Loom state; do not edit.\n";
  return {
    OfficialSettingsSidebar:
      notice +
      `import type {ReactNode} from 'react';\nimport {SidebarGroupLabel,SidebarItem,SidebarItemContent,SidebarItemTitle} from 'raft-ui';\n` +
      side +
      "\n",
    OfficialFormField:
      notice +
      `import {useContext} from 'react';\nimport type {LabelHTMLAttributes,ReactNode} from 'react';\nimport {IntlContext} from 'react-intl';\nimport {Field,FieldDescription,FieldError,FieldLabel,LabelAsterisk,LabelOptional} from 'raft-ui';\nimport {en} from '../packages/web/src/i18n/messages/en';\n` +
      ["FormFieldProps", "FormField"]
        .map((n) => declaration(field.file, n).getText(field.file))
        .join("\n") +
      "\n",
    OfficialArchivedChannels:
      notice +
      `import {useCallback} from 'react';\nimport {useIntl} from 'react-intl';\nimport {Archive,ArchiveRestore,GitBranch,Hash,Lock} from 'lucide-react';\nimport {Card,IconTile,Button} from 'raft-ui';\nimport {useTimeFormatter} from '../packages/web/src/hooks/useTimeFormatter';\nimport Banner from '../packages/web/src/components/ui/Banner';\nimport SectionHeader from '@loom/raft-web-source/SectionHeader';\nimport Tooltip from '@loom/raft-web-source/Tooltip';\nimport {useArchivedSettings} from './ArchivedSettings';\ntype ArchivedChannel=ReturnType<typeof useArchivedSettings>['archivedChannels'][number];\n` +
      icon +
      "\n" +
      declaration(button.file, "UnarchiveChannelButton").getText(button.file) +
      `\nexport default function OfficialArchivedChannels(){const {formatMessage}=useIntl();const {formatMediumDateTime}=useTimeFormatter();const {nav,capabilities,loading,archivedChannels,busyChannelId,error,handleUnarchive}=useArchivedSettings();\n${guard[0].getText(archive.file)}\n${render}\n}\n`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, content] of Object.entries(generateSettingsFoundation()))
    writeFileSync(`frontends/raft/loom/${name}.generated.tsx`, content);
