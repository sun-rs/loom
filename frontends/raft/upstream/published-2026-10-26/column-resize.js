// Official production function bodies, formatted only. Bindings listed in manifest.json.
import * as Y from "react";
import * as X from "react/jsx-runtime";
import {useIntl as W} from "react-intl";
import {currentColumnRegistry as yF} from "../../loom/current-column-registry.js";
const Ty = Y.useLayoutEffect;
function oOe(e, t, n, r = 360) {
  let { min: i, max: a } = yF[e],
    o = Math.floor(t + Math.max(0, n - r));
  return Math.max(i, Math.min(a, o));
}
function bF(e, t) {
  let { min: n, max: r } = yF[e];
  return Math.round(Math.max(n, Math.min(r, t)));
}
function xF(e, t, n) {
  let r = e.slice(0, t).reduce((e, t) => e + t.width, 0),
    i = e.slice(t + 1).reduce((e, t) => e + t.min, 0);
  return n + r + i;
}
function sOe(e, t, n = 360) {
  return t.map((r, i) => Math.max(r.min, Math.min(r.width, e - xF(t, i, n))));
}
function cOe(e, t, n, r = 360) {
  return sOe(
    e,
    n > 0 && e - t.min >= r + n ? [t, { width: n, min: n }] : [t],
    r,
  )[0];
}
function lOe(e, t, n) {
  return Math.max(n, Math.floor(e * t));
}
function uOe(e, t = 360) {
  return e.map((n, r) => ({
    "--column-width": `${n.width}px`,
    "--column-min": `${n.min}px`,
    "--column-allowance": `${xF(e, r, t)}px`,
  }));
}
var SF = new Map(),
  CF = new Set();
function wF() {
  try {
    return typeof localStorage > `u` ? null : localStorage;
  } catch {
    return null;
  }
}
function TF(e) {
  if (e === null || e.trim() === ``) return null;
  let t = Number(e);
  return Number.isFinite(t) ? t : null;
}
function EF(e, t) {
  let { storageKey: n, legacyStorageKeys: r } = yF[t],
    i = TF(e.getItem(n));
  if (i !== null) return i;
  for (let t of r) {
    let n = TF(e.getItem(t));
    if (n !== null) return n;
  }
  return null;
}
function dOe(e) {
  let { defaultWidth: t } = yF[e],
    n = wF();
  if (!n) return t;
  try {
    let r = EF(n, e);
    return r === null ? t : bF(e, r);
  } catch {
    return t;
  }
}
var DF = !1;
function fOe() {
  if (DF) return;
  DF = !0;
  let e = wF();
  if (e)
    try {
      for (let t of Object.keys(yF)) {
        let { storageKey: n, legacyStorageKeys: r } = yF[t];
        if (r.length === 0) continue;
        let i = EF(e, t);
        i !== null && e.getItem(n) === null && e.setItem(n, String(bF(t, i)));
        for (let t of r) e.removeItem(t);
      }
    } catch {}
}
function OF() {
  for (let e of CF) e();
}
function kF(e) {
  let t = SF.get(e);
  return (t === void 0 && ((t = dOe(e)), SF.set(e, t)), t);
}
function AF(e, t) {
  let n = bF(e, t);
  return (SF.get(e) !== n && (SF.set(e, n), OF()), n);
}
function pOe(e, t) {
  AF(e, t);
}
function jF(e, t = kF(e)) {
  let n = AF(e, t);
  try {
    wF()?.setItem(yF[e].storageKey, String(n));
  } catch {}
}
function mOe(e) {
  jF(e, yF[e].defaultWidth);
}
function MF(e) {
  if (e.storageArea !== wF()) return;
  let t = Object.keys(yF).filter(
    (t) => e.key === null || yF[t].storageKey === e.key,
  );
  if (t.length !== 0) {
    for (let e of t) SF.delete(e);
    OF();
  }
}
function hOe(e) {
  return (
    fOe(),
    CF.size === 0 &&
      typeof window < `u` &&
      window.addEventListener(`storage`, MF),
    CF.add(e),
    () => {
      (CF.delete(e),
        CF.size === 0 &&
          typeof window < `u` &&
          window.removeEventListener(`storage`, MF));
    }
  );
}
function NF(e) {
  return (0, Y.useSyncExternalStore)(
    hOe,
    () => kF(e),
    () => yF[e].defaultWidth,
  );
}
var gOe = {
    right: `-right-1.5 pointer-coarse:-right-3 before:right-1/2`,
    left: `-left-1.5 pointer-coarse:-left-3 before:left-1/2`,
  },
  _Oe = `before:inset-y-0 before:w-px hover:before:bg-foreground-muted data-[dragging=true]:before:bg-foreground-muted data-[highlight]:before:bg-foreground-muted focus-visible:keyboard:before:w-0.5 focus-visible:keyboard:before:bg-foreground`,
  vOe = { sm: `hidden sm:block`, md: `hidden md:block`, lg: `hidden lg:block` },
  yOe = {
    sidebar: `layout.columnResize.sidebar`,
    list: `layout.columnResize.list`,
    thread: `layout.columnResize.thread`,
    detail: `layout.columnResize.detail`,
    workspaceTree: `layout.columnResize.workspaceTree`,
    sideCards: `layout.columnResize.sideCards`,
  };
