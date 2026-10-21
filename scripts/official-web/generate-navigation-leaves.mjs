import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
export function extractDeclaration(source, name) {
  const ast = ts.createSourceFile("upstream.tsx", source, 99, true, 4);
  const matches = ast.statements.filter(
    (n) =>
      n.name?.getText(ast) === name ||
      (ts.isVariableStatement(n) &&
        n.declarationList.declarations.some(
          (d) => d.name.getText(ast) === name,
        )),
  );
  if (matches.length !== 1)
    throw Error(
      `Official navigation declaration changed: ${name} (${matches.length})`,
    );
  return matches[0].getText(ast);
}
export function generateNavigationLeaves(
  read = (p) => readFileSync(p, "utf8"),
) {
  const groups = [
    [
      "layout/LeftRail.tsx",
      [
        "TOOLTIP_CONTENT_PROPS",
        "RailTabButtonProps",
        "RailTabButton",
        "setReactRef",
      ],
    ],
    [
      "layout/Sidebar.tsx",
      ["SIDEBAR_ROW_PHONE_CLASS", "SavedNavCount", "sidebarItemClass"],
    ],
    ["agent/ChannelMembers.tsx", ["JointPeerBadge"]],
  ];
  return (
    `// GENERATED: unchanged declarations from locked Raft db5e399. Only imports are scoped to presentation dependencies.
import {forwardRef,useCallback} from "react";
import type * as React from "react";
import {useIntl} from "react-intl";
import {AppRailItem,AppRailItemIcon,AppRailItemAttention,AppRailItemLabel,SidebarItemMeta,Badge} from "raft-ui";
import Tooltip from "@loom/raft-web-source/Tooltip";
` +
    groups
      .flatMap(([file, names]) => {
        const source = read(base + file);
        return names.map((name) => extractDeclaration(source, name));
      })
      .join("\n\n") +
    "\n"
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialNavigationLeaves.generated.tsx",
    generateNavigationLeaves(),
  );
