import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { TtlCache } from "./cache.ts";
import { isThemeName, renderCard } from "./card.ts";
import { queryServer } from "./query.ts";
import { RateLimiter } from "./ratelimit.ts";
import { GAMES, isGame, type Game, type StatusResult } from "./types.ts";

export interface AppOptions {
  allowPrivate: boolean;
  cacheTtlMs: number;
  timeoutMs: number;
  rateLimitPerMinute: number;
  trustProxy: boolean;
}

// Resolves to <root>/public both from src/ (dev) and dist/ (build).
const LANDING_PAGE = readFileSync(new URL("../public/index.html", import.meta.url));

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

interface Target {
  game: Game;
  host: string;
  port?: number;
}

function parseTarget(params: URLSearchParams): Target | { error: string } {
  const game = params.get("game") ?? "minecraft";
  if (!isGame(game)) return { error: `game must be one of: ${GAMES.join(", ")}` };

  const host = (params.get("host") ?? "").trim().toLowerCase();
  if (!HOSTNAME_RE.test(host) && net.isIP(host) === 0) return { error: "host must be a hostname or IP address" };

  const rawPort = params.get("port");
  if (!rawPort) return { game, host };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port must be between 1 and 65535" };
  return { game, host, port };
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: http.OutgoingHttpHeaders) {
  res.writeHead(status, { "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}) {
  send(res, status, JSON.stringify(body), {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    ...headers,
  });
}

export function createApp(options: AppOptions): http.Server {
  const cache = new TtlCache<StatusResult>(options.cacheTtlMs);
  const limiter = new RateLimiter(options.rateLimitPerMinute, options.rateLimitPerMinute / 60);
  const maxAge = Math.round(options.cacheTtlMs / 1000);
  const cacheControl = `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 5}`;

  function clientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (options.trustProxy && typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
    return req.socket.remoteAddress ?? "unknown";
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
    const url = new URL(req.url ?? "/", "http://localhost");

    switch (url.pathname) {
      case "/":
        return send(res, 200, LANDING_PAGE, { "content-type": "text/html; charset=utf-8" });
      case "/health":
        return sendJson(res, 200, { ok: true, cached: cache.size });
      case "/api/card":
      case "/api/status":
      case "/api/shields":
        break;
      default:
        return sendJson(res, 404, { error: "not found" });
    }

    const params = url.searchParams;
    const target = parseTarget(params);
    if ("error" in target) return sendJson(res, 400, target);

    const theme = params.get("theme") ?? "dark";
    if (url.pathname === "/api/card" && !isThemeName(theme)) return sendJson(res, 400, { error: "unknown theme" });

    if (!limiter.take(clientIp(req))) return sendJson(res, 429, { error: "rate limit exceeded" }, { "retry-after": "60" });

    const key = `${target.game}:${target.host}:${target.port ?? ""}`;
    const status = await cache.get(key, () =>
      queryServer(target.game, target.host, target.port, {
        timeoutMs: options.timeoutMs,
        allowPrivate: options.allowPrivate,
      }),
    );

    if (url.pathname === "/api/status") return sendJson(res, 200, status, { "cache-control": cacheControl });

    if (url.pathname === "/api/shields") {
      // https://shields.io/badges/endpoint-badge
      return sendJson(
        res,
        200,
        {
          schemaVersion: 1,
          label: (params.get("label") ?? "players").slice(0, 40),
          message: status.online ? `${status.players.online}/${status.players.max}` : "offline",
          color: status.online ? "brightgreen" : "red",
          cacheSeconds: maxAge,
        },
        { "cache-control": cacheControl },
      );
    }

    const svg = renderCard(status, {
      theme: isThemeName(theme) ? theme : "dark",
      title: params.get("title")?.slice(0, 60) || undefined,
      hideBorder: params.get("hide_border") === "true",
      animate: params.get("animate") !== "false",
    });
    return send(res, 200, svg, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cacheControl,
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    });
  }

  return http.createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.destroy();
    });
  });
}
