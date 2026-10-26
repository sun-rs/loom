# 固定发布资源核对摘录
格式化只用于阅读；原始下载URL与SHA256见 sources.json。下列行号属于本次格式化副本，不冒充上游TypeScript行号。

## SearchOverlay-DpGPHO_W-readable.js:1
```js
import { r as e } from "./rolldown-runtime-hePW80VL.js";
import { _ as t, m as n } from "./vendor-react-B99DtKrr.js";
import { Gt as r, Wt as i, fu as a, ql as o } from "./app-shell-BWgtfY02.js";
import { w as s } from "./vendor-startup-M8uDWb77.js";
import { Jl as c, yu as l } from "./vendor-raft-ui-C1zpV14y.js";
import u from "./MessageSearchPage-B7MQRg0I.js";
var d = e(t(), 1),
  f = n(),
  p = `↑`,
  m = `↓`,
  h = `↵`;
function g(e) {
  e.stopPropagation();
}
function _(e) {
  let [t, n] = (0, d.useState)(null);
  return (
    (0, d.useLayoutEffect)(() => {
      if (o()) return;
      let t = e?.current;
      if (!t) return;
      let i = () => {
        let e = r(t.getBoundingClientRect());
        n((t) => (t && t.top === e.top ? t : e));
      };
      i();
      let a = typeof ResizeObserver > `u` ? null : new ResizeObserver(i);
      return (
        a?.observe(t),
        window.addEventListener(`resize`, i),
        () => {
          (a?.disconnect(), window.removeEventListener(`resize`, i));
        }
      );
    }, [e]),
    t
  );
}
function v({ onClose: e, contentColumnRef: t }) {
  let { formatMessage: n } = s(),
    r = _(t);
  return (
    (0, d.useEffect)(() => {
      let t = (t) => {
        t.key === `Escape` &&
          (t.defaultPrevented || t.isComposing || t.keyCode === 229 || e());
      };
      return (
        document.addEventListener(`keydown`, t),
        () => document.removeEventListener(`keydown`, t)
      );
    }, [e]),
    (0, f.jsx)(a, {
      onClose: e,
      closeOnBackdrop: !0,
      closeOnEscape: !1,
      layer: 1,
      children: (0, f.jsxs)(c, {
        role: `dialog`,
        "aria-modal": `true`,
        "data-testid": `desktop-search-overlay`,
        className: `min-h-0`,
        style: i(r),
        onMouseDown: g,
        children: [
          (0, f.jsx)(u, { activateResultsInChat: !0, overlayChrome: !0 }),
          (0, f.jsxs)(`div`, {
            "data-testid": `desktop-search-overlay-footer`,
            className: `flex shrink-0 items-center gap-4 border-t border-line-seam px-3 py-2 text-caption text-foreground-hint`,
            children: [
              (0, f.jsxs)(`span`, {
                className: `flex items-center gap-1`,
                children: [
                  (0, f.jsx)(l, { "aria-hidden": `true`, children: p }),
                  (0, f.jsx)(l, { "aria-hidden": `true`, children: m }),
                  (0, f.jsx)(`span`, {
                    children: n({ id: `search.overlay.footerSelect` }),
                  }),
                ],
              }),
              (0, f.jsxs)(`span`, {
                className: `flex items-center gap-1`,
                children: [
                  (0, f.jsx)(l, { "aria-hidden": `true`, children: h }),
                  (0, f.jsx)(`span`, {
                    children: n({ id: `search.overlay.footerOpen` }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    })
  );
}
export { v as default };
```

