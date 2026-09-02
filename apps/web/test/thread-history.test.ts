import assert from "node:assert/strict";
import test from "node:test";

import type { MessageSession } from "@rah-os/client-core";

import { loadThreadHistoryPages } from "../src/thread-history.ts";

function sessionWithEarlierPages(pageCount: number) {
  let remaining = pageCount;
  let messages: Array<{ messageId: string }> = [];
  return {
    get state() {
      return {
        complete: true,
        cursorAfter: 9,
        cursorBefore: remaining,
        hasEarlier: remaining > 0,
        messages,
      };
    },
    async loadEarlier() {
      remaining -= 1;
      messages = [{ messageId: `page-${String(remaining)}` }, ...messages];
      return { ...this.state, pages: 1 };
    },
  } as unknown as Pick<MessageSession, "loadEarlier" | "state">;
}

test("Thread history loads one older page without claiming the beginning", async () => {
  const result = await loadThreadHistoryPages(sessionWithEarlierPages(3), {
    limit: 50,
  });
  assert.equal(result.pages, 1);
  assert.equal(result.hasEarlier, true);
});

test("manual Thread history paging never carries a hidden hydration cap", async () => {
  const session = sessionWithEarlierPages(101);
  let result = await loadThreadHistoryPages(session, { limit: 50 });
  for (let page = 1; page < 101; page += 1)
    result = await loadThreadHistoryPages(session, { limit: 50 });
  assert.equal(result.hasEarlier, false);
  assert.equal(result.messages.length, 101);
});
