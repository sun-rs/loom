import axios from "axios";
// Upstream business endpoints never leave the browser in a Loom build.
// Only the authenticated Loom SDK may access the local gateway.
const api = axios.create({
  adapter: async () => {
    throw new Error("此功能尚未接入 Loom");
  },
});
export async function clearAuthAndRedirect() {
  window.location.reload();
}
export default api;
