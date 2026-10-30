// Runs unchanged in either browser document. Geometry, not labels/business state.
export function readSidebarSpacing(root) {
  const scroll = root.querySelector(".scrollbar-list") ?? root;
  const top = scroll.getBoundingClientRect().top;
  const visible = (selector) =>
    [...root.querySelectorAll(selector)].filter(
      (el) => el.getBoundingClientRect().height > 0,
    );
  const rect = (el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return {
      top: r.top - top,
      bottom: r.bottom - top,
      height: r.height,
      paddingTop: parseFloat(s.paddingTop),
      paddingBottom: parseFloat(s.paddingBottom),
    };
  };
  const headers = visible(
    '[data-slot="sidebar-section-header"], [data-slot="sidebar-group-label"]',
  );
  const rows = visible('[data-slot="sidebar-item"]');
  const groups = visible(
    '[data-testid^="sidebar-agent-machine-group-toggle-"]',
  );
  const lists = [...new Set(rows.map((row) => row.parentElement))];
  return {
    headers: headers.map(rect),
    rows: rows.map(rect),
    groups: groups.map(rect),
    withinListGaps: lists.flatMap((list) => {
      const cells = [...list.children].filter((child) =>
        child.matches('[data-slot="sidebar-item"]'),
      );
      return cells
        .slice(1)
        .map((cell, i) => rect(cell).top - rect(cells[i]).bottom);
    }),
    titleToFirstRow: headers.flatMap((header) => {
      const h = rect(header),
        nextHeader = headers.find((item) => rect(item).top > h.top),
        boundary = nextHeader ? rect(nextHeader).top : Infinity;
      const group = groups.find(
        (item) => rect(item).top >= h.bottom && rect(item).top < boundary,
      );
      const row = rows.find(
        (item) => rect(item).top >= h.bottom && rect(item).top < boundary,
      );
      return row && !group ? [rect(row).top - h.bottom] : [];
    }),
    groupToFirstRow: groups.flatMap((group) => {
      const g = rect(group),
        row = rows.find((item) => rect(item).top >= g.bottom);
      return row ? [rect(row).top - g.bottom] : [];
    }),
    betweenComputerGroups: groups.slice(1).map((group) => {
      const g = rect(group),
        row = rows.filter((item) => rect(item).bottom <= g.top).at(-1);
      return row ? g.top - rect(row).bottom : null;
    }),
    rowToFollowingHeader: headers.flatMap((header) => {
      const h = rect(header),
        previous = rows.filter((row) => rect(row).bottom <= h.top).at(-1);
      if (
        !previous ||
        headers.some(
          (other) =>
            rect(other).top >= rect(previous).bottom && rect(other).top < h.top,
        )
      )
        return [];
      return [h.top - rect(previous).bottom + h.paddingTop];
    }),
  };
}
