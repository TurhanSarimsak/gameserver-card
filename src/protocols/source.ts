// Valve Source engine A2S_INFO over UDP (CS2, TF2, Rust, Garry's Mod, ARK, ...).
// https://developer.valvesoftware.com/wiki/Server_queries#A2S_INFO
//
//   C→S  FF FF FF FF 54 "Source Engine Query\0"
//   S→C  FF FF FF FF 41 <challenge:4>          (anti-spoofing, since 2020)
//   C→S  FF FF FF FF 54 "Source Engine Query\0" <challenge:4>
//   S→C  FF FF FF FF 49 <info...>

import dgram from "node:dgram";
import net from "node:net";
import type { OnlineStatus, QueryTarget } from "../types.ts";

const SINGLE_PACKET = -1; // FF FF FF FF
const S2C_CHALLENGE = 0x41;
const S2A_INFO = 0x49;
const THE_SHIP_APP_ID = 2400;

export const A2S_INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from("Source Engine Query\0", "latin1"),
]);

/** Little-endian cursor over a response packet that throws instead of reading past the end. */
class PacketReader {
  buffer: Buffer;
  offset: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  byte(): number {
    const value = this.buffer[this.offset];
    if (value === undefined) throw new RangeError("truncated packet");
    this.offset += 1;
    return value;
  }

  short(): number {
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  string(): string {
    const end = this.buffer.indexOf(0, this.offset);
    if (end === -1) throw new RangeError("truncated packet");
    const value = this.buffer.toString("utf8", this.offset, end);
    this.offset = end + 1;
    return value;
  }
}

export function parseInfo(packet: Buffer, target: QueryTarget, latency: number): OnlineStatus {
  const reader = new PacketReader(packet, 5);
  reader.byte(); // protocol
  const name = reader.string();
  const map = reader.string();
  reader.string(); // folder
  const game = reader.string();
  const appId = reader.short();
  const players = reader.byte();
  const maxPlayers = reader.byte();
  reader.byte(); // bots
  reader.byte(); // server type
  reader.byte(); // environment
  reader.byte(); // visibility
  reader.byte(); // VAC
  if (appId === THE_SHIP_APP_ID) reader.offset += 3; // mode, witnesses, duration
  const version = reader.string();

  return {
    online: true,
    game: "source",
    host: target.host,
    port: target.port,
    name: name || target.host,
    motd: game || undefined,
    map: map || undefined,
    version: version || undefined,
    players: { online: players, max: maxPlayers },
    latency,
  };
}

export function querySource(target: QueryTarget): Promise<OnlineStatus> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIPv6(target.address) ? "udp6" : "udp4");
    let sentAt = 0;
    let settled = false;

    const finish = (err: Error | null, value?: OnlineStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (err) reject(err);
      else resolve(value!);
    };

    const send = (packet: Buffer) => {
      sentAt = performance.now();
      socket.send(packet, target.port, target.address);
    };

    const timer = setTimeout(() => finish(new Error("timed out")), target.timeoutMs);
    socket.on("error", (err) => finish(err));

    socket.on("message", (message) => {
      try {
        if (message.length < 5) throw new Error("response too short");
        if (message.readInt32LE(0) !== SINGLE_PACKET) throw new Error("split responses are not supported");

        const type = message[4];
        if (type === S2C_CHALLENGE) {
          send(Buffer.concat([A2S_INFO_REQUEST, message.subarray(5, 9)]));
        } else if (type === S2A_INFO) {
          finish(null, parseInfo(message, target, Math.round(performance.now() - sentAt)));
        } else {
          throw new Error(`unexpected response type 0x${type?.toString(16)}`);
        }
      } catch (err) {
        finish(err as Error);
      }
    });

    send(A2S_INFO_REQUEST);
  });
}
