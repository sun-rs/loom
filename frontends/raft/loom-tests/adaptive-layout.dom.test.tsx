import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives";
import { layoutQueries, adaptiveLayout } from "../loom/adaptive-layout";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("live touch window changes retain mounted draft and selection while navigation crosses only 840", () => {
  let width = 390,
    touch = true;
  const subscriptions = new Map<(e: { matches: boolean }) => void, string>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      const p = adaptiveLayout(width, touch);
      return query === layoutQueries.dual
        ? p.dual
        : query === layoutQueries.single
          ? !p.dual
          : p.compactDensity;
    },
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
      subscriptions.set(fn, query),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
      subscriptions.delete(fn),
  }));
  function Surface() {
    const dual = useMediaQuery(layoutQueries.dual),
      compact = useMediaQuery(layoutQueries.compactDensity);
    return (
      <div>
        <nav>{dual ? "rail" : "bottom"}</nav>
        <output>{compact ? "compact" : "web"}</output>
        <textarea aria-label="draft" defaultValue="" />
        <input aria-label="selected" defaultValue="room-1" />
      </div>
    );
  }
  const view = render(<Surface />);
  const draft = screen.getByLabelText("draft");
  fireEvent.change(draft, { target: { value: "保留草稿" } });
  draft.focus();
  for (const w of [768, 820, 839, 840, 1024, 1200, 820, 390]) {
    act(() => {
      width = w;
      subscriptions.forEach((query, fn) =>
        fn({ matches: window.matchMedia(query).matches }),
      );
    });
    expect(screen.getByRole("navigation").textContent).toBe(
      w >= 840 ? "rail" : "bottom",
    );
    expect(screen.getByRole("status").textContent).toBe("compact");
    expect(screen.getByLabelText("draft")).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("保留草稿");
    expect(document.activeElement).toBe(draft);
  }
  act(() => {
    width = 820;
    touch = false;
    subscriptions.forEach((query, fn) =>
      fn({ matches: window.matchMedia(query).matches }),
    );
  });
  expect(screen.getByRole("navigation").textContent).toBe("rail");
  expect(screen.getByRole("status").textContent).toBe("web");
  view.unmount();
  expect(subscriptions.size).toBe(0);
});
