/**
 * Windows-1254 (Turkish) & UTF-8 text decoding helpers.
 * Netcad binary (.ncz) files store layer names, point IDs, and labels in CP1254.
 */

const CP1254_HIGH_TABLE = [
  '\u20AC', '\u0081', '\u201A', '\u0192', '\u201E', '\u2026', '\u2020', '\u2021',
  '\u02C6', '\u2030', '\u0160', '\u2039', '\u0152', '\u008D', '\u008E', '\u008F',
  '\u0090', '\u2018', '\u2019', '\u201C', '\u201D', '\u2022', '\u2013', '\u2014',
  '\u02DC', '\u2122', '\u0161', '\u203A', '\u0153', '\u009D', '\u009E', '\u0178',
  '\u00A0', '\u00A1', '\u00A2', '\u00A3', '\u00A4', '\u00A5', '\u00A6', '\u00A7',
  '\u00A8', '\u00A9', '\u00AA', '\u00AB', '\u00AC', '\u00AD', '\u00AE', '\u00AF',
  '\u00B0', '\u00B1', '\u00B2', '\u00B3', '\u00B4', '\u00B5', '\u00B6', '\u00B7',
  '\u00B8', '\u00B9', '\u00BA', '\u00BB', '\u00BC', '\u00BD', '\u00BE', '\u00BF',
  '\u00C0', '\u00C1', '\u00C2', '\u00C3', '\u00C4', '\u00C5', '\u00C6', '\u00C7',
  '\u00C8', '\u00C9', '\u00CA', '\u00CB', '\u00CC', '\u00CD', '\u00CE', '\u00CF',
  '\u011E', '\u00D1', '\u00D2', '\u00D3', '\u00D4', '\u00D5', '\u00D6', '\u00D7',
  '\u00D8', '\u00D9', '\u00DA', '\u00DB', '\u00DC', '\u0130', '\u015E', '\u00DF',
  '\u00E0', '\u00E1', '\u00E2', '\u00E3', '\u00E4', '\u00E5', '\u00E6', '\u00E7',
  '\u00E8', '\u00E9', '\u00EA', '\u00EB', '\u00EC', '\u00ED', '\u00EE', '\u00EF',
  '\u011F', '\u00F1', '\u00F2', '\u00F3', '\u00F4', '\u00F5', '\u00F6', '\u00F7',
  '\u00F8', '\u00F9', '\u00FA', '\u00FB', '\u00FC', '\u0131', '\u015F', '\u00FF'
];

let utf8StrictDecoder = null;
try {
  utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true });
} catch {
  utf8StrictDecoder = null;
}

/**
 * Decode a Uint8Array from Windows-1254 (or strict UTF-8 if multi-byte UTF-8 detected).
 * Strips trailing/embedded NUL bytes cleanly.
 * @param {Uint8Array} bytes
 * @param {{ preferUtf8?: boolean }} [opts]
 * @returns {string}
 */
export function decodeCp1254(bytes, opts = {}) {
  if (!bytes || bytes.length === 0) return '';

  // Trim at first NUL byte if C-string padding exists
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  const slice = end === bytes.length ? bytes : bytes.subarray(0, end);
  if (slice.length === 0) return '';

  // If strictly valid UTF-8 with multi-byte sequences and requested/detected, decode UTF-8
  if (opts.preferUtf8 && utf8StrictDecoder) {
    let hasHigh = false;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] >= 0x80) {
        hasHigh = true;
        break;
      }
    }
    if (hasHigh) {
      try {
        return utf8StrictDecoder.decode(slice);
      } catch {
        // Fall through to CP1254
      }
    }
  }

  let out = '';
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    out += b < 0x80 ? String.fromCharCode(b) : CP1254_HIGH_TABLE[b - 0x80];
  }
  return out;
}

/**
 * Decode a buffer that might be UTF-8 BOM, UTF-16 LE BOM, UTF-8, or Windows-1254.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeSmartText(bytes) {
  if (!bytes || bytes.length === 0) return '';
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (utf8StrictDecoder) {
    try {
      return utf8StrictDecoder.decode(bytes);
    } catch {
      // Fallback to CP1254
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : CP1254_HIGH_TABLE[b - 0x80];
  }
  return out;
}
