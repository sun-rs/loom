import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const roots = ["frontends/raft/loom", "frontends/raft/packages/web/src"];
function filesIn(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesIn(join(root, e.name))
      : e.name.endsWith(".tsx")
        ? [join(root, e.name)]
        : [],
  );
}
const buttons =
  /^(Button|Commit|DialogCommit|DialogClose|AlertDialogCancel|AlertDialogAction|AnnouncementDialogSecondaryAction|AnnouncementDialogAction)$/;
const footers =
  /^(DialogFooter|AlertDialogFooter|DrawerActions|AnnouncementDialogFooter)$/;
const dialogOwners =
  /^(DialogContent|DialogSheetContent|AlertDialogContent|ActionDialog|DialogCard|MobileFormDialog|AnnouncementDialogContent)$/;
function inDialog(node, sf) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (
      ts.isJsxElement(parent) &&
      dialogOwners.test(parent.openingElement.tagName.getText(sf))
    )
      return true;
  return false;
}
function labelOf(node, sf) {
  return node.children
    .map((c) =>
      ts.isJsxText(c)
        ? c.text.trim()
        : ts.isJsxExpression(c)
          ? (c.expression?.getText(sf) ?? "")
          : "",
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
export function auditDialogActions() {
  const rows = [];
  const files = roots.flatMap(filesIn).sort();
  for (const path of files) {
    const file = path.replace("frontends/raft/", ""),
      text = readFileSync(path, "utf8"),
      sf = ts.createSourceFile(file, text, 99, true, ts.ScriptKind.TSX);
    function directActions(node) {
      const out = [];
      function visit(child) {
        if (ts.isJsxElement(child)) {
          const tag = child.openingElement.tagName.getText(sf);
          if (buttons.test(tag)) {
            const source = child.getText(sf),
              label = labelOf(child, sf),
              attributes = child.openingElement.attributes.getText(sf);
            const cancel =
              tag === "AlertDialogCancel" ||
              tag === "AnnouncementDialogSecondaryAction" ||
              /^(取消|继续编辑|暂不添加)$/.test(label) ||
              /uiActionProps\.formCancel|["'][^"'\n]*\.cancel["']/.test(source);
            const primary =
              !cancel &&
              (tag === "DialogCommit" ||
                tag === "Commit" ||
                tag === "AlertDialogAction" ||
                tag === "AnnouncementDialogAction" ||
                /type="submit"|variant="accent"|uiActionProps\.formSave|onClick=\{(?:handleConfirm|onConfirm)\}/.test(
                  attributes,
                ) ||
                /^(保存|确认|删除|创建|添加|恢复|归档|放弃修改|继续|打开)/.test(
                  label,
                ));
            out.push({
              tag,
              label,
              kind: cancel ? "cancel" : primary ? "primary" : "other",
              source: attributes,
            });
            return;
          }
          return;
        }
        ts.forEachChild(child, visit);
      }
      for (const child of node.children) visit(child);
      return out;
    }
    function walk(node) {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(sf),
          actions = directActions(node),
          cancel = actions.findIndex((a) => a.kind === "cancel"),
          primary = actions.findIndex((a) => a.kind === "primary");
        // Inline and full-page editors retain their own native composition.
        // A dialog owner/footer establishes the modal cancel-then-primary rule.
        const inline = !footers.test(tag) && !inDialog(node, sf);
        if (footers.test(tag) || (cancel >= 0 && primary >= 0))
          rows.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            container: tag,
            kind: inline ? "nonmodal-actions" : "dialog-actions",
            actions: actions.map(({ tag, label, kind }) => ({
              tag,
              label,
              kind,
            })),
            hasPair: cancel >= 0 && primary >= 0,
            valid:
              inline ||
              (!(cancel >= 0 && primary >= 0 && cancel > primary) &&
                !/flex-row-reverse|\border-[1-9]/.test(
                  node.openingElement.attributes.getText(sf),
                )),
          });
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
  }
  return {
    scope:
      "Recursive scan of Loom adapters and retained Web TSX: native footers and recognizable direct sibling cancel/primary rows, including generated owners. Single-action/X-only forms are recorded without inventing another action. Nonmodal rows retain native order separately. This is a source-order guard, not proof of reachability or every rendered state.",
    filesScanned: files.length,
    rows,
    violations: rows.filter((r) => !r.valid),
  };
}
if (process.argv[1]?.endsWith("audit-dialog-actions.mjs"))
  console.log(JSON.stringify(auditDialogActions(), null, 2));
