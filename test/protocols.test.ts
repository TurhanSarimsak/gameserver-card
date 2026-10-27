import assert from "node:assert/strict";
import dgram from "node:dgram";
import net, { type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { chatToText, encodePacket, encodeString, readPackets, stripFormatting } from "../src/protocols/minecraft.ts";
import { A2S_INFO_REQUEST } from "../src/protocols/source.ts";
import { readVarInt, writeVarInt } from "../src/protocols/varint.ts";
import { queryServer } from "../src/query.ts";

describe("VarInt", () => {
  for (const [value, bytes] of [
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [25565, [0xdd, 0xc7, 0x01]],
    [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
  ] as const) {
    it(`round-trips ${value}`, () => {
      assert.deepEqual([...writeVarInt(value)], bytes);
      assert.deepEqual(readVarInt(Buffer.from(bytes)), { value, size: bytes.length });
    });
  }

  it("returns null on incomplete input", () => {
    assert.equal(readVarInt(Buffer.from([0x80])), null);
  });

  it("rejects VarInts longer than 5 bytes", () => {
    assert.throws(() => readVarInt(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x01])), RangeError);
  });
});

describe("Minecraft helpers", () => {
  it("splits packets that arrive glued together or cut in half", () => {
    const a = encodePacket(0x00, encodeString("hello"));
    const b = encodePacket(0x01, Buffer.alloc(8));
    const joined = Buffer.concat([a, b]);
    const { packets, rest } = readPackets(joined.subarray(0, joined.length - 3));
    assert.equal(packets.length, 1);
    assert.equal(rest.length, b.length - 3);
  });

  it("flattens chat components and strips § codes", () => {
    const description = { text: "§aHello ", extra: [{ text: "§lworld" }, "!"] };
    assert.equal(stripFormatting(chatToText(description)), "Hello world!");
  });
});

describe("Minecraft Server List Ping", () => {
  let server: net.Server;
  let port: number;
  let handshakeHost = "";

  before(async () => {
    server = net.createServer((socket) => {
      let pending: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        const { packets, rest } = readPackets(Buffer.concat([pending, chunk]));
        pending = rest;
        for (const packet of packets) {
          const id = readVarInt(packet)!;
          if (id.value === 0x00 && packet.length > 1) {
            // Handshake: id, protocol, host, port, next state
            const protocol = readVarInt(packet, id.size)!;
            const hostLength = readVarInt(packet, id.size + protocol.size)!;
            const start = id.size + protocol.size + hostLength.size;
            handshakeHost = packet.toString("utf8", start, start + hostLength.value);
          } else if (id.value === 0x00) {
            const status = {
              version: { name: "Paper 1.21.1", protocol: 767 },
              players: { online: 42, max: 100, sample: [{ name: "§eNotch" }] },
              description: { text: "§6Welcome ", extra: ["to the server"] },
            };
            socket.write(encodePacket(0x00, encodeString(JSON.stringify(status))));
          } else if (id.value === 0x01) {
            socket.write(encodePacket(0x01, packet.subarray(id.size)));
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => server.close());

  it("reads status and measures ping", async () => {
    const status = await queryServer("minecraft", "127.0.0.1", port, { allowPrivate: true });
    assert.equal(status.online, true);
    if (!status.online) return;
    assert.equal(handshakeHost, "127.0.0.1");
    assert.equal(status.version, "Paper 1.21.1");
    assert.equal(status.motd, "Welcome to the server");
    assert.deepEqual(status.players, { online: 42, max: 100, sample: ["Notch"] });
    assert.ok(status.latency >= 0);
  });

  it("refuses private addresses unless explicitly allowed", async () => {
    const status = await queryServer("minecraft", "127.0.0.1", port);
    assert.equal(status.online, false);
    if (status.online) return;
    assert.equal(status.error, "address not allowed");
  });
});

describe("Source A2S_INFO", () => {
  const socket = dgram.createSocket("udp4");
  const challenge = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  let port: number;

  const cstring = (text: string) => Buffer.from(`${text}\0`, "utf8");
  const short = (value: number) => {
    const buffer = Buffer.alloc(2);
    buffer.writeInt16LE(value);
    return buffer;
  };

  before(async () => {
    socket.on("message", (message, remote) => {
      if (message.equals(A2S_INFO_REQUEST)) {
        socket.send(Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41]), challenge]), remote.port, remote.address);
        return;
      }
      assert.ok(message.subarray(-4).equals(challenge), "client must echo the challenge");
      const info = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
        cstring("Turhan's CS2 Server"),
        cstring("de_dust2"),
        cstring("csgo"),
        cstring("Counter-Strike 2"),
        short(730),
        Buffer.from([12, 32, 2, 0x64, 0x77, 0, 1]),
        cstring("1.40.2.1"),
      ]);
      socket.send(info, remote.port, remote.address);
    });
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    port = socket.address().port;
  });

  after(() => socket.close());

  it("handles the challenge and parses server info", async () => {
    const status = await queryServer("source", "127.0.0.1", port, { allowPrivate: true });
    assert.equal(status.online, true);
    if (!status.online) return;
    assert.equal(status.name, "Turhan's CS2 Server");
    assert.equal(status.map, "de_dust2");
    assert.equal(status.motd, "Counter-Strike 2");
    assert.equal(status.version, "1.40.2.1");
    assert.deepEqual(status.players, { online: 12, max: 32 });
  });

  it("reports a timeout as offline", async () => {
    const silent = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => silent.bind(0, "127.0.0.1", resolve));
    const status = await queryServer("source", "127.0.0.1", silent.address().port, { allowPrivate: true, timeoutMs: 200 });
    silent.close();
    assert.equal(status.online, false);
    if (status.online) return;
    assert.equal(status.error, "timed out");
  });
});
