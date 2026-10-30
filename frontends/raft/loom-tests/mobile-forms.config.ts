import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: { alias: { "@botiverse/raft-ui": "raft-ui" } },
  test: {
    environment: "jsdom",
    include: [
      "loom-tests/mobile-forms.dom.test.tsx",
      "loom-tests/avatar-picker.dom.test.tsx",
      "loom-tests/adaptive-layout.dom.test.tsx",
    ],
    maxWorkers: 1,
  },
});
