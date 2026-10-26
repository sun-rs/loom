import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
export function generateTopbar() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/topbar/AppTopBar.tsx",
    "utf8",
  );
  function one(text, predicate) {
    const ast = ts.createSourceFile("source.tsx", text, 99, true, 4),
      found = [];
    function visit(n) {
      if (predicate(n, ast)) found.push(n);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    if (found.length !== 1)
      throw Error("Topbar composition drift: " + found.length);
    return found[0].getText(ast);
  }
  let view = one(
    source,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.getText(a).includes('data-testid="app-top-bar"'),
  );
  const identity = one(
    view,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.getText(a).includes("ref={workspaceNameRef}"),
  );
  view = view.replace(identity, "{identity}");
  const strip = one(
    view,
    (n, a) =>
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(a) === "WorkspaceStrip",
  );
  view = view.replace(strip, "");
  const left = one(
    view,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.getText(a).includes("style={edges.leading}"),
  );
  const right = one(
    view,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.getText(a).includes("style={edges.trailing}"),
  );
  view = view
    .replace(left, left.replace("<div ", "<div ref={leadingRef} "))
    .replace(right, right.replace("<div ", "<div ref={trailingRef} "));
  view = view.replace(
    "ref={searchFieldRef}",
    "ref={searchFieldRef} style={searchWidth === undefined ? undefined : {width:searchWidth}}",
  );
  view = view.replace(
    "getGlobalSearchShortcutLabel(undefined, formatMessage)",
    "shortcut",
  );
  // Official 1.21.34 BAR_FRAME adds the theme decoration utility.
  view = view.replace(
    "className={BAR_FRAME}",
    "className={`${BAR_FRAME} frame-decor-top`}",
  );
  return `// GENERATED from locked db5e399 AppTopBar. Native frame/regions/search; Loom supplies workspace, notification and route slots.
// Explicit compatibility: v1.21.26 adaptive search width remains a Loom port; no account/workspace switching.
import type {ReactNode,Ref} from "react";
import {useIntl} from "react-intl";
import {SearchTrigger,SearchTriggerLabel,SearchTriggerShortcut} from "raft-ui";
import {Search} from "lucide-react";
${["edgeBalance", "EDGE_BALANCE", "BAR_FRAME"].map((n) => extractDeclaration(source, n)).join("\n")}
export function OfficialTopBar({identity,trailing,shortcut,leadingRef,trailingRef,searchFieldRef,searchWidth,openSearch}:{identity:ReactNode;trailing:ReactNode;shortcut:ReactNode;leadingRef:Ref<HTMLDivElement>;trailingRef:Ref<HTMLDivElement>;searchFieldRef:Ref<HTMLButtonElement>;searchWidth?:number;openSearch:()=>void}){
 const titleBar=false,edges=EDGE_BALANCE.web,leadingEnd=null;
 const {formatMessage}=useIntl();
 return (${view});
}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialTopBar.generated.tsx",
    generateTopbar(),
  );
