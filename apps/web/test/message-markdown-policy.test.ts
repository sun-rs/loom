import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMermaidDocument,
  classifyMessageUrl,
  mermaidConfiguration,
  transformMessageUrl,
} from "../src/message-markdown-policy.ts";

test("message Markdown URL policy keeps web, attachment, and file references typed", () => {
  assert.deepEqual(classifyMessageUrl("https://example.com/a?q=1"), {
    kind: "external",
    url: "https://example.com/a?q=1",
  });
  assert.deepEqual(classifyMessageUrl("mailto:person@example.com"), {
    kind: "external",
    url: "mailto:person@example.com",
  });
  assert.deepEqual(classifyMessageUrl("/attachments/a-1"), {
    kind: "relative",
    url: "/attachments/a-1",
  });
  assert.deepEqual(classifyMessageUrl("file:///Users/sun/work/a.ts#L12"), {
    kind: "file",
    path: "/Users/sun/work/a.ts#L12",
  });
  assert.deepEqual(classifyMessageUrl("javascript:alert(1)"), {
    kind: "blocked",
  });
  assert.deepEqual(classifyMessageUrl("data:text/html,<script>1</script>"), {
    kind: "blocked",
  });
});

test("react-markdown transform never promotes a file or active URL into an image", () => {
  assert.equal(
    transformMessageUrl("https://example.com/image.png", "src"),
    "https://example.com/image.png",
  );
  assert.equal(
    transformMessageUrl("file:///Users/sun/work/image.png", "src"),
    "",
  );
  assert.equal(transformMessageUrl("javascript:alert(1)", "href"), "");
  assert.equal(
    transformMessageUrl("file:///Users/sun/work/a.ts", "href"),
    "file:///Users/sun/work/a.ts",
  );
});

test("Mermaid follows the Raft strict renderer and isolates generated SVG with CSP", () => {
  assert.deepEqual(mermaidConfiguration.securityLevel, "strict");
  assert.equal(mermaidConfiguration.htmlLabels, false);
  assert.equal(mermaidConfiguration.startOnLoad, false);

  const document = buildMermaidDocument(
    '<svg viewBox="0 0 120 80"><text>safe</text></svg>',
  );
  assert.match(document, /default-src 'none'/u);
  assert.match(document, /style-src 'unsafe-inline'/u);
  assert.match(document, /img-src data:/u);
  assert.match(document, /<svg viewBox="0 0 120 80">/u);
  assert.doesNotMatch(document, /allow-scripts/u);
});
