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
import { useOfficialRowSwipe } from "../loom/OfficialActivitySwipe.generated";
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
