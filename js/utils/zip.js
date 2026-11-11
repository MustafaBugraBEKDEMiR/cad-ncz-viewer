/**
 * Minimal pure-JavaScript ZIP archive reader using the browser's built-in
 * DecompressionStream('deflate-raw') API. Zero external dependencies.
 */

const SIG_LOCAL = 0x04034B50;
const SIG_CENTRAL = 0x02014B50;
const SIG_EOCD = 0x06054B50;

/**
 * Check if a buffer starts with a PKZIP local file header.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isZipBuffer(bytes) {
  return bytes && bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function inflateRaw(compressedBytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Bu tarayıcı DecompressionStream API desteklemiyor.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressedBytes);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Extract all file entries from a ZIP ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{ name: string, data: Uint8Array }>>}
 */
export async function extractZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Locate End of Central Directory (EOCD) scanning backwards up to 64KB
  let eocdOffset = -1;
  const minOff = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOff; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocdOffset = i;
      break;
    }
  }

  const entries = [];

  if (eocdOffset >= 0) {
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let cdOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8');

    for (let idx = 0; idx < totalEntries && cdOffset + 46 <= bytes.length; idx++) {
      if (view.getUint32(cdOffset, true) !== SIG_CENTRAL) break;
      const compression = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localHeaderOff = view.getUint32(cdOffset + 42, true);
      const name = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue;
      if (localHeaderOff + 30 > bytes.length || view.getUint32(localHeaderOff, true) !== SIG_LOCAL) continue;

      const lhNameLen = view.getUint16(localHeaderOff + 26, true);
      const lhExtraLen = view.getUint16(localHeaderOff + 28, true);
      const dataStart = localHeaderOff + 30 + lhNameLen + lhExtraLen;
      const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

      if (compression === 0) {
        entries.push({ name, data: new Uint8Array(rawSlice) });
      } else if (compression === 8) {
        const inflated = await inflateRaw(rawSlice);
        entries.push({ name, data: inflated });
      }
    }
    return entries;
  }

  // Fallback: sequential scan of local headers if EOCD missing
  let offset = 0;
  const decoder = new TextDecoder('utf-8');
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== SIG_LOCAL) break;
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 || compSize === 0 && compression === 8) break;
    const rawSlice = bytes.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      if (compression === 0) entries.push({ name, data: new Uint8Array(rawSlice) });
      else if (compression === 8) entries.push({ name, data: await inflateRaw(rawSlice) });
    }
    offset = dataStart + compSize;
  }

  return entries;
}
