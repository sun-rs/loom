import assert from "node:assert/strict";
import test from "node:test";
import { readUiSource as read } from "./ui-source.ts";

test("empty Thread uses the upstream centered message icon and display title", () => {
  const source = read("components/conversation-panes.tsx");
  const css = read("product.css");
  assert.match(
    source,
    /<EmptyState\s+context="thread"\s+placement="fill"\s+icon="chat"\s+title="暂无回复"/u,
  );
  assert.match(source, /rah-thread-empty-body/u);
  assert.match(
    css,
    /\.rah-thread-empty-body\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/su,
  );
  assert.doesNotMatch(css, /\.rah-thread-empty-replies/u);
});

test("reaction placement uses the official right edge, four pixel gap and eight pixel viewport gutter", () => {
  const source = read("components/discovery-filter.tsx");
  assert.match(
    source,
    /variant === "status" \|\| variant === "reaction" \? 8 : 12/u,
  );
  assert.match(
    source,
    /variant === "status" \|\| variant === "reaction" \? 4 : 8/u,
  );
  assert.match(
    source,
    /variant === "reaction" \|\|[\s\S]*?origin\.right - popup\.width/u,
  );
});

test("Thread and file actions expose the official locate/follow glyphs", () => {
  const source = read("components/conversation-panes.tsx");
  assert.match(source, /<Icon name="map-pin" \/> 在频道中查看/u);
  assert.match(
    source,
    /displayedFollowing\s*\? "message-circle-off"\s*: "message-circle-plus"/u,
  );
  assert.match(
    read("components/room-files.tsx"),
    /onClick=\{onSource\}[\s\S]*?<Icon name="map-pin"/u,
  );
});
