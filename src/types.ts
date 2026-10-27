export const GAMES = ["minecraft", "source", "fivem"] as const;
export type Game = (typeof GAMES)[number];

export function isGame(value: string): value is Game {
  return (GAMES as readonly string[]).includes(value);
}

/** What a protocol implementation needs to reach a server. */
export interface QueryTarget {
  /** Hostname as the user typed it (sent in the Minecraft handshake). */
  host: string;
  /** Already resolved and SSRF-checked IP address we actually connect to. */
  address: string;
  port: number;
  timeoutMs: number;
}

export interface OnlineStatus {
  online: true;
  game: Game;
  host: string;
  port: number;
  name: string;
  motd?: string;
  map?: string;
  version?: string;
  players: { online: number; max: number; sample?: string[] };
  latency: number;
  /** data:image/png;base64,... (Minecraft only) */
  favicon?: string;
}

export interface OfflineStatus {
  online: false;
  game: Game;
  host: string;
  port: number;
  error: string;
}

export type StatusResult = OnlineStatus | OfflineStatus;
