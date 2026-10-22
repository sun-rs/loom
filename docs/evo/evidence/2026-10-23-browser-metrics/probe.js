(() => {
  const start = performance.now(),
    events = [],
    longTasks = [];
  const sample = new URL(location.href).searchParams.get("sample") || "manual";
  let ready = false,
    pending;
  performance.setResourceTimingBufferSize(3000);
  try {
    new PerformanceObserver((l) =>
      longTasks.push(
        ...l
          .getEntries()
          .map((x) => ({ start: x.startTime, duration: x.duration })),
      ),
    ).observe({ type: "longtask", buffered: true });
  } catch {}
  const send = (kind, data) =>
    fetch("/bench-result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, sample, ...data }),
    });
  const shown = (selector) => {
    const el = document.querySelector(selector);
    return !!el && el.checkVisibility({ checkVisibilityCSS: true });
  };
  function check() {
    if (
      !ready &&
      document.querySelector('[data-testid="composer-textarea"]') &&
      document.querySelector("[data-message-id]") &&
      !document.querySelector('main [role="alert"]')
    ) {
      ready = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const readyMs = performance.now();
          setTimeout(() => {
            const resources = performance
              .getEntriesByType("resource")
              .filter((x) => !x.name.includes("/bench-"));
            send("load", {
              readyMs,
              visibility: document.visibilityState,
              nav: performance
                .getEntriesByType("navigation")
                .map((x) => x.toJSON()),
              paint: performance
                .getEntriesByType("paint")
                .map((x) => x.toJSON()),
              resources: resources.map((x) => ({
                url: new URL(x.name).pathname,
                transfer: x.transferSize,
                encoded: x.encodedBodySize,
                decoded: x.decodedBodySize,
                duration: x.duration,
              })),
              longTasks,
            }).then(
              () => (document.documentElement.dataset.benchComplete = "true"),
            );
          }, 400);
        }),
      );
    }
    if (pending && shown(pending.selector)) {
      const p = pending;
      pending = null;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          send("click", {
            label: p.label,
            duration: performance.now() - p.at,
            visibility: document.visibilityState,
          }),
        ),
      );
    }
  }
  const targets = {
    Agent: '[data-testid="loom-agent-page"]',
    计算机: '[data-testid="loom-computers-page"]',
    任务: '[data-testid="loom-tasks-page"]',
    记忆: '[data-testid="loom-memory-page"]',
    设置: '[data-testid="loom-settings-page"]',
    频道: '[data-testid="composer-textarea"]',
  };
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest("button");
      if (!el) return;
      const label = el.getAttribute("aria-label") || el.textContent.trim();
      const selector = targets[label];
      if (selector && !shown(selector))
        pending = { label, selector, at: performance.now() };
    },
    true,
  );
  new MutationObserver(check).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("visibilitychange", () =>
    send("visibility", {
      state: document.visibilityState,
      time: performance.now(),
    }),
  );
  setTimeout(
    () => send("minute", { longTasks, visibility: document.visibilityState }),
    60000,
  );
  check();
})();
