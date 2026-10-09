import assert from "node:assert/strict";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

// macOS benchmark policy only. The Worker still validates the exact active
// handle, file ownership/permissions and capability scope on every invocation.
// Never allow the whole state directory: that exposes other arms and instances.
export function workerTurnRules(root) {
  if (root === undefined || root === "") return "";
  assert.ok(
    typeof root === "string" && isAbsolute(root),
    "Expected absolute Worker turn root",
  );
  const st = lstatSync(root),
    real = realpathSync(root);
  assert.ok(
    st.isDirectory() &&
      !st.isSymbolicLink() &&
      st.uid === process.getuid() &&
      (st.mode & 0o077) === 0,
    "Expected owner-private real turn directory",
  );
  assert.match(
    real,
    /\/warm-runtimes\/instrt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/turns$/,
  );
  // Seatbelt #regex escaping differs from a JavaScript RegExp string. Restrict
  // path characters, and spell a literal period as [.] (verified on macOS).
  assert.match(real, /^[A-Za-z0-9/._-]+$/);
  const path = real.replaceAll(".", "[.]");
  const handle = "[-A-Za-z0-9_]".repeat(22);
  let rules =
    "\n(allow file-read* (regex #" +
    JSON.stringify("^" + path + "/" + handle + "/(scope[.]json|token)$") +
    "))";
  rules +=
    "\n(allow file-read-metadata (regex #" +
    JSON.stringify("^" + path + "/" + handle + "$") +
    "))";
  for (let p = real; p !== "/"; p = dirname(p))
    rules += "\n(allow file-read-metadata (literal " + JSON.stringify(p) + "))";
  return rules;
}