## MessageSearchPage-B7MQRg0I-readable.js:2328
```js
    }, []),
    yo = (0, O.useCallback)((e) => {
      (tr(e.currentTarget.value), ui(!1));
    }, []),
    bo = (0, O.useCallback)(() => {
      (Ce.getState().clear(), tr(``));
    }, []),
    xo = (0, O.useMemo)(() => {
      if (!u) return null;
      if (u.kind === `dm`) {
        let e = b.find((e) => e.id === u.id);
        return `@${e?.peerDisplayName || e?.peerName || e?.name || a({ id: `search.channel` })}`;
      }
      return `#${y.find((e) => e.id === u.id)?.name ?? a({ id: `search.channel` })}`;
    }, [y, b, a, u]),
    So = t
      ? a({ id: `search.overlay.placeholder` })
      : xo
        ? a({ id: `search.scoped.placeholder` }, { conversation: xo })
        : a({ id: `search.placeholder` }, { shortcutHint: G ? `` : Gn }).trim(),
    Co = (0, O.useCallback)(() => {
      if (!v) return;
      let e = L.trim();
      de(e ? `/s/${v}/search?q=${encodeURIComponent(e)}` : `/s/${v}/search`);
    }, [de, L, v]),
    wo = (0, z.jsxs)(Gt, {
      className: `min-w-0 flex-1`,
      children: [
```

## MessageSearchPage-B7MQRg0I-readable.js:2970
```js
      (0, z.jsxs)(Ot, {
        ref: ln,
        onScroll: wn,
        className: `min-h-0 flex-1 overflow-y-auto`,
        children: [
          (0, z.jsx)(ee, { pull: uo }),
          u
            ? (0, z.jsx)(Dt, {
                className: `pt-2`,
                children: (0, z.jsxs)(nn, {
                  type: `button`,
                  "data-testid": `search-everywhere`,
                  onClick: Co,
                  children: [
                    (0, z.jsx)(sn, {
                      children: (0, z.jsx)(Bt, {
                        children: (0, z.jsx)(Qe, {
                          size: 14,
                          "aria-hidden": `true`,
                        }),
                      }),
                    }),
                    (0, z.jsxs)($t, {
                      children: [
                        (0, z.jsx)(Wt, {
                          children: (0, z.jsx)(un, {
                            children: L.trim()
                              ? a(
                                  { id: `search.scoped.everywhereFor` },
                                  { query: L.trim() },
                                )
                              : a({ id: `search.scoped.everywhere` }),
                          }),
                        }),
                        (0, z.jsx)(Kt, {
                          children: a({ id: `search.scoped.everywhereHint` }),
                        }),
                      ],
                    }),
                  ],
                }),
              })
            : null,
          !Fi && u
            ? (0, z.jsx)(o, {
                className: `py-16`,
                icon: (0, z.jsx)(Qe, { size: 36, "aria-hidden": `true` }),
                title: a(
                  { id: `search.scoped.emptyTitle` },
                  { conversation: xo },
                ),
                description: a({ id: `search.scoped.emptyBody` }),
              })
            : !Fi &&
              (Ii
                ? oa.length > 0
```

## TasksPanel-ChzWhoKN-readable.js:2737
```js
                t({ id: `task.board.newTask` }),
              ],
            }),
          (0, F.jsxs)(we, {
            value: it,
            onValueChange: ht,
            "aria-label": t({ id: `task.viewAria` }),
            iconsOnlyBelow: `md`,
            className: `@min-md/tasks:ml-auto`,
            children: [
              (0, F.jsxs)(Ye, {
                value: `board`,
                "data-testid": `channel-task-view-board`,
                children: [
                  (0, F.jsx)(me, { size: 16, "aria-hidden": `true` }),
                  (0, F.jsx)(Ee, { children: t({ id: `task.view.board` }) }),
                ],
              }),
              (0, F.jsxs)(Ye, {
                value: `list`,
                "data-testid": `channel-task-view-list`,
                children: [
                  (0, F.jsx)(fe, { size: 16, "aria-hidden": `true` }),
                  (0, F.jsx)(Ee, { children: t({ id: `task.view.list` }) }),
                ],
              }),
            ],
          }),
        ],
      }),
    });
  return (0, F.jsxs)(Ie, {
    className: `flex min-h-0 flex-1 flex-col`,
    "data-testid": n ? `channel-task-panel` : void 0,
```

## AgentDetailPanel-CnHZV8Ck-readable.js:11210
```js
                      ],
                    }),
                  (0, $.jsxs)(`div`, {
                    className: `flex items-start gap-4 px-5 py-5`,
                    children: [
                      e.managedByAppInstallId
                        ? (0, $.jsx)(De, {
                            context: `profile-hero`,
                            type: `agent`,
                            agentAvatarUrl:
                              e.managedByApp?.logoUrl ?? e.avatarUrl,
                          })
                        : se
                          ? (0, $.jsx)(U, {
                              content: o({ id: `agent.detail.changeAvatar` }),
                              children: (0, $.jsxs)(`button`, {
                                type: `button`,
                                "aria-label": o({
                                  id: `agent.detail.changeAvatar`,
                                }),
                                "data-testid": `agent-change-avatar`,
                                onClick: rn,
                                className: Hl,
                                children: [
                                  (0, $.jsx)(De, {
                                    context: `profile-hero`,
                                    type: `agent`,
                                    agentAvatarUrl: e.avatarUrl,
                                  }),
                                  (0, $.jsx)(La, { icon: sr }),
                                ],
                              }),
                            })
                          : bn(e.avatarUrl) && !e.deletedAt
                            ? (0, $.jsx)(U, {
                                content: o({ id: `agent.detail.viewAvatar` }),
                                children: (0, $.jsx)(`button`, {
                                  type: `button`,
                                  onClick: ln,
                                  className: Hl,
                                  "aria-label": o({
                                    id: `agent.detail.viewAvatar`,
                                  }),
                                  children: (0, $.jsx)(De, {
                                    context: `profile-hero`,
                                    type: `agent`,
                                    agentAvatarUrl: e.avatarUrl,
                                  }),
                                }),
                              })
                            : (0, $.jsx)(De, {
                                context: `profile-hero`,
                                type: `agent`,
                                agentAvatarUrl: e.avatarUrl,
                                className: e.deletedAt
                                  ? `grayscale opacity-60`
                                  : void 0,
                              }),
                      (0, $.jsxs)(`div`, {
                        className: `min-w-0 flex-1 pt-1`,
                        children: [
                          (0, $.jsx)(`div`, {
                            className: `flex min-w-0 items-center gap-2`,
                            children: (0, $.jsx)(Kl, {
                              agent: e,
                              onEdit:
                                se && !e.deletedAt && !e.managedByAppInstallId
                                  ? an
                                  : void 0,
                            }),
                          }),
                          (0, $.jsxs)(`div`, {
                            className: `truncate text-mono-meta ${yn} text-foreground-hint`,
                            title: `@${e.name}`,
                            children: [`@`, e.name],
                          }),
                          (0, $.jsxs)(`div`, {
                            className: `mt-2 flex min-w-0 flex-wrap items-center gap-1.5`,
                            children: [
                              (0, $.jsx)(X, {
                                appearance: `outline`,
                                children: o({
                                  id: `sidebar.findConversationAgentTag`,
                                }),
                              }),
                              !S &&
                                e.runtime &&
                                !e.managedByAppInstallId &&
                                (0, $.jsxs)(X, {
                                  appearance: `soft`,
                                  variant: `information`,
                                  className: Ul,
                                  "data-testid": `agent-profile-runtime-chip`,
                                  children: [
                                    (0, $.jsx)(Dr, {
                                      size: 14,
                                      "aria-hidden": `true`,
                                    }),
                                    We(e.runtime),
                                  ],
                                }),
                            ],
                          }),
                          !e.deletedAt &&
                            he &&
                            (0, $.jsx)(`div`, {
                              className: `mt-1.5 min-w-0`,
                              children: (0, $.jsx)(nt, {}),
                            }),
                          !e.deletedAt &&
                            !e.managedByAppInstallId &&
                            !he &&
                            (0, $.jsx)(`div`, {
                              className: `mt-1.5 min-w-0`,
                              children: (0, $.jsx)(Xl, {
                                agentId: e.id,
                                fallbackStatus: e.status,
                                showDetail: B,
                                externalStatus: C ? ie : void 0,
                                onStop: z ? Ut : void 0,
                              }),
                            }),
                        ],
                      }),
                    ],
                  }),
