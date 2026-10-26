import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    environment: "jsdom",
    include: ["loom-tests/activity-swipe.dom.test.tsx"],
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
