// SSRF protection: this service connects to arbitrary user-supplied hosts, so it
// must never be usable as a proxy into private networks or cloud metadata APIs.

import { lookup } from "node:dns/promises";
import net from "node:net";

const blocked = new net.BlockList();

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

const BLOCKED_V6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [address, prefix] of BLOCKED_V4) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of BLOCKED_V6) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  // ::ffff:127.0.0.1 is loopback in disguise; check the embedded IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1]!, "ipv4");
  return !blocked.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");
}

export class BlockedAddressError extends Error {
  constructor() {
    super("address not allowed");
  }
}

/**
 * Resolves `host` once and returns the IP to connect to. Callers must connect to
 * this exact address (not the hostname) so a second DNS lookup can't return a
 * different, private IP (DNS rebinding).
 */
export async function resolvePublicAddress(host: string, allowPrivate: boolean): Promise<string> {
  const address = net.isIP(host) ? host : (await lookup(host)).address;
  if (!allowPrivate && !isPublicAddress(address)) throw new BlockedAddressError();
  return address;
}
