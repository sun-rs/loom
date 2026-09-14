import assert from "node:assert/strict";
import test from "node:test";
import { chatMessageDateLabel } from "../src/chat-timeline-presentation.ts";
import { formatChatMessageTime } from "../src/date-time-presentation.ts";
import {
  getLocalDaySnapshot,
  subscribeToLocalDay,
} from "../src/chat-calendar-clock.ts";

test("message dates follow calendar days, including month/year and DST boundaries", () => {
  const now = new Date("2026-09-14T00:00:00+08:00");
  assert.equal(
    chatMessageDateLabel("2026-09-14T00:00:00+08:00", now, "Asia/Shanghai"),
    "",
  );
  assert.equal(
    chatMessageDateLabel("2026-09-13T00:00:00+08:00", now, "Asia/Shanghai"),
    "昨天",
  );
  assert.equal(
    chatMessageDateLabel("2026-09-02T22:39:00+08:00", now, "Asia/Shanghai"),
    "09/02",
  );
  assert.equal(
    chatMessageDateLabel(
      "2025-12-31T23:59:00+08:00",
      new Date("2026-01-01T00:00:00+08:00"),
      "Asia/Shanghai",
    ),
    "昨天",
  );
  assert.equal(
    chatMessageDateLabel(
      "2025-12-30T23:59:00+08:00",
      new Date("2026-01-01T00:00:00+08:00"),
      "Asia/Shanghai",
    ),
    "2025/12/30",
  );
  assert.equal(
    chatMessageDateLabel(
      "2024-02-29T00:00:00Z",
      new Date("2024-03-01T00:00:00Z"),
      "UTC",
    ),
    "昨天",
  );
  assert.equal(
    chatMessageDateLabel(
      "2026-11-01T00:01:00-04:00",
      new Date("2026-11-02T00:01:00-05:00"),
      "America/New_York",
    ),
    "昨天",
  );
  assert.equal(
    chatMessageDateLabel("2026-09-13T16:01:00Z", now, "Asia/Shanghai"),
    "",
  );
  assert.equal(chatMessageDateLabel("invalid", now), "");
});

test("date prefixes preserve the shared 12/24 hour preference", () => {
  const now = new Date("2026-09-14T00:00:00Z");
  assert.equal(
    formatChatMessageTime("2026-09-02T22:39:00Z", now, "24", "UTC"),
    "09/02 22:39",
  );
  assert.match(
    formatChatMessageTime("2026-09-13T13:07:00Z", now, "12", "UTC"),
    /^昨天 .*01:07/u,
  );
  assert.equal(formatChatMessageTime("invalid", now), "invalid");
});

test("mounted timestamps update together exactly at midnight and release their shared timer", (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date(2026, 8, 14, 23, 59, 59, 990),
  });
  let first = 0,
    second = 0;
  const offFirst = subscribeToLocalDay(() => first++);
  const offSecond = subscribeToLocalDay(() => second++);
  try {
    assert.equal(getLocalDaySnapshot(), "2026-09-14");
    t.mock.timers.tick(9);
    assert.equal(first, 0);
    t.mock.timers.tick(1);
    assert.equal(getLocalDaySnapshot(), "2026-09-15");
    assert.equal(first, 1);
    assert.equal(second, 1);
    t.mock.timers.tick(60_000);
    assert.equal(
      first,
      1,
      "same-day calibration must not notify message subscribers",
    );
    offFirst();
    t.mock.timers.tick(86_400_000);
    assert.equal(first, 1);
    assert.equal(second, 2);
    offSecond();
    t.mock.timers.tick(86_400_000);
    assert.equal(second, 2);
  } finally {
    offFirst();
    offSecond();
    t.mock.timers.reset();
  }
});
