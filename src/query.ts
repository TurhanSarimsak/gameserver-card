import { resolveSrv } from "node:dns/promises";
import net from "node:net";
import { resolvePublicAddress } from "./guard.ts";
import { queryFiveM } from "./protocols/fivem.ts";
import { queryMinecraft } from "./protocols/minecraft.ts";
import { querySource } from "./protocols/source.ts";
import type { Game, OnlineStatus, QueryTarget, StatusResult } from "./types.ts";

export const DEFAULT_PORTS: Record<Game, number> = {
  minecraft: 25565,
  source: 27015,
  fivem: 30120,
};

const PROTOCOLS: Record<Game, (target: QueryTarget) => Promise<OnlineStatus>> = {
  minecraft: queryMinecraft,
  source: querySource,
  fivem: queryFiveM,
};

export interface QueryOptions {
  timeoutMs?: number;
  allowPrivate?: boolean;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  ENOTFOUND: "host not found",
  EAI_AGAIN: "DNS lookup failed",
  TimeoutError: "timed out",
};

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const code = (err as NodeJS.ErrnoException).code ?? err.name;
  return FRIENDLY_ERRORS[code] ?? err.message;
}

/** Minecraft supports SRV records (`_minecraft._tcp.example.com`) for custom ports. */
async function lookupMinecraftSrv(host: string): Promise<{ name: string; port: number } | undefined> {
  if (net.isIP(host)) return undefined;
  const records = await resolveSrv(`_minecraft._tcp.${host}`).catch(() => []);
  return records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
}

/** Never throws: any failure becomes an OfflineStatus so the card can still render. */
export async function queryServer(
  game: Game,
  host: string,
  port: number | undefined,
  options: QueryOptions = {},
): Promise<StatusResult> {
  let connectHost = host;
  let connectPort = port ?? DEFAULT_PORTS[game];

  try {
    if (game === "minecraft" && port === undefined) {
      const srv = await lookupMinecraftSrv(host);
      if (srv) {
        connectHost = srv.name;
        connectPort = srv.port;
      }
    }

    const address = await resolvePublicAddress(connectHost, options.allowPrivate ?? false);
    return await PROTOCOLS[game]({ host, address, port: connectPort, timeoutMs: options.timeoutMs ?? 3000 });
  } catch (err) {
    return { online: false, game, host, port: connectPort, error: describeError(err) };
  }
}
