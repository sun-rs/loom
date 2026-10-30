// Extract native interaction declarations from the complete immutable Web release.
import ts from "typescript";
import prettier from "prettier";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { withPinnedRelease } from "./pinned-release.mjs";
const target = "frontends/raft/loom/";
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};
export async function generateSidebarDrag140() {
  return withPinnedRelease(async ({ directory, metadata }) => {
    const lock = JSON.parse(
      readFileSync(directory + "/release-lock.json", "utf8"),
    );
    const module = lock.files.find((f) =>
      f.url.endsWith("/app-shell-DOYrxQ-_.js"),
    );
    const locale = lock.files.find((f) => f.url.endsWith("/zh-cn-zgUfP7tb.js"));
    if (!module || !locale) throw Error("Missing full-release sidebar inputs");
    const ast = ts.createSourceFile(
      module.url,
      readFileSync(directory + "/" + module.file, "utf8"),
      99,
      true,
      1,
    );
    const functions = new Map(
      ast.statements
        .filter(ts.isFunctionDeclaration)
        .map((n) => [n.name?.text, n]),
    );
    const variables = new Map();
    for (const n of ast.statements)
      if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations)
          variables.set(d.name.getText(ast), d);
    const names = [
      "T5",
      "D5",
      "rit",
      "iit",
      "oit",
      "ait",
      "sit",
      "cit",
      "lit",
      "uit",
      "Dit",
      "Nit",
      "Mit",
      "Oit",
      "kit",
      "Ait",
      "R5",
      "jit",
      "z5",
      "H5",
      "N5",
      "Fit",
    ];
    const declarations = names.map((name) => {
      const n = functions.get(name);
      if (n) return n.getText(ast);
      const v = variables.get(name);
      if (!v?.initializer) throw Error("Missing native declaration " + name);
      return "const " + name + "=" + v.initializer.getText(ast) + ";";
    });
    const callbacks = {};
    walk(functions.get("Jit"), (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ["Ya", "Qa"].includes(node.name.getText(ast))
      ) {
        const call = node.initializer;
        if (
          !call ||
          !ts.isCallExpression(call) ||
          !ts.isArrowFunction(call.arguments[0])
        )
          throw Error("Native callback changed");
        if (callbacks[node.name.text]) throw Error("Ambiguous native callback");
        callbacks[node.name.text] = call.arguments[0].getText(ast);
      }
    });
    if (!callbacks.Ya || !callbacks.Qa)
      throw Error("Missing native collision/projection callbacks");
    let hint, overlay;
    walk(functions.get("Jit"), (node) => {
      if (!ts.isCallExpression(node)) return;
      const props = node.arguments[1];
      if (!props || !ts.isObjectLiteralExpression(props)) return;
      const id = props.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) && p.name.getText(ast) === '"data-testid"',
      );
      if (!id || !ts.isStringLiteralLike(id.initializer)) return;
      if (id.initializer.text === "sidebar-pinned-empty-hint")
        hint = node.getText(ast);
      if (id.initializer.text === "sidebar-drag-overlay")
        overlay = node.getText(ast);
    });
    if (!hint || !overlay)
      throw Error("Missing native hint/overlay composition");
    const cn = ts.createSourceFile(
        locale.url,
        readFileSync(directory + "/" + locale.file, "utf8"),
        99,
        true,
        1,
      ),
      captions = {};
    walk(cn, (n) => {
      if (ts.isPropertyAssignment(n) && ts.isStringLiteralLike(n.initializer))
        for (const [key, id] of Object.entries({
          pinned: "layout.sidebar.pinned",
          pinnedEmptyHint: "layout.sidebar.pinnedEmptyHint",
        }))
          if (n.name.text === id) captions[key] = n.initializer.text;
    });
    if (!captions.pinned || !captions.pinnedEmptyHint)
      throw Error("Missing native Chinese captions");
    const js = await prettier.format(
      `// GENERATED from the complete pinned Web1.21.40 distribution. Declaration/callback bodies unchanged.
import * as K from "react";import * as q from "react/jsx-runtime";
import {useSortable as it,SortableContext as we,verticalListSortingStrategy as oe} from "@dnd-kit/sortable";
import {useDndContext as Nn,useDroppable as mn,pointerWithin as dr,closestCenter as mt,MeasuringStrategy as Hn} from "@dnd-kit/core";
import {CSS as ar} from "@dnd-kit/utilities";import {SidebarSectionDisclosure as ws} from "raft-ui";
${declarations.join("\n")}
export {Oit as NativeSidebarDragItem,R5 as NativeSidebarDropList,kit as NativeSidebarDragMeasure,z5 as NativeSidebarDragSection,H5 as NativeSidebarSectionToggle,D5 as findSidebarDragContainer,ait as sidebarDropIndex,Fit as nativeSidebarMeasuring};
export function nativeSidebarAlgorithms({canDrop:Fa,sectionIds:he,projectionRef:Et,startRef:Tt,base:Oa}){const collision=${callbacks.Ya};const project=${callbacks.Qa};return {collision,project};}
export function NativePinnedEmptyHint(){const r=()=>${JSON.stringify(captions.pinnedEmptyHint)};return ${hint};}
export function NativeSidebarDragLabel({activeId:xt,labels:Da}){return ${overlay};}
`,
      { parser: "babel" },
    );
    const types = `// GENERATED by generate-sidebar-drag140.mjs.
import type {ReactNode,ReactElement,MutableRefObject,ButtonHTMLAttributes} from "react";
import type {Active,Over,Collision,CollisionDetection,MeasuringStrategy} from "@dnd-kit/core";
export type SidebarProjection=Record<string,string[]>;
export const nativeSidebarMeasuring:{droppable:{strategy:MeasuringStrategy}};
export function NativeSidebarDragItem(p:{id:string;containerId:string;children:ReactNode}):ReactElement;
export function NativeSidebarDropList(p:{id:string;kind:string;manual:boolean;itemIds:string[];empty:boolean;children:ReactNode}):ReactElement;
export function NativeSidebarDragMeasure(p:{projection:SidebarProjection|null}):null;
export function NativeSidebarDragSection(p:{id:string;testId?:string;order?:number;children:ReactNode}):ReactElement;
export function NativeSidebarSectionToggle(p:ButtonHTMLAttributes<HTMLButtonElement>&{sectionKey:string;onToggleSection:(id:string)=>void;children:ReactNode}):ReactElement;
export function findSidebarDragContainer(p:SidebarProjection,id:string):string|null;
export function sidebarDropIndex(collisions:Collision[]|null|undefined,id:string|number):number|null;
export function nativeSidebarAlgorithms(p:{canDrop:(id:string,containerId:string)=>boolean;sectionIds:string[];projectionRef:MutableRefObject<SidebarProjection|null>;startRef:MutableRefObject<SidebarProjection|null>;base:SidebarProjection}):{collision:CollisionDetection;project:(active:Active,over:Over,projection:SidebarProjection,index:number|null)=>SidebarProjection};
export function NativePinnedEmptyHint():ReactElement;
export function NativeSidebarDragLabel(p:{activeId:string;labels:Map<string,{label:string}>}):ReactElement;
`;
    return {
      js,
      types: await prettier.format(types, { parser: "typescript" }),
      captions,
      provenance: {
        release: metadata.release,
        archiveSha256: metadata.sha256,
        module: { url: module.url, sha256: module.sha256 },
        locale: { url: locale.url, sha256: locale.sha256 },
        declarations: names,
        callbackBodies: ["Ya", "Qa"],
        generatedSha256: createHash("sha256").update(js).digest("hex"),
        scope:
          "Native drop zones/items/section activators, stable drag geometry, collision/projection algorithms, overlay and empty-pinned composition. Loom supplies only identities, projection data and durable preference writes.",
      },
    };
  });
}
if (process.argv[1]?.endsWith("generate-sidebar-drag140.mjs")) {
  const r = await generateSidebarDrag140();
  writeFileSync(target + "OfficialSidebarDrag140.generated.js", r.js);
  writeFileSync(target + "OfficialSidebarDrag140.generated.d.ts", r.types);
  writeFileSync(
    target + "sidebar-drag-captions.json",
    JSON.stringify(r.captions, null, 2) + "\n",
  );
  writeFileSync(
    target + "sidebar-drag.provenance.json",
    JSON.stringify(r.provenance, null, 2) + "\n",
  );
}
