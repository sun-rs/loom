import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ToastProvider, toast } from "raft-ui";
import { useMobileActivitySwipe as useOfficialRowSwipe } from "../loom/MobileActivitySwipe.generated";
import { useActivitySwipeUndo } from "../loom/useActivitySwipeUndo";
import type { DiscoveryRow } from "../loom/discovery-client";
const row = {
  id: "isolated-row",
  activityFrontier: { throughSeq: 42 },
  message: { roomId: "isolated-room" },
} as DiscoveryRow;
function TouchRow({ done }: { done: () => void }) {
  const gesture = useOfficialRowSwipe({
    enabled: true,
    actionsWidth: 72,
    open: false,
    onOpenChange: () => {},
    onFullSwipe: done,
    haptics: false,
  } as any);
  return (
    <div ref={gesture.ref} {...gesture.handlers} data-testid="touch-row">
      Isolated fixture row
    </div>
  );
}
function Harness({
  commit,
  frontier = 42,
}: {
  commit: (row: DiscoveryRow) => void;
  frontier?: number;
}) {
  const current = { ...row, activityFrontier: { throughSeq: frontier } };
  const undo = useActivitySwipeUndo([current], commit);
  return (
    <ToastProvider>
      <div>
        {undo.hidden !== row.id && <TouchRow done={() => undo.done(current)} />}
      </div>
    </ToastProvider>
  );
}
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.restoreAllMocks();
});
function pointer(element: Element, type: string, x: number, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  fireEvent(element, event);
}
async function fullSwipe() {
  const element = screen.getByTestId("touch-row");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
    top: 0,
    bottom: 72,
    height: 72,
    x: 0,
    y: 0,
    toJSON() {},
  });
  pointer(element, "pointerdown", 300);
  pointer(element, "pointermove", 260);
  pointer(element, "pointermove", 0);
  pointer(element, "pointerup", 0);
  await waitFor(() => expect(screen.queryByTestId("touch-row")).toBeNull());
}
test("real React gesture and official toast undo restore row without a durable request", async () => {
  const commit = vi.fn();
  render(<Harness commit={commit} />);
  await fullSwipe();
  expect(commit).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
  await waitFor(() => expect(screen.getByTestId("touch-row")).toBeTruthy());
  expect(commit).not.toHaveBeenCalled();
});
test("cancelling the native gesture never opens undo or submits", async () => {
  const commit = vi.fn();
  render(<Harness commit={commit} />);
  const element = screen.getByTestId("touch-row");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
  } as DOMRect);
  pointer(element, "pointerdown", 300);
  pointer(element, "pointermove", 260);
  pointer(element, "pointermove", 0);
  pointer(element, "pointercancel", 0);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 230));
  });
  expect(screen.getByTestId("touch-row")).toBeTruthy();
  expect(commit).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
});

test("official toast dismissal submits once, cleanup does not repeat the request", async () => {
  const commit = vi.fn();
  const view = render(<Harness commit={commit} />);
  await fullSwipe();
  await act(async () => toast.dismiss());
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0][0].activityFrontier.throughSeq).toBe(42);
  view.unmount();
  expect(commit).toHaveBeenCalledTimes(1);
});
test("a newer activity frontier cancels deferred completion in a real React update", async () => {
  const commit = vi.fn();
  const view = render(<Harness commit={commit} />);
  await fullSwipe();
  view.rerender(<Harness commit={commit} frontier={43} />);
  await waitFor(() => expect(screen.getByTestId("touch-row")).toBeTruthy());
  await act(async () => toast.dismiss());
  view.unmount();
  expect(commit).not.toHaveBeenCalled();
});

