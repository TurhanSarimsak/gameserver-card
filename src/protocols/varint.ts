// Minecraft's VarInt: 7 bits of payload per byte, MSB set means "more bytes follow".
// https://minecraft.wiki/w/Java_Edition_protocol/Data_types#VarInt_and_VarLong

export function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0; // negative numbers are encoded as their unsigned 32-bit form
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

/** Returns null when the buffer ends before the VarInt does (wait for more data). */
export function readVarInt(buffer: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new RangeError("VarInt is longer than 5 bytes");
}
