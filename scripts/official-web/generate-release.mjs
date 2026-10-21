import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
export function generateRelease() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/ReleaseNotesPanel.tsx",
    "utf8",
  );
  const file = ts.createSourceFile(
    "official.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const panel = file.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "ReleaseNotesPanel",
  );
  const types = [
    "ReleaseNoteType",
    "ReleaseNoteEntry",
    "PublishedReleaseNote",
  ].map((name) => {
    const found = file.statements.filter(
      (n) =>
        (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) &&
        n.name.text === name,
    );
    if (found.length !== 1)
      throw Error("Official release type boundary changed");
    return found[0].getText(file);
  });
  const bodies = [];
  function visit(n) {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(file) === "div" &&
      n.openingElement.getText(file).includes("overflow-y-auto")
    )
      bodies.push(n);
    ts.forEachChild(n, visit);
  }
  if (!panel || file.parseDiagnostics.length)
    throw Error("Official release boundary changed");
  visit(panel);
  if (bodies.length !== 1)
    throw Error("Official release body boundary changed");
  const content = bodies[0].children.map((n) => n.getText(file)).join("\n");
  return (
    `// GENERATED official content JSX and category declarations. Local wrapper supplies Loom releases only.\nimport {useIntl} from 'react-intl';
import {FileText} from 'lucide-react';
import {Badge,Button,Card} from 'raft-ui';
import type {MessageId} from '../packages/web/src/i18n/messages/en';
import Banner from '../packages/web/src/components/ui/Banner';
import SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';\n` +
    types.join("\n") +
    "\n" +
    extractDeclarations(source, [
      "RELEASE_TYPE_CONFIG",
      "RELEASE_CATEGORY_ORDER",
    ]).join("\n") +
    `
export type ReleaseDisplay=Pick<PublishedReleaseNote,'releaseId'|'version'|'date'|'state'|'entries'>;
export function LoomReleaseNotes({releases}:{releases:readonly ReleaseDisplay[]}){
 const {formatMessage}=useIntl();
 const state={status:'ready' as string,releases};
 const currentReleaseId=releases.find((release) => release.state === "published")?.releaseId;
 const handleRetry=()=>{};
 return (<>${content}</>);
}\n`
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialReleaseNotes.generated.tsx",
    generateRelease(),
  );
