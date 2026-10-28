import { isSea } from "node:sea";

export type RuntimeReplyTransport =
  "worker" | "explicit-final" | "native-final";

/**
 * Product-daemon policy, not a low-level adapter default. Only reviewed entry
 * points in the source distribution graduate from opt-in. Standalone packaging
 * retains its previous defaults; Kimi native-final and Pi are not packaged yet.
 * Existing exact launch switches remain usable for rollback and experiments.
 */
export function selectRuntimeReplyTransport(input: {
  adapterKind: string;
  entry: "cold" | "warm";
  environment?: Readonly<Record<string, string | undefined>>;
  standalone?: boolean;
}): RuntimeReplyTransport {
  const environment = input.environment ?? process.env;
  const defaultNative = !(input.standalone ?? isSea());
  let nativeFlag: string;
  let structuredFlag: string | undefined;
  let defaultOn = defaultNative;

  if (input.entry === "warm") {
    switch (input.adapterKind) {
      case "codex-app-server/v1":
        nativeFlag = "LOOM_CODEX_NATIVE_FINAL_TRIAL";
        structuredFlag = "LOOM_CODEX_FINAL_OUTPUT_TRIAL";
        break;
      case "claude-stream-json/v1":
        nativeFlag = "LOOM_CLAUDE_NATIVE_FINAL_TRIAL";
        break;
      case "opencode-server/v1":
        nativeFlag = "LOOM_OPENCODE_NATIVE_FINAL_TRIAL";
        structuredFlag = "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL";
        break;
      default:
        return "worker";
    }
  } else {
    switch (input.adapterKind) {
      case "agy-print-json/v1":
        return "native-final"; // Existing AGY protocol, unchanged.
      case "kimi-acp/v1":
        nativeFlag = "LOOM_KIMI_NATIVE_FINAL_TRIAL";
        break;
      case "pi-print-json/v1":
        nativeFlag = "LOOM_PI_NATIVE_FINAL_TRIAL";
        break;
      case "codex-exec/v1":
        nativeFlag = "LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL";
        defaultOn = false; // Cold exec has not graduated with warm app-server.
        break;
      default:
        return "worker";
    }
  }

  // Explicit native wins; otherwise preserve the older structured experiment.
  // Any present value other than exactly "1" disables native, as before.
  const native = environment[nativeFlag];
  if (native === "1") return "native-final";
  if (structuredFlag && environment[structuredFlag] === "1")
    return "explicit-final";
  return native === undefined && defaultOn ? "native-final" : "worker";
}
