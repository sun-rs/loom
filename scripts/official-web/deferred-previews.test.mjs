import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("download path does not import any preview presentation", () => {
  assert.match(read("Attachments.tsx"), /from "\.\/download-attachment.ts"/);
  const s = read("download-attachment.ts");
  assert.doesNotMatch(
    s,
    /DocumentPreview|HtmlPreview|attachmentPreviewSurfaces/,
  );
});
test("preview hosts mount lazy presentations only when native stores are open", () => {
  const entry = read("app-entry.tsx");
  assert.doesNotMatch(
    entry,
    /from .*\/(?:DocumentPreview|HtmlPreview|ImageLightbox)/,
  );
  const s = read("PreviewHosts.tsx");
  for (const name of ["DocumentPreview", "HtmlPreview", "ImageLightbox"])
    assert.match(s, new RegExp("import\\([^\\n]*" + name));
  assert.match(s, /documentOpen &&/);
  assert.match(s, /htmlOpen &&/);
  assert.match(s, /imageOpen &&/);
  assert.match(s, /<Suspense/);
  assert.match(s, /<Lightbox/);
});
test("both presence reads are gated by document visibility without replacing their authoritative endpoints", () => {
  for (const name of ["RolePresence.tsx", "InstancePresence.tsx"]) {
    const s = read(name);
    assert.match(s, /usePageVisible\(\)/);
    assert.match(s, /!visible/);
    assert.match(s, /visible\]/);
  }
  assert.match(read("RolePresence.tsx"), /room.agent.activity.list/);
  assert.match(read("InstancePresence.tsx"), /agent.presence.list/);
});
test("message attachment labels do not retain preview component module in startup graph", () => {
  assert.match(
    read("OfficialMessageItem.generated.tsx"),
    /from "\.\/OfficialPreviewLabels.generated"/,
  );
  assert.doesNotMatch(
    read("OfficialPreviewLabels.generated.tsx"),
    /\bimport\b|createContext/,
  );
});
test("failed preview chunk keeps the page usable and offers native dismissal", () => {
  const s = read("PreviewHosts.tsx");
  assert.match(s, /getDerivedStateFromError/);
  assert.match(s, /预览加载失败/);
  assert.match(s, /<PreviewBoundary/);
});
