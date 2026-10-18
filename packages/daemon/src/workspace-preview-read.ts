import {
  ChannelWorkspaceReadRequestSchema,
  type ChannelWorkspaceReadRequest,
} from "@rah-os/protocol";
import { HttpRahClient } from "@rah-os/client-sdk";
/** Reuse Human room membership and host root checks for every preview read. */
export async function readWorkspacePreview(
  options: { daemonOrigin: string; accessToken: string },
  input: ChannelWorkspaceReadRequest,
) {
  const request = ChannelWorkspaceReadRequestSchema.parse(input);
  if (request.operation !== "read") throw Error("Preview requires a file read");
  const client = new HttpRahClient({
    baseUrl: options.daemonOrigin,
    accessToken: () => options.accessToken,
  });
  const result = await client.request("channel.workspace.read", request, {
    signal: AbortSignal.timeout(15000),
  });
  if (result.kind !== "read" || result.value.content === null)
    throw Error("Workspace preview unavailable");
  return result.value;
}
export function workspacePdfBytes(value: {
  encoding: string;
  mimeType: string;
  content: string | null;
}) {
  if (
    value.encoding !== "base64" ||
    value.mimeType !== "application/pdf" ||
    !value.content
  )
    throw Error("PDF required");
  const bytes = Buffer.from(value.content, "base64");
  if (
    bytes.length > 5 * 1024 * 1024 ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw Error("Invalid PDF");
  return bytes;
}
