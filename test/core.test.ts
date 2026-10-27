import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { TtlCache } from "../src/cache.ts";
import { escapeXml, renderCard, truncate } from "../src/card.ts";
import { isPublicAddress } from "../src/guard.ts";
import { RateLimiter } from "../src/ratelimit.ts";

describe("SSRF guard", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    it(`blocks ${address}`, () => assert.equal(isPublicAddress(address), false));
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    it(`allows ${address}`, () => assert.equal(isPublicAddress(address), true));
  }
});

describe("TtlCache", () => {
  it("coalesces concurrent loads into one", async () => {
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 7;
    };
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get("k", load)));
    assert.equal(calls, 1);
    assert.ok(results.every((value) => value === 7));
  });

  it("evicts the oldest entry when full", async () => {
    const cache = new TtlCache<string>(1000, 2);
    for (const key of ["a", "b", "c"]) await cache.get(key, async () => key);
    assert.equal(cache.size, 2);
  });
});

describe("RateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    const limiter = new RateLimiter(2, 1);
    assert.equal(limiter.take("ip", 0), true);
    assert.equal(limiter.take("ip", 0), true);
    assert.equal(limiter.take("ip", 0), false);
    assert.equal(limiter.take("ip", 1000), true);
  });
});

describe("card", () => {
  it("escapes user-controlled text", () => {
    assert.equal(escapeXml(`<script>"&'`), "&#60;script&#62;&#34;&#38;&#39;");
    const svg = renderCard({ online: false, game: "minecraft", host: "x", port: 1, error: "nope" }, { title: "</text><script>" });
    assert.ok(!svg.includes("<script>"));
  });

  it("truncates by code point", () => {
    assert.equal(truncate("🎮🎮🎮🎮", 3), "🎮🎮…");
  });

  it("renders player counts", () => {
    const svg = renderCard({ online: true, game: "source", host: "h", port: 27015, name: "N", players: { online: 5, max: 10 }, latency: 30 });
    assert.match(svg, /5<tspan class="max"> \/ 10<\/tspan>/);
    assert.match(svg, /ONLINE/);
  });
});

describe("HTTP API", () => {
  const request = async (path: string) => {
    const server = createApp({ allowPrivate: false, cacheTtlMs: 1000, timeoutMs: 500, rateLimitPerMinute: 60, trustProxy: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
    } finally {
      server.close();
    }
  };

  it("validates parameters", async () => {
    assert.equal((await request("/api/card?game=quake&host=a.com")).status, 400);
    assert.equal((await request("/api/card?host=bad_host!")).status, 400);
    assert.equal((await request("/api/card?host=a.com&port=99999")).status, 400);
    assert.equal((await request("/api/card?host=a.com&theme=nope")).status, 400);
  });

  it("serves an offline card for blocked hosts", async () => {
    const res = await request("/api/card?host=127.0.0.1");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.match(await res.text(), /OFFLINE/);
  });

  it("serves the landing page", async () => {
    assert.equal((await request("/")).status, 200);
  });
});
