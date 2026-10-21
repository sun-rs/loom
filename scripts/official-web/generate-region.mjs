import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function generateRegion() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  const file = ts.createSourceFile(
    "official.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const section = file.statements.find(
    (n) =>
      ts.isFunctionDeclaration(n) && n.name?.text === "LanguageRegionSection",
  );
  if (!section || file.parseDiagnostics.length)
    throw Error("Official region boundary changed");
  const matches = [];
  function visit(n) {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(file) === "div" &&
      n.getText(file).includes("settings.dateTime.sectionLabel")
    )
      matches.push(n);
    ts.forEachChild(n, visit);
  }
  visit(section);
  if (matches.length !== 1)
    throw Error("Official date/time subtree changed; review before extraction");
  return `// GENERATED exact official date/time JSX; local props own device persistence. Do not edit.\nimport type {FormEvent,ReactNode} from 'react';
import type {IntlShape} from 'react-intl';
import {Clock,Check} from 'lucide-react';
import {Card,Button,Select,SelectTrigger,SelectValue,SelectIcon,SelectContent,SelectList,SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from 'raft-ui';
import SectionHeader from '@loom/raft-web-source/SectionHeader';
import Banner from '../packages/web/src/components/ui/Banner';
type Option={value:string;label:string};
type Props={formatMessage:IntlShape['formatMessage'];timezone:string;timeFormat:'12h'|'24h';timezoneOptions:Option[];timezoneMenuOptions:Option[];renderSelectItems:(options:Option[])=>ReactNode;handleTimezoneChange:(next:string|null)=>void;handleTimeFormatChange:(next:'12h'|'24h')=>void;handleSaveDateTime:(event:FormEvent)=>void;dateTimeDirty:boolean;dateTimeSaved:boolean;settingsError:string;timezoneError:string;timeFormatError:string;savingDateTime:boolean;settingsLoading:boolean};
export default function OfficialDateTime({formatMessage,timezone,timeFormat,timezoneOptions,timezoneMenuOptions,renderSelectItems,handleTimezoneChange,handleTimeFormatChange,handleSaveDateTime,dateTimeDirty,dateTimeSaved,settingsError,timezoneError,timeFormatError,savingDateTime,settingsLoading}:Props){return (${matches[0].getText(file)});}\n`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialDateTime.generated.tsx",
    generateRegion(),
  );
