import { useLocation, useSearchParams } from "react-router-dom";
/** Native background-location pattern, adapted to Loom's query routes. Presentation only. */
export function searchBackground(
  search: string,
  state: unknown,
): string | null {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "search" || params.get("presentation") === "page")
    return null;
  if (!state || typeof state !== "object" || !("loomSearchBackground" in state))
    return null;
  return typeof state.loomSearchBackground === "string"
    ? state.loomSearchBackground
    : null;
}
export function useSearchPresentation(): ReturnType<typeof useSearchParams> {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  return [
    params,
    (next, options) => setParams(next, { state: location.state, ...options }),
  ];
}
