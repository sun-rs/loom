import "./browser-crypto.ts";
import "./style.css";
import { trackVisualViewport } from "../packages/web/src/utils/visualViewport.ts";
trackVisualViewport();
// Load vendor modules only after HTTP browser compatibility is installed.
void import("./app-entry.tsx");
