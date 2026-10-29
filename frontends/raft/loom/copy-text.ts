import { copyText } from "./OfficialClipboard138.generated.js";
import { toast } from "raft-ui";
/** Same upstream clipboard fallback for both local HTTP and secure browser contexts. No retries. */
export async function copyTextWithFeedback(text: string) {
  try {
    await copyText(text);
    return true;
  } catch {
    toast.error("复制失败，请手动选择文本。");
    return false;
  }
}