function PF(e) {
  return e.getBoundingClientRect().width;
}
function FF(e) {
  for (let t = e; t?.parentElement; t = t.parentElement) {
    let e = null;
    for (let n of Array.from(t.parentElement.children))
      n !== t &&
        n instanceof HTMLElement &&
        n.hasAttribute(`data-main-column`) &&
        PF(n) > 0 &&
        (!e || PF(n) > PF(e)) &&
        (e = n);
    if (e) return e;
  }
  return null;
}
function bOe(e, t) {
  let n = 0;
  for (let r of Array.from(
    t.parentElement?.querySelectorAll(`[data-gives-way]`) ?? [],
  ))
    r.contains(e) || e.contains(r) || (n += PF(r));
  return n;
}
function IF(e, t, n, r = FF) {
  let i = yF[e],
    a = i.max;
  if (i.growsToMainMin && t) {
    let n = PF(t),
      i = n > 0 ? r(t) : null;
    i && (a = oOe(e, n, PF(i) + bOe(t, i)));
  }
  return n === void 0 ? a : Math.max(i.min, Math.min(a, n));
}
function LF({
  column: e,
  edge: t,
  visibleFrom: n,
  maxWidth: r,
  className: i = ``,
  label: a,
  source: o,
  mainColumn: s = FF,
  highlight: c,
  snap: l,
  "data-testid": u,
}) {
  let { formatMessage: d } = W(),
    f = NF(e),
    p = o ? o.width : f,
    m = o ? o.min : yF[e].min,
    h = (t) => (o ? Math.max(o.min, Math.min(yF[e].max, t)) : bF(e, t)),
    g = () => (o ? o.get() : kF(e)),
    _ = (t) => (o ? o.preview(t) : pOe(e, t)),
    v = (t) => (o ? o.commit(t) : jF(e, t)),
    y = () => (o ? o.reset() : mOe(e)),
    b = IF(e, null, r),
    x = (0, Y.useRef)(null),
    S = (0, Y.useRef)(null);
  (0, Y.useEffect)(() => () => S.current?.(), []);
  let C = (0, Y.useRef)(l);
  C.current = l;
  let [w, T] = (0, Y.useState)(!1),
    E = (0, Y.useRef)(null),
    D = (0, Y.useId)(),
    [O, k] = (0, Y.useState)(void 0),
    [A, j] = (0, Y.useState)(null),
    [M, N] = (0, Y.useState)(null);
  Ty(() => {
    let t = E.current?.parentElement;
    if (!t) return;
    ((t.id ||= D), k(t.id));
    let n = typeof ResizeObserver > `u` ? null : new ResizeObserver(() => a()),
      i = null,
      a = () => {
        let a = PF(t);
        (j(a > 0 ? Math.round(a) : null), N(a > 0 ? IF(e, t, r, s) : null));
        let o = yF[e].growsToMainMin === !0 && a > 0 ? s(t) : null;
        n && o !== i && (i && n.unobserve(i), o && n.observe(o), (i = o));
      };
    if ((a(), n)) return (n.observe(t), () => n.disconnect());
  }, [D, e, r, s]);
  let P = M ?? b,
    F = t === `right` ? 1 : -1,
    I = (e) => {
      let t = e.parentElement?.getBoundingClientRect().width;
      return h(t && t > 0 ? t : g());
    },
    ee = (t) => IF(e, t.parentElement, r, s),
    L = (e, t) => {
      let n = C.current;
      return n ? n.onSnappedChange(e, t) !== !1 : !1;
    },
    R = (e) => {
      let t = x.current;
      if (!t) return;
      let n = t.startWidth + F * (e - t.startX),
        r = C.current?.kind,
        i = r === `focus` ? n > t.max + 40 : r === `collapse` && n < m - 40;
      (i !== t.snapped && L(i, `pointer`) && (t.snapped = i),
        _(t.snapped ? t.restoreWidth : Math.max(m, Math.min(t.max, n))));
    },
    z = () => {
      (S.current?.(),
        (S.current = null),
        x.current && ((x.current = null), T(!1), v()));
    };
  return (0, X.jsx)(`div`, {
    ref: E,
    role: `separator`,
    "aria-orientation": `vertical`,
    "aria-label": a ?? d({ id: yOe[e] }),
    "aria-valuenow": Math.min(P, h(A ?? p)),
    "aria-controls": O,
    "aria-valuemin": m,
    "aria-valuemax": P,
    tabIndex: 0,
    "data-slot": `column-resize-handle`,
    "data-dragging": w ? `true` : void 0,
    "data-highlight": c,
    "data-testid": u,
    className:
      `absolute top-0 bottom-0 z-10 w-3 cursor-col-resize touch-none select-none outline-none pointer-coarse:w-6 before:pointer-events-none before:absolute before:bg-transparent before:transition-colors before:content-[''] ${_Oe} ${gOe[t]} ${n ? vOe[n] : ``} ${i}`.trim(),
    onPointerDown: (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      let t = e.currentTarget,
        n = l?.snapped === !0,
        r = ee(t),
        i = Math.min(r, I(t));
      (N(r),
        (x.current = {
          startX: e.clientX,
          startWidth: i,
          max: r,
          restoreWidth: g(),
          snapped: n,
        }),
        T(!0),
        t.setPointerCapture?.(e.pointerId),
        S.current?.());
      let a = e.pointerId,
        o = (e) => {
          e.pointerId === a && R(e.clientX);
        },
        s = (e) => {
          e.pointerId === a && z();
        };
      (window.addEventListener(`pointermove`, o),
        window.addEventListener(`pointerup`, s),
        window.addEventListener(`pointercancel`, s),
        window.addEventListener(`blur`, z),
        (S.current = () => {
          (window.removeEventListener(`pointermove`, o),
            window.removeEventListener(`pointerup`, s),
            window.removeEventListener(`pointercancel`, s),
            window.removeEventListener(`blur`, z));
        }));
    },
    onLostPointerCapture: () => {
      x.current?.snapped || z();
    },
    onKeyDown: (e) => {
      let t = e.shiftKey ? 64 : 16,
        n = ee(e.currentTarget);
      if (e.key === `Enter`) {
        if (!l) return;
        (e.preventDefault(), L(!l.snapped, `keyboard`));
        return;
      }
      if (l?.snapped) return;
      let r;
      if (e.key === `ArrowRight`) r = I(e.currentTarget) + F * t;
      else if (e.key === `ArrowLeft`) r = I(e.currentTarget) - F * t;
      else if (e.key === `Home`) r = m;
      else if (e.key === `End`) r = n;
      else return;
      (e.preventDefault(), N(n), v(Math.max(m, Math.min(n, r))));
    },
    onDoubleClick: y,
  });
}

export {LF as CurrentColumnResize, NF as useCurrentColumnWidth, oOe as measuredColumnMax};
