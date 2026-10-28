import { isIP } from "node:net";

export function isTailnetIpv4(host: string) {
  const octets = isIP(host) === 4 ? host.split(".").map(Number) : undefined;
  return (
    octets !== undefined &&
    octets[0] === 100 &&
    octets[1]! >= 64 &&
    octets[1]! <= 127
  );
}

export function isPrivateLanIpv4(host: string) {
  return (
    isIP(host) === 4 &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)
  );
}