```

## MachineDetailPanel-DYB7F72N-readable.js:2140
```js
        (0, q.jsx)(xe, {
          title: e.name,
          icon: (0, q.jsx)(Xe, { size: 18 }),
          iconAlwaysVisible: !0,
          onMobileBack: _e,
          mobileBackProps: vn,
        }),
      (0, q.jsxs)(`div`, {
        className: `flex-1 overflow-y-auto bg-layer-canvas`,
        children: [
          (0, q.jsxs)(`div`, {
            className: `flex items-start gap-4 px-5 py-5`,
            children: [
              (0, q.jsx)(tt, {
                size: `lg`,
                children: (0, q.jsx)(Xe, { "aria-hidden": `true` }),
              }),
              (0, q.jsxs)(`div`, {
                className: `min-w-0 flex-1 stack-y-1`,
                children: [
                  (0, q.jsx)(ht, { className: `min-w-0`, children: e.name }),
                  (0, q.jsx)(`div`, {
                    className: `flex min-w-0 items-center gap-2`,
                    children: (0, q.jsxs)(rt, {
                      appearance: `soft`,
                      variant:
                        e.status === `online`
                          ? `success`
                          : qt
                            ? `primary`
                            : `muted`,
                      className: `shrink-0`,
                      children: [
                        (0, q.jsx)(it, {
                          size: `md`,
                          variant:
                            e.status === `online`
                              ? `success`
                              : qt
                                ? `primary`
                                : `default`,
                          "aria-hidden": `true`,
                        }),
                        (0, q.jsx)(`span`, {
                          "data-testid": `machine-connection-status`,
                          children:
                            e.status === `online`
                              ? o({ id: `machine.detail.connected` })
                              : o(
                                  qt
                                    ? {
```

## EditChannelDialog-djVCk2XF-readable.js:1878
```js
      G.deleteChannels &&
      (J
        ? (0, A.jsx)(Ee, {
            icon: (0, A.jsx)(Re, { size: 16 }),
            label: _({ id: `channel.edit.disconnectChannel` }),
            onClick: Qr,
            danger: !0,
            className: `[&_[data-slot=button-content]]:justify-center`,
            testId: `channel-settings-delete-action`,
          })
        : (0, A.jsx)(Ee, {
            icon: (0, A.jsx)(je, { size: 16 }),
            label: _({ id: `channel.edit.deleteChannel` }),
            onClick: Qr,
            danger: !0,
            className: `[&_[data-slot=button-content]]:justify-center`,
            testId: `channel-settings-delete-action`,
          })),
    xi = (0, A.jsx)(i, {
      channelId: e,
      isPanel: mi,
      activityMute: ve,
      collapseLongMessages: De,
    }),
    Si =
```

## settings-readable.js:10988
```js
function bl() {
  return (0, $.jsxs)($.Fragment, {
    children: [(0, $.jsx)(tt, {}), (0, $.jsx)(Tl, {}), (0, $.jsx)(xl, {})],
  });
}
function xl() {
  let { formatMessage: e } = K(),
    t = at(),
    n = B((e) => e.current),
    r = (0, Q.useCallback)(() => t.toSettings(`server-notifications`), [t]);
  return n
    ? (0, $.jsx)(Ii, {
        className: `mt-4`,
        children: (0, $.jsxs)(ea, {
          variant: `plain`,
          onClick: r,
          "data-testid": `settings-server-notifications-link`,
          children: [
            (0, $.jsx)(ka, {
              children: (0, $.jsx)(Oi, {
                children: e(
                  { id: `settings.notifications.serverLinkTitle` },
                  { serverName: n.name },
                ),
              }),
            }),
            (0, $.jsx)(`span`, {
              className: `shrink-0 text-footnote text-foreground-hint`,
              children: e({
                id: n.serverPushMuted
                  ? `settings.serverNotifications.muted`
                  : `settings.serverNotifications.on`,
              }),
            }),
            (0, $.jsx)(li, {}),
          ],
        }),
      })
    : null;
}
function Sl() {
  let { formatMessage: e } = K(),
    t = at(),
    n = B((e) => e.current),
    r = Va(),
```

## app-shell-readable.js:111622
```js
        c = (n = s()) => {
          let r = [];
          for (let e of i.querySelectorAll(L6)) {
            let t = e.dataset.timelineMessageId;
            if (!t) continue;
            let n = e.getBoundingClientRect();
            r.push({ id: t, top: n.top, bottom: n.bottom });
          }
          let o = I$e(e, r, n, t);
          a((e) => (L$e(e, o) ? e : o));
        },
        l = null,
        u = () => {
          (l !== null && clearTimeout(l),
            (l = setTimeout(() => {
              ((l = null), c());
            }, N$e)));
        },
        d = () => {
          (l !== null && clearTimeout(l), (l = null), c());
        },
        f = r ?? document;
      (f.addEventListener(`scroll`, u, { passive: !0 }),
        f.addEventListener(`scrollend`, d, { passive: !0 }));
      let p = null;
      if (typeof IntersectionObserver < `u`) {
        p = new IntersectionObserver(
          (e) => {
            c(e[0]?.rootBounds ?? s());
          },
          { root: r, threshold: 0 },
        );
        for (let t of e) {
          let e = i.querySelector(
            `[data-timeline-message-id="${CSS.escape(t)}"]`,
          );
          e && p.observe(e);
        }
      }
      return (
        c(),
        () => {
          (p?.disconnect(),
            l !== null && clearTimeout(l),
            f.removeEventListener(`scroll`, u),
            f.removeEventListener(`scrollend`, d));
        }
      );
    }, [r]),
    i
  );
}
function z$e(e, t) {
  let n = e ? Date.parse(e) : NaN;
  return t.hasNewer &&
    t.newestAt &&
    !Number.isNaN(n) &&
    n > Date.parse(t.newestAt)
    ? `below`
    : `above`;
}
function B$e({
  channelId: e,
  onJumpToMessage: t,
  bottomButton: n,
  loadedRange: r,
  loadedMessageIds: i,
  renderKey: a,
}) {
  let { formatMessage: o } = W(),
    s = gw(qC).enabled,
    c = ZZe(s ? e : null),
    l = R$e(
      (0, Y.useMemo)(() => c.map((e) => e.parentMessageId), [c]),
      a,
      i,
    ),
    [u, d] = (0, Y.useState)(null),
    { above: f, below: p } = (0, Y.useMemo)(() => {
      let e = [],
        t = [];
      for (let n of c) {
        let i = l.get(n.parentMessageId) ?? z$e(n.parentMessageCreatedAt, r);
        i === `above` ? e.push(n) : i === `below` && t.push(n);
      }
      return { above: e, below: t };
    }, [r, l, c]),
    m = c.length,
    h = u?.channelId === e && u.count === m,
    g = (0, Y.useCallback)(() => d({ channelId: e, count: m }), [e, m]),
    _ = p[0],
    v = f[0],
    y = (_ ?? v)?.parentMessageId,
    b = (0, Y.useCallback)(() => {
      y && t(y);
    }, [t, y]),
    x = (e) =>
      (0, X.jsxs)(ane, {
        "data-testid": `thread-unread-jump-pill`,
        "data-placement": e === `up` ? `top` : `bottom`,
        children: [
          (0, X.jsxs)(cc, {
            onClick: b,
            children: [
              e === `up`
                ? (0, X.jsx)(he, { "aria-hidden": !0 })
                : (0, X.jsx)(Kn, { "aria-hidden": !0 }),
              o(
                {
                  id:
                    e === `up`
                      ? `message.chatPanel.threadUnreadJumpEarliest`
                      : `message.chatPanel.threadUnreadJumpNext`,
                },
                { count: m },
              ),
            ],
          }),
          (0, X.jsx)(Bte, {
            "aria-label": o({ id: `message.chatPanel.threadUnreadDismiss` }),
            onClick: g,
            children: (0, X.jsx)(mt, { "aria-hidden": !0 }),
          }),
        ],
      }),
    S = !h && _ ? x(`down`) : null,
```
