import { createApp } from "./app.ts";

const env = process.env;

const server = createApp({
  allowPrivate: env.ALLOW_PRIVATE_HOSTS === "true",
  cacheTtlMs: Number(env.CACHE_TTL_SECONDS ?? 60) * 1000,
  timeoutMs: Number(env.QUERY_TIMEOUT_MS ?? 3000),
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
  trustProxy: env.TRUST_PROXY === "true",
});

const port = Number(env.PORT ?? 3000);
server.listen(port, () => console.log(`gameserver-card listening on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
