/**
 * Format Auto-Detector and Unified Parser Dispatcher.
 */

import { parseNcz } from './ncz-parser.js';
import { parseDxf } from './dxf-parser.js';
import { parseNcn } from './ncn-parser.js';
import { parseGeoJson, parseKml, parseSvg } from './vector-parser.js';
import { parseObj, parseStl } from './mesh3d-parser.js';
import { isZipBuffer, extractZipEntries } from '../utils/zip.js';

export const SUPPORTED_EXTENSIONS = ['.ncz', '.nca', '.dxf', '.ncn', '.xyz', '.txt', '.geojson', '.json', '.kml', '.kmz', '.svg', '.obj', '.stl'];

export async function parseCadFile(buffer, fileName) {
  const lower = (fileName || '').toLowerCase();
  const bytes = new Uint8Array(buffer);

  if (lower.endsWith('.ncz') || lower.endsWith('.nca')) {
    return parseNcz(buffer, fileName);
  }
  if (lower.endsWith('.dxf')) {
    return parseDxf(buffer, fileName);
  }
  if (lower.endsWith('.ncn') || lower.endsWith('.xyz') || lower.endsWith('.txt')) {
    return parseNcn(buffer, fileName);
  }
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
    return parseGeoJson(buffer, fileName);
  }
  if (lower.endsWith('.kml')) {
    return parseKml(buffer, fileName);
  }
  if (lower.endsWith('.kmz') && isZipBuffer(bytes)) {
    const entries = await extractZipEntries(buffer);
    const kmlEntry = entries.find((e) => e.name.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) throw new Error('KMZ arşivi içinde KML dosyası bulunamadı.');
    return parseKml(kmlEntry.data.buffer, fileName);
  }
  if (lower.endsWith('.svg')) {
    return parseSvg(buffer, fileName);
  }
  if (lower.endsWith('.obj')) {
    return parseObj(buffer, fileName);
  }
  if (lower.endsWith('.stl')) {
    return parseStl(buffer, fileName);
  }

  // Fallback: sniff magic bytes / text header
  if (bytes.length >= 6 && bytes[0] === 0x01) {
    return parseNcz(buffer, fileName);
  }
  if (isZipBuffer(bytes)) {
    return parseNcz(buffer, fileName);
  }
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(512, bytes.length))).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    return parseGeoJson(buffer, fileName);
  }
  if (head.includes('<svg')) {
    return parseSvg(buffer, fileName);
  }
  if (head.includes('<kml')) {
    return parseKml(buffer, fileName);
  }
  if (/\bSECTION\b/.test(head) || /^\s*0\s*\r?\n\s*SECTION/.test(head)) {
    return parseDxf(buffer, fileName);
  }

  throw new Error(`Desteklenmeyen dosya biçimi: ${fileName}`);
}