import { IntlProvider } from "react-intl";
import ActivityMessageRow from "../loom/ActivityMessageRow";
import { useActivitySwipe } from "../loom/useActivitySwipe";
const completeRow = {
  ...row,
  label: "Isolated activity",
  roomName: "fixture",
  senderName: "Human",
  activityKind: "channel",
  message: {
    ...row.message,
    body: "Isolated content",
    createdAt: "2026-10-26T00:00:00.000Z",
  },
} as DiscoveryRow;
function FullRowHarness({
  commit,
  open,
  mute,
  unfollow,
  pending = false,
}: {
  commit: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  unfollow: ReturnType<typeof vi.fn>;
  pending?: boolean;
}) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const swipe = useActivitySwipe(true, viewport);
  const undo = useActivitySwipeUndo([completeRow], commit);
  return (
    <IntlProvider
      locale="en"
      messages={{ "thread.row.markAsDone": "Mark done" }}
    >
      <ToastProvider>
        <div ref={viewport}>
          {undo.hidden !== row.id && (
            <ActivityMessageRow
              client={{ request: vi.fn() } as any}
              row={completeRow}
              active={false}
              pending={pending}
              onOpen={open}
              onAction={commit}
              onFollow={() => {}}
              swipe={swipe}
              onSwipeDone={undo.done}
              onSwipeMute={mute}
              onSwipeUnfollow={unfollow}
            />
          )}
        </div>
      </ToastProvider>
    </IntlProvider>
  );
}
function coarse() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(max-width: 767px)" || query === "(pointer: coarse)",
      addEventListener() {},
      removeEventListener() {},
    })),
  });
}
test("complete production row: touch completion does not open conversation; Undo restores native content", async () => {
  coarse();
  const commit = vi.fn(),
    open = vi.fn();
  render(
    <FullRowHarness
      commit={commit}
      open={open}
      mute={vi.fn()}
      unfollow={vi.fn()}
    />,
  );
  const element = screen.getByTestId("inbox-row");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
  } as DOMRect);
  pointer(element, "pointerdown", 300);
  pointer(element, "pointermove", 260);
  pointer(element, "pointermove", 0);
  pointer(element, "pointerup", 0);
  await waitFor(() => expect(screen.queryByTestId("inbox-row")).toBeNull());
  expect(commit).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
  await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeTruthy());
  expect(screen.getByText("Isolated content")).toBeTruthy();
  expect(commit).not.toHaveBeenCalled();
});
test("complete production row secondary buttons select only their callback and pending disables gestures", () => {
  coarse();
  const commit = vi.fn(),
    open = vi.fn(),
    mute = vi.fn(),
    unfollow = vi.fn();
  const view = render(
    <FullRowHarness
      commit={commit}
      open={open}
      mute={mute}
      unfollow={unfollow}
    />,
  );
  fireEvent.click(screen.getByTestId("inbox-row-swipe-mute"));
  expect(mute).toHaveBeenCalledTimes(1);
  expect(unfollow).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("inbox-row-swipe-unfollow"));
  expect(unfollow).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  view.rerender(
    <FullRowHarness
      commit={commit}
      open={open}
      mute={mute}
      unfollow={unfollow}
      pending
    />,
  );
  expect(screen.queryByTestId("inbox-row-swipe-actions")).toBeNull();
  expect(screen.getByTestId("inbox-row-done").hasAttribute("disabled")).toBe(
    true,
  );
});

test("native start swipe calls read action once, never Done, and preserves edge arbitration", async () => {
  const { useMobileActivitySwipe } =
    await import("../loom/MobileActivitySwipe.generated");
  const read = vi.fn(),
    done = vi.fn();
  function Row() {
    const g = useMobileActivitySwipe({
      enabled: true,
      actionsWidth: 144,
      open: false,
      onOpenChange: () => {},
      onStartSwipe: read,
      onFullSwipe: done,
    });
    return <div ref={g.ref} {...g.handlers} data-testid="start-row" />;
  }
  render(<Row />);
  const el = screen.getByTestId("start-row");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
  } as DOMRect);
  pointer(el, "pointerdown", 2);
  pointer(el, "pointermove", 50);
  pointer(el, "pointermove", 390);
  pointer(el, "pointerup", 390);
  expect(read).not.toHaveBeenCalled();
  pointer(el, "pointerdown", 50);
  pointer(el, "pointermove", 85);
  pointer(el, "pointermove", 360);
  pointer(el, "pointerup", 360);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(done).not.toHaveBeenCalled();
  expect(el.getAttribute("data-swipe-side")).toBe("start");
});

