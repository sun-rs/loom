import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildMermaidDocument,
  classifyMessageUrl,
  mermaidConfiguration,
  splitBareCjkAutolinks,
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

test("long message URLs use one continuous Raft-style underline", () => {
  const css = readFileSync(
    new URL("../src/product.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.rah-message-markdown a,[\s\S]*?text-decoration-skip-ink:\s*none;/u,
  );
});

test("bare ASCII URLs stop before adjacent CJK text", () => {
  const url =
    "https://raft.build/zh-cn/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/";
  const paragraph = {
    children: [
      {
        children: [{ type: "text", value: `${url}这篇文章的逻辑是什么？` }],
        type: "link",
        url: `${url}这篇文章的逻辑是什么？`,
      },
    ],
    type: "paragraph",
  };

  splitBareCjkAutolinks({ children: [paragraph], type: "root" });

  assert.deepEqual(paragraph.children, [
    {
      children: [{ type: "text", value: url }],
      type: "link",
      url,
    },
    { type: "text", value: "这篇文章的逻辑是什么？" },
  ]);
});
