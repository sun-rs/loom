// Extracted official production code, formatted only; see manifest.json.
var vF = 8192,
  yF = {
    sidebar: {
      defaultWidth: 240,
      min: 200,
      max: 400,
      storageKey: `slock:sidebarWidth`,
      legacyStorageKeys: [
        `slock:publicServer:channelSidebarWidth`,
        `slock:publicServer:settingsSidebarWidth`,
      ],
    },
    list: {
      defaultWidth: 380,
      min: 240,
      max: 640,
      storageKey: `slock:searchPanelWidth`,
      legacyStorageKeys: [`slock:searchPanelCompactWidth`],
    },
    thread: {
      defaultWidth: 400,
      min: 360,
      max: vF,
      growsToMainMin: !0,
      storageKey: `slock:threadPanelWidth`,
      legacyStorageKeys: [`slock:publicServer:threadPanelWidth`],
    },
    detail: {
      defaultWidth: 400,
      min: 320,
      max: vF,
      growsToMainMin: !0,
      storageKey: `slock:profilePanelWidth`,
      legacyStorageKeys: [`slock:legacyTaskPanelWidth`],
    },
    sideCards: {
      defaultWidth: 360,
      min: 280,
      max: vF,
      growsToMainMin: !0,
      storageKey: `slock:channelSideCardsWidth`,
      legacyStorageKeys: [],
    },
    workspaceTree: {
      defaultWidth: 256,
      min: 180,
      max: 480,
      storageKey: `slock:workspaceTreeWidth`,
      legacyStorageKeys: [],
    },
  };
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

export {yF as officialPanelLayout, cOe as resolveOfficialColumnWidth, lOe as resolveOfficialMaxShare};