function touch(el: HTMLElement, type: string, x: number, y: number, count = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", {
    value:
      type === "touchend" || type === "touchcancel"
        ? []
        : Array.from({ length: count }, (_, identifier) => ({
            identifier,
            clientX: x,
            clientY: y,
          })),
  });
  fireEvent(el, e);
  return e;
}
async function pullHarness() {
  const { useMobilePullRefresh } = await import("../loom/useMobilePullRefresh");
  const refresh = vi.fn();
  let setLoading: (v: boolean) => void = () => {};
  function Harness() {
    const ref = React.useRef<HTMLDivElement>(null),
      [loading, set] = React.useState(false);
    setLoading = set;
    const pull = useMobilePullRefresh(ref, true, loading, () => {
      refresh();
      set(true);
    });
    return (
      <div
        ref={ref}
        data-testid="pull"
        data-distance={pull.distance}
        data-pending={pull.pending}
      />
    );
  }
  render(<Harness />);
  const el = screen.getByTestId("pull");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
  } as DOMRect);
  Object.defineProperty(el, "clientHeight", { value: 600 });
  return { el, refresh, setLoading };
}
test("pull at top refreshes once, holds60 and clears after success or failure settles", async () => {
  const { el, refresh, setLoading } = await pullHarness();
  touch(el, "touchstart", 100, 0);
  expect(touch(el, "touchmove", 102, 250).defaultPrevented).toBe(true);
  touch(el, "touchend", 102, 250);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(el.dataset.distance).toBe("60");
  touch(el, "touchstart", 100, 0);
  touch(el, "touchmove", 100, 260);
  touch(el, "touchend", 100, 260);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => setLoading(false));
  expect(el.dataset.pending).toBe("false");
  expect(el.dataset.distance).toBe("0");
});
test("pull ignores horizontal swipes, scrolled lists, edge gestures, cancellation and short pulls", async () => {
  const { el, refresh } = await pullHarness();
  touch(el, "touchstart", 100, 0);
  expect(touch(el, "touchmove", 200, 30).defaultPrevented).toBe(false);
  touch(el, "touchend", 200, 300);
  el.scrollTop = 12;
  touch(el, "touchstart", 100, 0);
  touch(el, "touchmove", 100, 300);
  touch(el, "touchend", 100, 300);
  el.scrollTop = 0;
  touch(el, "touchstart", 2, 0);
  touch(el, "touchmove", 2, 300);
  touch(el, "touchend", 2, 300);
  touch(el, "touchstart", 100, 0);
  touch(el, "touchmove", 100, 300);
  touch(el, "touchcancel", 100, 300);
  touch(el, "touchstart", 100, 0);
  touch(el, "touchmove", 100, 30);
  touch(el, "touchend", 100, 30);
  expect(refresh).not.toHaveBeenCalled();
  expect(el.dataset.distance).toBe("0");
});

test("instant refresh settlement clears pull even when React batches away loading=true", async () => {
  const { useMobilePullRefresh } = await import("../loom/useMobilePullRefresh");
  function Instant() {
    const ref = React.useRef<HTMLDivElement>(null),
      [completed, setCompleted] = React.useState(0);
    const p = useMobilePullRefresh(
      ref,
      true,
      false,
      () => setCompleted((v) => v + 1),
      completed,
    );
    return <div ref={ref} data-testid="instant" data-pending={p.pending} />;
  }
  render(<Instant />);
  const el = screen.getByTestId("instant");
  Object.defineProperty(el, "clientHeight", { value: 600 });
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    width: 390,
  } as DOMRect);
  touch(el, "touchstart", 100, 0);
  touch(el, "touchmove", 100, 260);
  touch(el, "touchend", 100, 260);
  await waitFor(() => expect(el.dataset.pending).toBe("false"));
});
