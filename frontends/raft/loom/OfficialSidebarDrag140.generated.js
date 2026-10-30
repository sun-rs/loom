// GENERATED from the complete pinned Web1.21.40 distribution. Declaration/callback bodies unchanged.
import * as K from "react";
import * as q from "react/jsx-runtime";
import {
  useSortable as it,
  SortableContext as we,
  verticalListSortingStrategy as oe,
} from "@dnd-kit/sortable";
import {
  useDndContext as Nn,
  useDroppable as mn,
  pointerWithin as dr,
  closestCenter as mt,
  MeasuringStrategy as Hn,
} from "@dnd-kit/core";
import { CSS as ar } from "@dnd-kit/utilities";
import { SidebarSectionDisclosure as ws } from "raft-ui";
function T5(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return typeof t.containerId == `string`
    ? t.type === `container`
      ? typeof t.kind == `string` && typeof t.manual == `boolean`
      : t.type === `item` && typeof t.itemId == `string`
    : !1;
}
function D5(e, t) {
  for (let [n, r] of Object.entries(e)) if (r.includes(t)) return n;
  return null;
}
function rit(e, t) {
  let n = 1 / 0,
    r = -1 / 0,
    i = -1 / 0,
    a = 1 / 0;
  for (let e of t)
    ((n = Math.min(n, e.top)),
      (r = Math.max(r, e.right)),
      (i = Math.max(i, e.bottom)),
      (a = Math.min(a, e.left)));
  return e.x >= a && e.x <= r && e.y >= n && e.y <= i;
}
function iit(e, t, n, r) {
  if (n == null) return null;
  let i = 0;
  for (let { data: a, rect: o } of r)
    o &&
      T5(a) &&
      a.type === `item` &&
      a.containerId === e &&
      a.itemId !== t &&
      (o.top + o.bottom) / 2 < n &&
      (i += 1);
  return i;
}
const oit = `sidebarDropIndex`;
function ait(e, t) {
  let n = e?.find((e) => e.id === t)?.data?.[oit];
  return typeof n == `number` ? n : null;
}
function sit(e, t, n) {
  return (e ? D5(e, n) : null) ?? (t ? D5(t, n) : null);
}
function cit(e, t, n) {
  return e ? Math.max(t ?? 0, n) : null;
}
function lit(e, t) {
  return e || t !== null;
}
function uit(e, t, n, r) {
  let i = D5(e, t);
  if (!i || !e[n]) return e;
  let a = e[i],
    o = a.indexOf(t);
  if (o === -1) return e;
  let s = a.filter((e) => e !== t),
    c = i === n ? s : e[n].filter((e) => e !== t),
    l = Math.max(0, Math.min(Math.trunc(r), c.length));
  if (i === n && o === l) return e;
  let u = [...c];
  return (
    u.splice(l, 0, t),
    { ...e, ...(i === n ? { [i]: u } : { [i]: s, [n]: u }) }
  );
}
function Dit(e, t) {
  return e < t ? `before` : `after`;
}
function Nit(e, t = !1) {
  return !e || t ? e : { ...e, x: 0 };
}
function Mit(e, t = !1) {
  return Nit(e, t);
}
function Oit({ id: e, containerId: t, children: n }) {
  let r = (0, K.useMemo)(
      () => ({ type: `item`, itemId: e, containerId: t }),
      [t, e],
    ),
    {
      attributes: i,
      listeners: a,
      setNodeRef: o,
      transform: s,
      transition: c,
      isDragging: l,
    } = it({ id: e, data: r }),
    u = {
      transform: ar.Transform.toString(Nit(s, !0)),
      transition: c,
      opacity: l ? 0.12 : 1,
      zIndex: l ? 10 : void 0,
    };
  return (0, q.jsx)(`div`, {
    ref: o,
    style: u,
    ...i,
    ...a,
    "data-sidebar-drag-item": e,
    className: `relative cursor-grab active:cursor-grabbing`,
    children: n,
  });
}
function kit({ projection: e }) {
  let { droppableContainers: t, measureDroppableContainers: n } = Nn(),
    r = (0, K.useEffectEvent)(() => {
      n([...t.keys()]);
    });
  return (
    (0, K.useLayoutEffect)(() => {
      e && r();
    }, [e]),
    null
  );
}
const Ait = `before:pointer-events-none before:absolute before:inset-y-0 before:left-2 before:right-[max(0px,calc(8px-var(--scrollbar-size,0px)))] before:-z-10 before:rounded-control before:bg-fill-medium`;
function R5({ id: e, kind: t, manual: n, itemIds: r, children: i, empty: a }) {
  let o = (0, K.useMemo)(
      () => ({ type: `container`, containerId: e, kind: t, manual: n }),
      [e, t, n],
    ),
    { setNodeRef: s, isOver: c, active: l } = mn({ id: e, data: o }),
    u = l?.data.current,
    d = T5(u) && u.type === `item`,
    f = (0, K.useRef)(null),
    p = (0, K.useRef)(null),
    m = (0, K.useCallback)(
      (e) => {
        ((f.current = e), s(e));
      },
      [s],
    );
  return (
    (0, K.useLayoutEffect)(() => {
      let e = f.current;
      if (!e || !lit(d, p.current)) return;
      let t = cit(d, p.current, e.getBoundingClientRect().height);
      t !== p.current &&
        ((p.current = t), (e.style.minHeight = t === null ? `` : `${t}px`));
    }),
    (0, q.jsx)(we, {
      items: r,
      strategy: oe,
      children: (0, q.jsx)(`div`, {
        ref: m,
        "data-sidebar-dnd-container": e,
        className: `relative isolate flex flex-col gap-0.5 py-2 ${a ? `min-h-7` : ``} ${c ? Ait : ``}`,
        children: i,
      }),
    })
  );
}
const jit = (0, K.createContext)(null);
function z5({ id: e, testId: t, order: n, children: r }) {
  let {
      attributes: i,
      listeners: a,
      setActivatorNodeRef: o,
      setNodeRef: s,
      transform: c,
      transition: l,
      isDragging: u,
    } = it({ id: e }),
    d = {
      transform: ar.Transform.toString(Mit(c)),
      transition: l,
      opacity: u ? 0.6 : 1,
      zIndex: u ? 10 : void 0,
      order: n,
    },
    f = (0, K.useMemo)(
      () => ({ attributes: i, listeners: a, setActivatorNodeRef: o }),
      [i, a, o],
    );
  return (0, q.jsx)(jit.Provider, {
    value: f,
    children: (0, q.jsx)(`div`, {
      ref: s,
      style: d,
      "data-testid": t,
      children: r,
    }),
  });
}
function H5({ children: e, sectionKey: t, onToggleSection: n, ...r }) {
  let i = (0, K.useContext)(jit),
    a = (0, K.useCallback)(() => n(t), [n, t]);
  return (0, q.jsx)(ws, {
    ref: i?.setActivatorNodeRef,
    render: (0, q.jsx)(`button`, { type: `button` }),
    className: `cursor-default`,
    ...i?.attributes,
    ...i?.listeners,
    ...r,
    onClick: a,
    children: e,
  });
}
function N5({ children: e, className: t = ``, tone: n = `muted`, ...r }) {
  return (0, q.jsx)(`div`, {
    ...r,
    "data-sidebar-section-description": ``,
    className: `px-5 font-sans text-footnote ${n === `strong` ? `text-foreground` : n === `subtle` ? `text-foreground-hint` : `text-foreground-muted`} ${t}`,
    children: e,
  });
}
const Fit = { droppable: { strategy: Hn.Always } };
export {
  Oit as NativeSidebarDragItem,
  R5 as NativeSidebarDropList,
  kit as NativeSidebarDragMeasure,
  z5 as NativeSidebarDragSection,
  H5 as NativeSidebarSectionToggle,
  D5 as findSidebarDragContainer,
  ait as sidebarDropIndex,
  Fit as nativeSidebarMeasuring,
};
export function nativeSidebarAlgorithms({
  canDrop: Fa,
  sectionIds: he,
  projectionRef: Et,
  startRef: Tt,
  base: Oa,
}) {
  const collision = (e) => {
    let t = String(e.active.id);
    e.pointerCoordinates?.x;
    let n = e.pointerCoordinates?.y;
    if (he.includes(t))
      return mt({
        ...e,
        droppableContainers: e.droppableContainers.filter((e) =>
          he.includes(String(e.id)),
        ),
      });
    let r = e.droppableContainers.filter((e) => {
        let n = e.data.current;
        return T5(n) ? Fa(t, n.containerId) : !1;
      }),
      i = { ...e, droppableContainers: r },
      a = dr(i),
      o = a.find(
        (e) => r.find((t) => t.id === e.id)?.data.current?.type === `item`,
      );
    if (o) return [o];
    if (a.length > 0) {
      let r = e.droppableContainers.map((t) => ({
        data: t.data.current,
        rect: e.droppableRects.get(t.id),
      }));
      return a.map((e) => ({
        ...e,
        data: { ...e.data, [oit]: iit(String(e.id), t, n, r) },
      }));
    }
    if (
      !e.pointerCoordinates ||
      !rit(e.pointerCoordinates, e.droppableRects.values())
    )
      return mt(i);
    let s = sit(Et.current, Tt.current, t);
    return s ? [{ id: s }] : [];
  };
  const project = (e, t, n, r) => {
    let i = e.data.current,
      a = t.data.current;
    if (!T5(i) || i.type !== `item` || !T5(a) || !Fa(i.itemId, a.containerId))
      return n;
    let o = n[a.containerId];
    if (!o) return n;
    let s = r ?? o.length;
    if (a.type === `item` && a.itemId !== i.itemId) {
      let r = o.filter((e) => e !== i.itemId).indexOf(a.itemId);
      if (r === -1) return n;
      let c = e.rect.current.translated ?? e.rect.current.initial;
      s =
        r +
        +(
          Dit(
            c ? c.top + c.height / 2 : t.rect.top,
            t.rect.top + t.rect.height / 2,
          ) === `after`
        );
    } else if (a.type === `item`) return n;
    else if (o.includes(i.itemId)) return n;
    return uit(n, i.itemId, a.containerId, s);
  };
  return { collision, project };
}
export function NativePinnedEmptyHint() {
  const r = () => "将频道或私信拖到这里置顶";
  return (0, q.jsx)(N5, {
    "data-testid": `sidebar-pinned-empty-hint`,
    tone: `subtle`,
    className: `mb-1 min-h-9 py-1.5 transition-colors`,
    children: (0, q.jsx)(`span`, {
      className: `block whitespace-normal break-words`,
      children: r({ id: `layout.sidebar.pinnedEmptyHint` }),
    }),
  });
}
export function NativeSidebarDragLabel({ activeId: xt, labels: Da }) {
  return (0, q.jsx)(`div`, {
    "data-testid": `sidebar-drag-overlay`,
    className: `max-w-72 truncate rounded-control bg-layer-popover px-2.5 py-2 font-sans text-subhead font-medium text-foreground shadow-float ring-1 ring-line-seam`,
    children: Da.get(xt).label,
  });
}
