// GENERATED: unchanged Raft 1.21.34 mobile row gesture and recipes.
import * as q from 'react';
import * as _t from 'react-dom';
var jt = 400,
  Mt = 100,
  Nt = 2e3;
function Pt(e) {
  let t = null,
    n = window.setTimeout(() => o(), Nt),
    r = (e) => {
      (o(), e.preventDefault(), e.stopPropagation());
    },
    i = (t) => {
      t !== e && o();
    },
    a = () => {
      t === null && (t = window.setTimeout(() => o(), jt));
    };
  function o() {
    (window.clearTimeout(n),
      t !== null && window.clearTimeout(t),
      document.removeEventListener(`click`, r, !0),
      document.removeEventListener(`pointerdown`, i, !0),
      document.removeEventListener(`pointerup`, a, !0),
      document.removeEventListener(`pointercancel`, a, !0));
  }
  (document.addEventListener(`click`, r, !0),
    document.addEventListener(`pointerdown`, i, !0),
    document.addEventListener(`pointerup`, a, !0),
    document.addEventListener(`pointercancel`, a, !0));
}
var Ft = `data-row-swipe-action`,
  It = `--row-swipe-reveal`;
function Lt(e, t, n = !1, r = !1) {
  let i = Math.abs(e),
    a = Math.abs(t);
  return n
    ? i >= 10 || a >= 10
      ? `release`
      : `undecided`
    : a >= 10 && i <= 2 * a
      ? `release`
      : i < 20 || i <= 2 * a
        ? `undecided`
        : e < 0 || r
          ? `claim`
          : `release`;
}
function Rt(e, t) {
  return t > 0 && e >= t * 0.6;
}
function zt(e, t, n, r) {
  return Rt(e, n)
    ? `full`
    : t >= 800
      ? `open`
      : t <= -800
        ? `close`
        : e > 0 && e >= r * 0.5
          ? `open`
          : `close`;
}
function Bt() {
  typeof navigator < `u` &&
    typeof navigator.vibrate == `function` &&
    navigator.vibrate(10);
}
function Vt() {
  return (
    typeof window < `u` &&
    typeof window.matchMedia == `function` &&
    window.matchMedia(`(prefers-reduced-motion: reduce)`).matches
  );
}
function Ht({
  enabled: e,
  actionsWidth: t,
  open: n,
  onOpenChange: r,
  onFullSwipe: i,
  shouldYield: a,
  onFull: o,
  haptics: s = !0,
}) {
  let c = (0, q.useRef)(null),
    l = (0, q.useRef)(null),
    u = (0, q.useRef)(0),
    d = (0, q.useRef)(null),
    f = (0, q.useRef)(!1),
    p = (0, q.useRef)(0),
    m = (0, q.useRef)({
      open: n,
      actionsWidth: t,
      onOpenChange: r,
      onFullSwipe: i,
      shouldYield: a,
      onFull: o,
      haptics: s,
    });
  (0, q.useEffect)(() => {
    m.current = {
      open: n,
      actionsWidth: t,
      onOpenChange: r,
      onFullSwipe: i,
      shouldYield: a,
      onFull: o,
      haptics: s,
    };
  });
  let h = (0, q.useCallback)((e, t, n = !1) => {
      u.current = e;
      let r = c.current;
      r &&
        (r.style.setProperty(It, `${e}px`),
        t ? r.setAttribute(`data-swipe`, t) : r.removeAttribute(`data-swipe`),
        n
          ? r.setAttribute(`data-swipe-full`, `true`)
          : r.removeAttribute(`data-swipe-full`));
    }, []),
    g = (0, q.useCallback)(() => {
      d.current !== null &&
        (window.clearTimeout(d.current), (d.current = null));
    }, []),
    _ = (0, q.useCallback)(() => {
      ((d.current = null),
        f.current &&
          ((f.current = !1),
          (0, _t.flushSync)(() => m.current.onFullSwipe()),
          h(0, null)));
    }, [h]),
    v = (0, q.useCallback)(
      (e) => {
        g();
        let t = e > 0 ? `open` : null;
        Vt()
          ? h(e, t)
          : (h(e, `settling`),
            (d.current = window.setTimeout(() => {
              ((d.current = null), h(e, t));
            }, 200)));
      },
      [g, h],
    ),
    ee = (0, q.useCallback)(
      (e) => {
        (g(),
          (f.current = !0),
          Vt()
            ? _()
            : (h(e, `settling`, !0), (d.current = window.setTimeout(_, 200))));
      },
      [g, _, h],
    );
  return (
    (0, q.useEffect)(() => {
      n ||
        l.current?.decision === `claim` ||
        f.current ||
        (u.current > 0 && v(0));
    }, [n, v]),
    (0, q.useEffect)(
      () => () => {
        (d.current !== null && window.clearTimeout(d.current),
          f.current && ((f.current = !1), m.current.onFullSwipe()));
      },
      [],
    ),
    {
      ref: (0, q.useCallback)((e) => {
        c.current = e;
      }, []),
      handlers: {
        onPointerDown: (0, q.useCallback)(
          (t) => {
            if (!e || t.pointerType !== `touch` || !t.isPrimary || f.current)
              return;
            p.current = 0;
            let n = t.currentTarget.getBoundingClientRect(),
              r = t.clientX - n.left,
              i = n.right - t.clientX;
            l.current = {
              pointerId: t.pointerId,
              startX: t.clientX,
              startY: t.clientY,
              width: n.width,
              startsInEdgeZone: r < 24 || i < 24,
              wasOpen: m.current.open && u.current > 0,
              decision: `undecided`,
              claimX: t.clientX,
              baseReveal: u.current,
              reveal: u.current,
              full: !1,
              samples: [{ t: t.timeStamp, x: t.clientX }],
            };
          },
          [e],
        ),
        onPointerMove: (0, q.useCallback)(
          (e) => {
            let t = l.current;
            if (!t || t.pointerId !== e.pointerId || t.decision === `release`)
              return;
            if (t.decision === `undecided`) {
              if (m.current.shouldYield?.()) {
                t.decision = `release`;
                return;
              }
              if (
                ((t.decision = Lt(
                  e.clientX - t.startX,
                  e.clientY - t.startY,
                  t.startsInEdgeZone,
                  t.wasOpen,
                )),
                t.decision !== `claim`)
              )
                return;
              (g(), (t.claimX = e.clientX), (t.baseReveal = u.current));
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
            }
            ((t.reveal = Math.min(
              Math.max(t.baseReveal + t.claimX - e.clientX, 0),
              t.width,
            )),
              t.samples.push({ t: e.timeStamp, x: e.clientX }),
              t.samples.length > 8 && t.samples.shift());
            let n = Rt(t.reveal, t.width);
            (n && !t.full && (m.current.haptics && Bt(), m.current.onFull?.()),
              (t.full = n),
              h(t.reveal, `dragging`, n));
          },
          [g, h],
        ),
        onPointerUp: (0, q.useCallback)(
          (e) => {
            let t = l.current;
            if (!t || t.pointerId !== e.pointerId) return;
            if (((l.current = null), t.decision !== `claim`)) {
              let n =
                e.target instanceof Element &&
                e.target.closest(`[data-row-swipe-action]`) !== null;
              t.decision === `undecided` &&
                t.wasOpen &&
                !n &&
                ((p.current = Date.now() + jt), m.current.onOpenChange(!1));
              return;
            }
            p.current = Date.now() + jt;
            let n = t.samples.filter((t) => e.timeStamp - t.t <= Mt)[0],
              r = n ? e.timeStamp - n.t : 0,
              i = n && r > 0 ? ((n.x - e.clientX) / r) * 1e3 : 0,
              { actionsWidth: a, onOpenChange: o } = m.current,
              s = zt(t.reveal, i, t.width, a);
            s === `full`
              ? (o(!1), ee(t.width))
              : s === `open`
                ? (v(a), o(!0))
                : (v(0), o(!1));
          },
          [ee, v],
        ),
        onPointerCancel: (0, q.useCallback)(
          (e) => {
            let t = l.current;
            t &&
              t.pointerId === e.pointerId &&
              ((l.current = null),
              (t.decision === `claim` || t.wasOpen) &&
                (v(0), m.current.onOpenChange(!1)));
          },
          [v],
        ),
        onClickCapture: (0, q.useCallback)((e) => {
          Date.now() >= p.current ||
            ((p.current = 0), e.preventDefault(), e.stopPropagation());
        }, []),
      },
    }
  );
}
var an = 10,
  on = `group-data-[unread=true]/inbox-item:text-foreground`,
  sn = [
    `[touch-action:pan-y] supports-[touch-action:pan-y_pinch-zoom]:[touch-action:pan-y_pinch-zoom] overflow-hidden`,
    `[&>*:not([data-row-swipe-layer])]:[transform:translateX(calc(-1*var(--row-swipe-reveal,0px)))]`,
    `data-[swipe=settling]:[&>*]:transition-[transform,width] data-[swipe=settling]:[&>*]:duration-200 data-[swipe=settling]:[&>*]:ease-out`,
    `motion-reduce:[&>*]:transition-none`,
  ].join(` `),
  cn = `pointer-events-none absolute inset-y-0 right-0 z-20 flex w-[var(--row-swipe-reveal,0px)] justify-end overflow-hidden`,
  ln = [
    `pointer-events-auto flex h-full min-w-0 shrink-0 grow basis-[72px] flex-col items-center justify-center gap-1 overflow-hidden`,
    `text-caption font-semibold whitespace-nowrap outline-none`,
    `transition-[flex-basis,flex-grow] duration-150 ease-out motion-reduce:transition-none`,
    `[&>svg]:size-[18px] [&>svg]:shrink-0`,
  ].join(` `),
  un = `${ln} bg-success text-sticker-ink`,
  dn = [
    ln,
    `bg-fill-muted text-foreground`,
    `group-data-[swipe-full=true]/inbox-item:grow-0 group-data-[swipe-full=true]/inbox-item:basis-0`,
  ].join(` `),
  fn = [
    `sr-only`,
    `has-[:focus-visible]:top-1/2 has-[:focus-visible]:right-0 has-[:focus-visible]:-translate-y-1/2`,
    `has-[:focus-visible]:m-0 has-[:focus-visible]:size-auto has-[:focus-visible]:overflow-visible`,
    `has-[:focus-visible]:whitespace-normal has-[:focus-visible]:[clip-path:none] has-[:focus-visible]:[clip:auto]`,
    `has-[:focus-visible]:bg-layer-canvas`,
  ].join(` `);
export {Ht as useOfficialRowSwipe,Pt as suppressNextSwipeClick,Lt as decideSwipe,Rt as isFullSwipe,zt as settleSwipe,sn as swipeRowClass,cn as swipeLayerClass,un as swipeDoneClass,dn as swipeSecondaryClass,fn as swipeAccessibleActionClass};
