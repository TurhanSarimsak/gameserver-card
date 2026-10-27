// Renders the preview cards used in the README: `npm run examples`

import { mkdirSync, writeFileSync } from "node:fs";
import { renderCard, THEMES, type ThemeName } from "../src/card.ts";
import type { StatusResult } from "../src/types.ts";

const out = new URL("../docs/examples/", import.meta.url);
mkdirSync(out, { recursive: true });

const minecraft: StatusResult = {
  online: true,
  game: "minecraft",
  host: "play.example.net",
  port: 25565,
  name: "play.example.net",
  motd: "Survival · Skyblock · Events every weekend",
  version: "Paper 1.21.1",
  players: { online: 87, max: 150 },
  latency: 34,
};

const cards: Record<string, StatusResult> = {
  source: {
    online: true,
    game: "source",
    host: "cs.example.net",
    port: 27015,
    name: "Turhan's 5v5 Competitive",
    motd: "Counter-Strike 2",
    map: "de_mirage",
    version: "1.40.2.1",
    players: { online: 9, max: 10 },
    latency: 112,
  },
  fivem: {
    online: true,
    game: "fivem",
    host: "rp.example.net",
    port: 30120,
    name: "Los Santos Roleplay",
    motd: "Roleplay",
    map: "San Andreas",
    players: { online: 214, max: 256 },
    latency: 58,
  },
  offline: { online: false, game: "minecraft", host: "old.example.net", port: 25565, error: "connection refused" },
};

for (const theme of Object.keys(THEMES) as ThemeName[]) {
  writeFileSync(new URL(`${theme}.svg`, out), renderCard(minecraft, { theme }));
}
for (const [name, status] of Object.entries(cards)) {
  writeFileSync(new URL(`${name}.svg`, out), renderCard(status, { theme: "tokyonight" }));
}

console.log("wrote", Object.keys(THEMES).length + Object.keys(cards).length, "cards to docs/examples/");
