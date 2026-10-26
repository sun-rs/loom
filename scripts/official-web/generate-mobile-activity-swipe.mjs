// Structural port: native ActivityConversationSwipe start/end semantics over the
// already pinned Web gesture. Original sources stay immutable; every rewrite is fenced.
import { readFileSync, writeFileSync } from "node:fs";
let code = readFileSync(
  "frontends/raft/loom/OfficialActivitySwipe.generated.js",
  "utf8",
);
const replace = (from, to) => {
  if (!code.includes(from)) throw Error("Swipe port source changed: " + from);
  code = code.replaceAll(from, to);
};
replace(
  "// GENERATED: unchanged Raft 1.21.34 mobile row gesture and recipes.",
  "// GENERATED structural mobile port: pinned Web gesture + native eff04722 start/end actions.",
);
replace("  enabled: e,", "  enabled: e,\n  onStartSwipe: startAction,");
replace(
  "  let c = (0, q.useRef)(null),",
  '  let direction = (0,q.useRef)("end");\n  let c = (0, q.useRef)(null),',
);
replace(
  "      onFullSwipe: i,",
  '      onFullSwipe: () => direction.current === "start" ? startAction?.() : i(),',
);
replace(
  "r.style.setProperty(It, `${e}px`),",
  'r.style.setProperty(It, `${e}px`),\n        r.setAttribute("data-swipe-side", direction.current),',
);
replace(
  "                  t.wasOpen,",
  "                  t.wasOpen || !!startAction,",
);
replace(
  "              (g(), (t.claimX = e.clientX), (t.baseReveal = u.current));",
  '              if (!t.wasOpen) direction.current = e.clientX > t.startX ? "start" : "end";\n              (g(), (t.claimX = e.clientX), (t.baseReveal = u.current));',
);
replace(
  "t.baseReveal + t.claimX - e.clientX",
  't.baseReveal + (direction.current === "start" ? e.clientX-t.claimX : t.claimX-e.clientX)',
);
replace(
  "((n.x - e.clientX) / r) * 1e3",
  '((direction.current === "start" ? e.clientX-n.x : n.x-e.clientX) / r) * 1e3',
);
replace(
  "zt(t.reveal, i, t.width, a)",
  'zt(t.reveal, i, t.width, direction.current === "start" ? 72 : a)',
);
replace("(v(a), o(!0))", '(v(direction.current === "start" ? 72 : a), o(!0))');
replace("[g, h],\n        ),", "[g, h, startAction],\n        ),");
replace("Ht as useOfficialRowSwipe", "Ht as useMobileActivitySwipe");
writeFileSync("frontends/raft/loom/MobileActivitySwipe.generated.js", code);
writeFileSync(
  "frontends/raft/loom/MobileActivitySwipe.generated.d.ts",
  readFileSync(
    "frontends/raft/loom/OfficialActivitySwipe.generated.d.ts",
    "utf8",
  )
    .replace("useOfficialRowSwipe", "useMobileActivitySwipe")
    .replace(
      "  enabled: boolean;",
      "  enabled: boolean;\n  onStartSwipe?: () => void;",
    ),
);
