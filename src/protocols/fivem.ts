// FiveM / RedM (Cfx.re) servers expose their state over plain HTTP.

import net from "node:net";
import type { OnlineStatus, QueryTarget } from "../types.ts";

interface DynamicJson {
  hostname?: string;
  clients?: number | string;
  sv_maxclients?: number | string;
  gametype?: string;
  mapname?: string;
}

/** Removes Cfx colour codes such as ^1 and ^7. */
export function stripCfxColors(text: string): string {
  return text.replace(/\^\d/g, "");
}

export async function queryFiveM(target: QueryTarget): Promise<OnlineStatus> {
  const host = net.isIPv6(target.address) ? `[${target.address}]` : target.address;
  const startedAt = performance.now();

  // Connect to the pre-resolved IP and refuse redirects so the SSRF check can't be bypassed.
  const response = await fetch(`http://${host}:${target.port}/dynamic.json`, {
    signal: AbortSignal.timeout(target.timeoutMs),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const latency = Math.round(performance.now() - startedAt);
  const data = (await response.json()) as DynamicJson;

  return {
    online: true,
    game: "fivem",
    host: target.host,
    port: target.port,
    name: stripCfxColors(data.hostname ?? "").trim() || target.host,
    motd: data.gametype || undefined,
    map: data.mapname || undefined,
    players: { online: Number(data.clients) || 0, max: Number(data.sv_maxclients) || 0 },
    latency,
  };
}
