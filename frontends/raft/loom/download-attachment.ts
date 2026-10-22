import { pageFetch } from "./page-fetch.ts";
import { HttpRahClient } from "@rah-os/client-sdk";
import type { MessageAttachment } from "../packages/web/src/store/messageStore.ts";
const client = new HttpRahClient({
  fetch: pageFetch,
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
export async function downloadLoomAttachment(
  a: MessageAttachment,
  signal?: AbortSignal,
) {
  const blob = await client.files.download(a.id, signal);
  if (signal?.aborted) return;
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = a.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
