import { readMemberRoster } from "./member-roster.ts";
import axios from "axios";
// Upstream business endpoints never leave the browser in a Loom build.
// Only the authenticated Loom SDK may access the local gateway.
const api = axios.create({
  adapter: async (config) => ({
    data: readMemberRoster(config.method, config.url),
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  }),
});
export async function clearAuthAndRedirect() {
  window.location.reload();
}
export default api;
