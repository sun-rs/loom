export function validateComputerControlOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("origin must be an absolute HTTP(S) origin");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "origin must not contain credentials, a path, query, or hash",
    );
  }
  if (url.protocol === "http:") {
    if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
      throw new Error("non-loopback Computer control origins require HTTPS");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("Computer control origin must use HTTP or HTTPS");
  }
  return url.origin;
}
