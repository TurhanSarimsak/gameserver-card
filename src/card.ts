import type { Game, StatusResult } from "./types.ts";

export interface Theme {
  bg: string;
  border: string;
  title: string;
  text: string;
  accent: string;
  track: string;
}

export const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", title: "#e6edf3", text: "#8b949e", accent: "#58a6ff", track: "#21262d" },
  light: { bg: "#ffffff", border: "#d0d7de", title: "#1f2328", text: "#59636e", accent: "#0969da", track: "#eaeef2" },
  dracula: { bg: "#282a36", border: "#44475a", title: "#f8f8f2", text: "#bfbfd6", accent: "#bd93f9", track: "#44475a" },
  nord: { bg: "#2e3440", border: "#3b4252", title: "#eceff4", text: "#d8dee9", accent: "#88c0d0", track: "#3b4252" },
  tokyonight: { bg: "#1a1b27", border: "#292e42", title: "#c0caf5", text: "#a9b1d6", accent: "#7aa2f7", track: "#292e42" },
  synthwave: { bg: "#241b2f", border: "#463465", title: "#fdfdfd", text: "#e0c9ff", accent: "#ff7edb", track: "#3b2a52" },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export function isThemeName(value: string): value is ThemeName {
  return Object.hasOwn(THEMES, value);
}

export interface CardOptions {
  theme?: ThemeName;
  title?: string;
  hideBorder?: boolean;
  animate?: boolean;
}

const GAME_LABELS: Record<Game, { glyph: string; name: string }> = {
  minecraft: { glyph: "MC", name: "Minecraft" },
  source: { glyph: "SRC", name: "Source" },
  fivem: { glyph: "5M", name: "FiveM" },
};

const GREEN = "#3fb950";
const YELLOW = "#d29922";
const RED = "#f85149";

const WIDTH = 460;
const HEIGHT = 140;
const PAD = 20;
const BAR_WIDTH = WIDTH - PAD * 2;

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Truncates by code points so emoji and non-Latin names are never split in half. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

function latencyColor(ms: number): string {
  if (ms < 80) return GREEN;
  if (ms < 160) return YELLOW;
  return RED;
}

function styles(theme: Theme, stateColor: string, animate: boolean): string {
  const motion = animate
    ? `
    .fade { opacity: 0; animation: fade .6s ease-out forwards; }
    .grow { transform-box: fill-box; transform-origin: left center; transform: scaleX(0);
            animation: grow 1.1s cubic-bezier(.2,.8,.2,1) .25s forwards; }
    .pulse { transform-box: fill-box; transform-origin: center; animation: pulse 1.8s ease-out infinite; }
    @keyframes fade { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @keyframes pulse { from { opacity: .7; transform: scale(1); } to { opacity: 0; transform: scale(2.8); } }
    @media (prefers-reduced-motion: reduce) {
      .fade, .grow { animation: none; opacity: 1; transform: none; }
      .pulse { display: none; }
    }`
    : `.pulse { display: none; }`;

  return `
    text { font-family: "Segoe UI", Ubuntu, "Helvetica Neue", Arial, sans-serif; }
    .title { font-size: 16px; font-weight: 600; fill: ${theme.title}; }
    .sub { font-size: 12px; fill: ${theme.text}; }
    .meta { font-size: 11px; fill: ${theme.text}; }
    .label { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; fill: ${theme.text}; }
    .count { font-size: 13px; font-weight: 600; fill: ${theme.title}; }
    .max { font-weight: 400; fill: ${theme.text}; }
    .glyph { font-size: 15px; font-weight: 800; fill: ${theme.accent}; }
    .state { font-size: 11px; font-weight: 700; letter-spacing: 1px; fill: ${stateColor}; }
    ${motion}`;
}

export function renderCard(status: StatusResult, options: CardOptions = {}): string {
  const theme = THEMES[options.theme ?? "dark"];
  const animate = options.animate ?? true;
  const label = GAME_LABELS[status.game];
  const stateColor = status.online ? GREEN : RED;
  const stateText = status.online ? "ONLINE" : "OFFLINE";
  const address = `${status.host}:${status.port}`;

  const title = truncate(options.title ?? (status.online ? status.name : status.host), 30);
  const subtitle = status.online
    ? [status.motd, status.map].filter(Boolean).join(" · ") || label.name
    : `Unreachable: ${status.error}`;

  const metaParts = status.online
    ? [
        status.version ? escapeXml(truncate(status.version, 18)) : label.name,
        `<tspan fill="${latencyColor(status.latency)}">${status.latency} ms</tspan>`,
        escapeXml(truncate(address, 32)),
      ]
    : [label.name, escapeXml(truncate(address, 40))];

  const players = status.online ? status.players : { online: 0, max: 0 };
  const ratio = players.max > 0 ? Math.min(1, players.online / players.max) : 0;
  const fillWidth = ratio > 0 ? Math.max(8, Math.round(BAR_WIDTH * ratio)) : 0;
  const count = status.online
    ? `${players.online}<tspan class="max"> / ${players.max}</tspan>`
    : `<tspan class="max">—</tspan>`;

  const icon =
    status.online && status.favicon
      ? `<image x="${PAD}" y="${PAD}" width="52" height="52" href="${status.favicon}" clip-path="url(#icon)" style="image-rendering:pixelated"/>`
      : `<rect x="${PAD}" y="${PAD}" width="52" height="52" rx="10" fill="${theme.track}"/>
    <text x="${PAD + 26}" y="${PAD + 31}" text-anchor="middle" class="glyph">${label.glyph}</text>`;

  // Approximate width of the uppercase state label to place the dot left of it.
  const dotX = WIDTH - PAD - stateText.length * 7.6 - 9;
  const a11y = status.online
    ? `${title} is online with ${players.online} of ${players.max} players`
    : `${title} is offline`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="card-title">
  <title id="card-title">${escapeXml(a11y)}</title>
  <defs>
    <clipPath id="icon"><rect x="${PAD}" y="${PAD}" width="52" height="52" rx="10"/></clipPath>
    <linearGradient id="fill" x1="0" x2="1">
      <stop offset="0" stop-color="${theme.accent}"/>
      <stop offset="1" stop-color="${stateColor}"/>
    </linearGradient>
  </defs>
  <style>${styles(theme, stateColor, animate)}
  </style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${theme.bg}" stroke="${options.hideBorder ? "none" : theme.border}"/>
  <g class="fade">
    ${icon}
  </g>
  <g class="fade" style="animation-delay:.1s">
    <text x="92" y="40" class="title">${escapeXml(title)}</text>
    <text x="92" y="60" class="sub">${escapeXml(truncate(subtitle, 52))}</text>
    <text x="92" y="78" class="meta">${metaParts.join(" · ")}</text>
  </g>
  <g>
    <circle class="pulse" cx="${dotX}" cy="34" r="4" fill="${stateColor}"/>
    <circle cx="${dotX}" cy="34" r="4" fill="${stateColor}"/>
    <text x="${WIDTH - PAD}" y="38" text-anchor="end" class="state">${stateText}</text>
  </g>
  <g class="fade" style="animation-delay:.2s">
    <text x="${PAD}" y="108" class="label">PLAYERS</text>
    <text x="${WIDTH - PAD}" y="108" text-anchor="end" class="count">${count}</text>
    <rect x="${PAD}" y="116" width="${BAR_WIDTH}" height="8" rx="4" fill="${theme.track}"/>
    ${fillWidth > 0 ? `<rect class="grow" x="${PAD}" y="116" width="${fillWidth}" height="8" rx="4" fill="url(#fill)"/>` : ""}
  </g>
</svg>`;
}
