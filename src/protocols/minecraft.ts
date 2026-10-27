// Minecraft Java Edition "Server List Ping" over raw TCP.
// https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
//
//   C→S  Handshake   (0x00) protocol=-1, host, port, nextState=1 (status)
//   C→S  Status Req  (0x00)
//   S→C  Status Resp (0x00) JSON string
//   C→S  Ping        (0x01) 8-byte payload
//   S→C  Pong        (0x01) same payload  → round-trip latency

import net from "node:net";
import type { OnlineStatus, QueryTarget } from "../types.ts";
import { readVarInt, writeVarInt } from "./varint.ts";

// Favicons are base64 PNGs inside the status JSON, so responses can be large.
const MAX_PACKET_SIZE = 2 * 1024 * 1024;
const FAVICON_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

interface RawStatus {
  version?: { name?: string; protocol?: number };
  players?: { online?: number; max?: number; sample?: { name?: string }[] };
  description?: unknown;
  favicon?: string;
}

export function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

export function encodePacket(id: number, ...fields: Buffer[]): Buffer {
  const body = Buffer.concat([writeVarInt(id), ...fields]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

/** Splits every complete length-prefixed packet off the front of `buffer`. */
export function readPackets(buffer: Buffer): { packets: Buffer[]; rest: Buffer } {
  const packets: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const length = readVarInt(buffer, offset);
    if (!length) break;
    if (length.value < 0 || length.value > MAX_PACKET_SIZE) throw new RangeError("packet too large");
    const start = offset + length.size;
    const end = start + length.value;
    if (end > buffer.length) break;
    packets.push(buffer.subarray(start, end));
    offset = end;
  }
  return { packets, rest: buffer.subarray(offset) };
}

/** Flattens a chat component ({"text": "...", "extra": [...]}) into plain text. */
export function chatToText(component: unknown): string {
  if (typeof component === "string") return component;
  if (Array.isArray(component)) return component.map(chatToText).join("");
  if (component && typeof component === "object") {
    const { text, extra } = component as { text?: unknown; extra?: unknown };
    return (typeof text === "string" ? text : "") + (extra ? chatToText(extra) : "");
  }
  return "";
}

/** Removes legacy § colour/format codes. */
export function stripFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-orx]/gi, "");
}

export function queryMinecraft(target: QueryTarget): Promise<OnlineStatus> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.address, port: target.port });
    let pending: Buffer = Buffer.alloc(0);
    let status: RawStatus | undefined;
    let requestedAt = 0;
    let pingedAt = 0;
    let statusLatency = 0;
    let settled = false;

    const finish = (err: Error | null, latency = statusLatency) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else if (!status) reject(new Error("no status response"));
      else resolve(toStatus(status, target, latency));
    };

    // Some servers answer the status request but never the ping: fall back to
    // the status round-trip time instead of reporting them as offline.
    socket.setTimeout(target.timeoutMs, () => finish(status ? null : new Error("timed out")));
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(status ? null : new Error("connection closed")));

    socket.on("connect", () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      // Protocol version -1 asks the server to report whatever version it runs.
      socket.write(encodePacket(0x00, writeVarInt(-1), encodeString(target.host), port, writeVarInt(1)));
      requestedAt = performance.now();
      socket.write(encodePacket(0x00));
    });

    socket.on("data", (chunk) => {
      try {
        const { packets, rest } = readPackets(Buffer.concat([pending, chunk]));
        pending = rest;
        for (const packet of packets) handle(packet);
      } catch (err) {
        finish(err as Error);
      }
    });

    function handle(packet: Buffer) {
      const id = readVarInt(packet);
      if (!id) throw new Error("malformed packet");

      if (id.value === 0x00 && !status) {
        const length = readVarInt(packet, id.size);
        if (!length) throw new Error("malformed status packet");
        const start = id.size + length.size;
        status = JSON.parse(packet.toString("utf8", start, start + length.value)) as RawStatus;
        statusLatency = Math.round(performance.now() - requestedAt);

        const payload = Buffer.alloc(8);
        payload.writeBigInt64BE(BigInt(Date.now()));
        pingedAt = performance.now();
        socket.write(encodePacket(0x01, payload));
      } else if (id.value === 0x01 && status) {
        finish(null, Math.round(performance.now() - pingedAt));
      }
    }
  });
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function toStatus(raw: RawStatus, target: QueryTarget, latency: number): OnlineStatus {
  const motd = stripFormatting(chatToText(raw.description)).replace(/\s+/g, " ").trim();
  const favicon = typeof raw.favicon === "string" ? raw.favicon.replace(/\n/g, "") : "";
  const sample = raw.players?.sample
    ?.map((player) => stripFormatting(player.name ?? ""))
    .filter((name) => name.length > 0);

  return {
    online: true,
    game: "minecraft",
    host: target.host,
    port: target.port,
    name: target.host,
    motd: motd || undefined,
    version: raw.version?.name ? stripFormatting(raw.version.name) : undefined,
    players: { online: toCount(raw.players?.online), max: toCount(raw.players?.max), sample },
    latency,
    favicon: favicon.length < 200_000 && FAVICON_RE.test(favicon) ? favicon : undefined,
  };
}
