// Device-mode bootstrap; installed chrome is a document-lifetime observation,
// not a second theme preference. Keep the native ThemeProvider as mode owner.
(() => {
  let mode = "system";
  try {
    const saved = localStorage.getItem("loom-raft-mode-v3");
    const old = JSON.parse(localStorage.getItem("slock-theme-preferences-v2") || "null");
    const legacy = localStorage.getItem("slock-theme-preset");
    mode = saved || old?.mode || (legacy === "elegant-dark" ? "dark" : legacy === "brutal" || legacy === "elegant-light" ? "light" : "system");
  } catch {}
  if (!["light", "dark"].includes(mode)) mode = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  root.style.colorScheme = mode;
  const chrome = document.querySelector('meta[name="theme-color"]');
  if (chrome) chrome.content = mode === "dark" ? "#0D0D0B" : "#FFD440";
  const standalone = matchMedia("(display-mode: standalone)");
  const fullscreen = matchMedia("(display-mode: fullscreen)");
  let installed = typeof navigator !== "undefined" && navigator.standalone === true;
  const sync = () => {
    // An installed document stays installed while rotating. Some mobile engines
    // temporarily stop matching display-mode when entering the wide layout.
    installed ||= standalone.matches;
    if (installed || fullscreen.matches) root.setAttribute("data-loom-installed", "true");
    else root.removeAttribute("data-loom-installed");
  };
  sync();
  for (const query of [standalone, fullscreen]) {
    if (query.addEventListener) query.addEventListener("change", sync);
    else query.addListener?.(sync);
  }
})();
