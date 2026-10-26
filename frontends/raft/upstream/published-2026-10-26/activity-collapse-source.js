function SKe(e) {
  let t = _E.getState();
  return e === `activityList` ? t.activityListHidden : t.sidebarHidden;
}
function h$(e, t) {
  let n = _E.getState();
  e === `activityList` ? n.setActivityListHidden(t) : n.setSidebarHidden(t);
}
function g$(e) {
  return _E((t) =>
    e === `activityList` ? t.activityListHidden : t.sidebarHidden,
  );
}
function CKe(e = document, t = `sidebar`) {
  _$(t, !SKe(t), e);
}
function _$(e, t, n = document) {
  if (t) {
    let e = n.getElementById(p$);
    e && e.contains(n.activeElement) && n.getElementById(m$)?.focus();
  }
  h$(e, t);
}
function kKe({ column: e }) {
  let { formatMessage: t } = W(),
    n = g$(e),
    r = t({
      id: n
        ? `layout.leftRail.expandSidebar`
        : `layout.leftRail.collapseSidebar`,
    });
  return (0, X.jsx)(GN, {
    content: (0, X.jsxs)(`span`, {
      className: `flex items-center gap-2`,
      children: [
        r,
        (0, X.jsx)(Iu, { "aria-hidden": `true`, children: nze(void 0, t) }),
      ],
    }),
    contentProps: b$.right,
    children: (0, X.jsx)(ete, {
      render: (0, X.jsx)(jc, {
        className: `size-10 [@media(max-height:600px)]:h-9 [@media(max-height:600px)]:w-9`,
      }),
      id: m$,
      "aria-label": r,
      "aria-keyshortcuts": rze(),
      title: void 0,
      "data-testid": `left-rail-sidebar-toggle`,
      children: (0, X.jsx)(jl, {
        children: n
          ? (0, X.jsx)(ae, { size: 18, "aria-hidden": `true` })
          : (0, X.jsx)(ve, { size: 18, "aria-hidden": `true` }),
      }),
    }),
  });
}
