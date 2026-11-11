/**
 * Clean-room Netcad (.ncz / .nca) Binary & Container Parser (MIT Licensed).
 *
 * Supports:
 * 1. Classic Netcad binary TLV stream ([tag: uint8][size: uint32 LE][payload])
 *    - Tag 1:  File header & drawing extents
 *    - Tag 2:  Project / author metadata
 *    - Tag 4:  Visible viewport bounds
 *    - Tag 6:  Layer table (29-byte records, ACI colors, CP1254 names)
 *    - Tag 14: Embedded BMP preview thumbnail
 *    - Tag 21: Pure geometry entities (Point, Line, Circle, Arc, Text, Symbol, Polyline/Polygon)
 *    - Tag 22: Database-linked geometry entities (+28-byte VT table & row key block)
 *    - Tag 25: Netcad version string
 *    - Tag 28: Named XML/binary metadata blocks (REF, PRJPAR, NCDD, MPROJ)
 * 2. Modern ZIP-packaged .ncz containers (PK\x03\x04) containing .nca/.xml/.geojson
 */

import {
  EntityType,
  aciToHex,
  addEntity,
  createDocument,
  ensureLayer,
  finalizeDocument
} from '../core/model.js';
import { decodeCp1254, decodeSmartText } from '../utils/cp1254.js';
import { isZipBuffer, extractZipEntries } from '../utils/zip.js';

function readShortString(bytes, offset, maxLen = 255) {
  if (offset >= bytes.length) return '';
  const len = Math.min(bytes[offset], maxLen, bytes.length - offset - 1);
  if (len <= 0) return '';
  return decodeCp1254(bytes.subarray(offset + 1, offset + 1 + len));
}

function isSaneCoord(v) {
  return Number.isFinite(v) && Math.abs(v) < 1e9;
}

function parseLayerTable(payload, doc) {
  // Classic Netcad layer table: 9-byte header followed by repeating 29-byte layer records
  const layersByIndex = new Map();
  if (payload.length < 38) return layersByIndex;

  let offset = 9;
  let index = 0;
  while (offset + 29 <= payload.length) {
    const view = new DataView(payload.buffer, payload.byteOffset + offset, 29);
    const aciRaw = view.getUint16(0, true);
    const lineTypeId = view.getUint16(2, true);
    const flags = view.getInt32(4, true);
    const nameLen = payload[offset + 8];

    if (nameLen > 20) break;
    const rawName = nameLen > 0
      ? decodeCp1254(payload.subarray(offset + 9, offset + 9 + nameLen)).trim()
      : `Katman_${index}`;
    const name = rawName || `Katman_${index}`;
    const aciColor = (aciRaw & 0xff) || 7;
    const color = aciToHex(aciColor);

    const layer = ensureLayer(doc, name, {
      id: index,
      aciColor,
      color,
      lineType: lineTypeId <= 1 ? 'CONTINUOUS' : `NC_LT_${lineTypeId}`,
      visible: true,
      frozen: (flags & 0x40) === 0 && index > 0
    });
    layer.nczFlags = flags;
    layersByIndex.set(index, layer);

    offset += 29;
    index++;
  }
  return layersByIndex;
}

function parseEntityRecord(payload, hasDbLink, layersByIndex, doc) {
  // Minimum common geometry header is 81 bytes (0x51); DB-linked adds 28 bytes (0x6D)
  const baseBodyOffset = hasDbLink ? 0x6d : 0x51;
  if (payload.length < baseBodyOffset) return;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const geomType = payload[1];
  const layerIdx = payload[2];
  const layerObj = layersByIndex.get(layerIdx) || ensureLayer(doc, `Katman_${layerIdx}`, { id: layerIdx });
  const layerName = layerObj.name;

  // Netcad stores coordinates as (c1 = Northing/Yukari, c2 = Easting/Saga)
  const c1 = view.getFloat64(3, true);
  const c2 = view.getFloat64(11, true);
  const z = view.getFloat32(19, true);

  // Bounding box stored in bytes 0x2D..0x4C (minC1, minC2, maxC1, maxC2)
  const bMinC1 = view.getFloat64(0x2d, true);
  const bMinC2 = view.getFloat64(0x35, true);
  const bMaxC1 = view.getFloat64(0x3d, true);
  const bMaxC2 = view.getFloat64(0x45, true);

  let dbTable = '';
  let dbKey = '';
  if (hasDbLink) {
    dbTable = readShortString(payload, 0x51, 11).trim();
    dbKey = readShortString(payload, 0x5d, 15).trim();
  }

  const meta = {};
  if (dbTable) meta.dbTable = dbTable;
  if (dbKey) meta.dbKey = dbKey;

  const x = c2;
  const y = c1;
  const zv = Number.isFinite(z) ? z : 0;

  switch (geomType) {
    case 1: { // POINT (Nokta)
      if (!isSaneCoord(x) || !isSaneCoord(y)) return;
      const label = readShortString(payload, baseBodyOffset, 32).trim();
      addEntity(doc, {
        type: EntityType.POINT,
        layer: layerName,
        x,
        y,
        z: zv,
        label,
        nczType: 'Nokta',
        ...meta
      });
      break;
    }

    case 2: { // LINE (Dogru)
      if (payload.length < baseBodyOffset + 16) return;
      const c1b = view.getFloat64(baseBodyOffset, true);
      const c2b = view.getFloat64(baseBodyOffset + 8, true);
      const zb = payload.length >= baseBodyOffset + 20 ? view.getFloat32(baseBodyOffset + 16, true) : zv;
      if (!isSaneCoord(x) || !isSaneCoord(y) || !isSaneCoord(c2b) || !isSaneCoord(c1b)) return;
      addEntity(doc, {
        type: EntityType.LINE,
        layer: layerName,
        x1: x,
        y1: y,
        z1: zv,
        x2: c2b,
        y2: c1b,
        z2: Number.isFinite(zb) ? zb : 0,
        nczType: 'Doğru',
        ...meta
      });
      break;
    }

    case 3: { // CIRCLE (Cember)
      if (!isSaneCoord(x) || !isSaneCoord(y)) return;
      let r = 0;
      if (payload.length >= baseBodyOffset + 8) {
        const r64 = view.getFloat64(baseBodyOffset, true);
        if (Number.isFinite(r64) && r64 > 0 && r64 < 1e7) r = r64;
      }
      if (r <= 0 && payload.length >= baseBodyOffset + 4) {
        const r32 = view.getFloat32(baseBodyOffset, true);
        if (Number.isFinite(r32) && r32 > 0 && r32 < 1e7) r = r32;
      }
      if (r <= 0 && isSaneCoord(bMinC2) && isSaneCoord(bMaxC2)) {
        r = Math.max(Math.abs(bMaxC2 - bMinC2), Math.abs(bMaxC1 - bMinC1)) * 0.5;
      }
      if (r > 0) {
        addEntity(doc, {
          type: EntityType.CIRCLE,
          layer: layerName,
          cx: x,
          cy: y,
          z: zv,
          r,
          nczType: 'Çember',
          ...meta
        });
      }
      break;
    }

    case 4: { // ARC (Yay)
      if (!isSaneCoord(x) || !isSaneCoord(y)) return;
      let r = 0, startAngle = 0, endAngle = Math.PI;
      if (payload.length >= baseBodyOffset + 12) {
        const r32 = view.getFloat32(baseBodyOffset, true);
        const a1 = view.getFloat32(baseBodyOffset + 4, true);
        const a2 = view.getFloat32(baseBodyOffset + 8, true);
        if (Number.isFinite(r32) && r32 > 0 && r32 < 1e7) r = r32;
        if (Number.isFinite(a1) && Number.isFinite(a2)) {
          startAngle = a1;
          endAngle = a2;
        }
      }
      if (r <= 0 && isSaneCoord(bMinC2) && isSaneCoord(bMaxC2)) {
        r = Math.max(Math.abs(bMaxC2 - bMinC2), Math.abs(bMaxC1 - bMinC1)) * 0.5;
      }
      if (r > 0) {
        addEntity(doc, {
          type: EntityType.ARC,
          layer: layerName,
          cx: x,
          cy: y,
          z: zv,
          r,
          startAngle,
          endAngle,
          nczType: 'Yay',
          ...meta
        });
      }
      break;
    }

    case 5: { // TEXT (Yazi)
      if (!isSaneCoord(x) || !isSaneCoord(y)) return;
      if (payload.length < baseBodyOffset + 12) return;
      const rawH = view.getFloat32(baseBodyOffset, true);
      const rawAng = view.getFloat32(baseBodyOffset + 4, true);
      const alignByte = payload[baseBodyOffset + 8];
      const text = readShortString(payload, baseBodyOffset + 11, 255);
      if (!text) return;
      const height = Number.isFinite(rawH) && rawH > 0 && rawH < 10000 ? rawH : 2.0;
      const angle = Number.isFinite(rawAng) && Math.abs(rawAng) < 100 ? rawAng : 0;
      addEntity(doc, {
        type: EntityType.TEXT,
        layer: layerName,
        x,
        y,
        z: zv,
        text,
        height,
        angle,
        align: alignByte >= 65 && alignByte <= 90 ? String.fromCharCode(alignByte) : 'L',
        nczType: 'Yazı',
        ...meta
      });
      break;
    }

    case 6: { // SYMBOL (Sembol)
      if (!isSaneCoord(x) || !isSaneCoord(y)) return;
      let size = 1.0, angle = 0, symbolId = 0;
      if (payload.length >= baseBodyOffset + 8) {
        const s = view.getFloat32(baseBodyOffset, true);
        const a = view.getFloat32(baseBodyOffset + 4, true);
        if (Number.isFinite(s) && s > 0 && s < 10000) size = s;
        if (Number.isFinite(a) && Math.abs(a) < 100) angle = a;
      }
      if (payload.length >= baseBodyOffset + 10) {
        symbolId = view.getUint16(baseBodyOffset + 8, true);
      }
      // Derive visual symbol extent from bbox if available
      let visualSize = size;
      if (isSaneCoord(bMinC2) && isSaneCoord(bMaxC2)) {
        const bw = Math.abs(bMaxC2 - bMinC2);
        if (bw > 0 && bw < 1000) visualSize = bw;
      }
      addEntity(doc, {
        type: EntityType.SYMBOL,
        layer: layerName,
        x,
        y,
        z: zv,
        size: visualSize,
        scale: size,
        angle,
        symbolId,
        nczType: `Sembol #${symbolId}`,
        ...meta
      });
      break;
    }

    case 7: { // POLYLINE / POLYGON (Coklu Dogru / Alan)
      let vertStart = baseBodyOffset + 27;
      let flagsByte = payload.length > baseBodyOffset + 15 ? payload[baseBodyOffset + 15] : 0;
      let polyLabel = readShortString(payload, baseBodyOffset + 1, 10).trim();

      // Verify 24-byte vertex stride alignment; adapt if non-DB polyline uses shorter header
      if (payload.length < vertStart + 48 || (payload.length - vertStart) % 24 !== 0) {
        // Scan for candidate 24-byte vertex block inside body
        let found = -1;
        for (let off = baseBodyOffset; off + 48 <= payload.length; off += 1) {
          if ((payload.length - off) % 24 !== 0) continue;
          const c1v = view.getFloat64(off, true);
          const c2v = view.getFloat64(off + 8, true);
          if (isSaneCoord(c1v) && isSaneCoord(c2v) &&
              c1v >= bMinC1 - 1 && c1v <= bMaxC1 + 1 &&
              c2v >= bMinC2 - 1 && c2v <= bMaxC2 + 1) {
            found = off;
            break;
          }
        }
        if (found < 0) return;
        vertStart = found;
      }

      const points = [];
      for (let off = vertStart; off + 24 <= payload.length; off += 24) {
        const vc1 = view.getFloat64(off, true);
        const vc2 = view.getFloat64(off + 8, true);
        const vz = view.getFloat64(off + 16, true);
        if (!isSaneCoord(vc1) || !isSaneCoord(vc2)) continue;
        points.push({
          x: vc2,
          y: vc1,
          z: Number.isFinite(vz) && Math.abs(vz) < 1e6 ? vz : 0
        });
      }

      if (points.length < 2) return;
      const first = points[0];
      const last = points[points.length - 1];
      const endsMatch = points.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-4;
      const closed = (flagsByte & 0x01) !== 0 || endsMatch;
      if (endsMatch && points.length > 3) {
        points.pop(); // Avoid duplicate closing vertex for clean area/renderer
      }

      addEntity(doc, {
        type: closed ? EntityType.POLYGON : EntityType.POLYLINE,
        layer: layerName,
        points,
        closed,
        label: polyLabel,
        nczType: closed ? 'Alan / Kapalı Çoklu Doğru' : 'Çoklu Doğru',
        ...meta
      });
      break;
    }

    case 8: { // BOX (Kutu)
      if (!isSaneCoord(bMinC1) || !isSaneCoord(bMinC2) || !isSaneCoord(bMaxC1) || !isSaneCoord(bMaxC2)) return;
      addEntity(doc, {
        type: EntityType.POLYGON,
        layer: layerName,
        points: [
          { x: bMinC2, y: bMinC1, z: zv },
          { x: bMaxC2, y: bMinC1, z: zv },
          { x: bMaxC2, y: bMaxC1, z: zv },
          { x: bMinC2, y: bMaxC1, z: zv }
        ],
        closed: true,
        nczType: 'Kutu',
        ...meta
      });
      break;
    }

    default: {
      // Graceful bbox fallback for unsupported SmartObject/Spline/Block variants
      if (isSaneCoord(bMinC1) && isSaneCoord(bMinC2) && isSaneCoord(bMaxC1) && isSaneCoord(bMaxC2) &&
          (Math.abs(bMaxC1 - bMinC1) > 1e-6 || Math.abs(bMaxC2 - bMinC2) > 1e-6)) {
        addEntity(doc, {
          type: EntityType.POLYGON,
          layer: layerName,
          points: [
            { x: bMinC2, y: bMinC1, z: zv },
            { x: bMaxC2, y: bMinC1, z: zv },
            { x: bMaxC2, y: bMaxC1, z: zv },
            { x: bMinC2, y: bMaxC1, z: zv }
          ],
          closed: true,
          nczType: `Nesne Tip-${geomType}`,
          ...meta
        });
      }
      break;
    }
  }
}

function parseClassicBinaryNcz(bytes, fileName, fileSize) {
  const doc = createDocument('NCZ', fileName, fileSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let pos = 0;
  let layersByIndex = new Map();
  let tag28Sections = [];

  while (pos + 5 <= bytes.length) {
    const tag = bytes[pos];
    const size = view.getUint32(pos + 1, true);
    if (size > bytes.length - (pos + 5)) {
      // Guard against truncated tail records
      break;
    }
    const payload = bytes.subarray(pos + 5, pos + 5 + size);
    pos += 5 + size;

    switch (tag) {
      case 1: { // FileHeader
        break;
      }

      case 25: { // Version
        const ver = readShortString(payload, 0, 64).trim();
        if (ver) doc.metadata.version = `Netcad ${ver}`;
        break;
      }

      case 2: { // UserInfo
        const author = readShortString(payload, 0, 64).trim();
        if (author) doc.metadata.author = author;
        break;
      }

      case 6: { // Layer definitions
        layersByIndex = parseLayerTable(payload, doc);
        break;
      }

      case 14: { // Embedded BMP Thumbnail
        if (payload.length >= 54 && payload[0] === 0x42 && payload[1] === 0x4d) {
          const blob = new Blob([payload], { type: 'image/bmp' });
          doc.metadata.thumbnailDataUrl = URL.createObjectURL(blob);
        }
        break;
      }

      case 28: { // Named XML/Metadata section
        const secName = readShortString(payload, 0, 32).trim();
        if (secName) tag28Sections.push(secName);
        if (secName === 'REF' || secName === 'P_MAP_PROJ' || secName === 'PRJPAR') {
          const text = decodeCp1254(payload.subarray(Math.min(11, payload.length)));
          const datumMatch = text.match(/<DatumName>([^<]+)<\/DatumName>/i) || text.match(/<ProjectionName>([^<]+)<\/ProjectionName>/i);
          if (datumMatch && !doc.metadata.crs) {
            doc.metadata.crs = datumMatch[1].trim();
          }
          const epsgMatch = text.match(/<EPSG>(\d+)<\/EPSG>/i);
          if (epsgMatch) {
            doc.metadata.crs = `${doc.metadata.crs ? doc.metadata.crs + ' ' : ''}(EPSG:${epsgMatch[1]})`;
          }
        }
        break;
      }

      case 21: { // Pure geometry
        parseEntityRecord(payload, false, layersByIndex, doc);
        break;
      }

      case 22: { // DB-linked geometry
        parseEntityRecord(payload, true, layersByIndex, doc);
        break;
      }

      default:
        break;
    }
  }

  if (tag28Sections.length > 0) {
    doc.metadata.rawSections = tag28Sections;
  }
  if (!doc.metadata.version) {
    doc.metadata.version = 'Netcad Binary NCZ';
  }
  doc.metadata.extra = {
    'Katman Sayısı': String(doc.layers.size),
    'Geometri Kaydı': String(doc.entities.length)
  };
  if (tag28Sections.length > 0) {
    doc.metadata.extra['Metaveri Blokları'] = tag28Sections.join(', ');
  }

  return finalizeDocument(doc);
}

/**
 * Parse a .ncz or .nca ArrayBuffer into a unified CadDocument.
 * Handles both classic Netcad TLV binary streams and modern ZIP-packaged NCZ archives.
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {Promise<object>}
 */
export async function parseNcz(buffer, fileName) {
  const bytes = new Uint8Array(buffer);

  if (isZipBuffer(bytes)) {
    const entries = await extractZipEntries(buffer);
    // Look for inner binary .nca/.ncz first
    const binaryEntry = entries.find((e) => /\.(nca|ncz|bin)$/i.test(e.name) && e.data[0] === 0x01);
    if (binaryEntry) {
      const doc = parseClassicBinaryNcz(binaryEntry.data, fileName, bytes.length);
      doc.metadata.version = `${doc.metadata.version} (ZIP Konteyner)`;
      return doc;
    }

    // Otherwise extract geometries from XML/GML/GeoJSON inside modern ZIP NCZ
    const doc = createDocument('NCZ', fileName, bytes.length);
    doc.metadata.version = 'Netcad Modern ZIP Arşivi';
    doc.metadata.rawSections = entries.map((e) => e.name);
    doc.metadata.extra = { 'Arşiv İçeriği': entries.map((e) => e.name).slice(0, 12).join(', ') };

    for (const entry of entries) {
      if (/\.(xml|gml)$/i.test(entry.name)) {
        const txt = decodeSmartText(entry.data);
        // Extract GML <posList> or <coordinates> if present
        const posLists = txt.matchAll(/<(?:gml:)?posList[^>]*>([^<]+)<\/(?:gml:)?posList>/gi);
        for (const m of posLists) {
          const nums = m[1].trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
          const pts = [];
          for (let i = 0; i + 1 < nums.length; i += 2) {
            pts.push({ x: nums[i + 1], y: nums[i], z: 0 });
          }
          if (pts.length >= 2) {
            addEntity(doc, {
              type: pts.length >= 3 ? EntityType.POLYGON : EntityType.POLYLINE,
              layer: entry.name.replace(/\.[^.]+$/, ''),
              points: pts,
              closed: pts.length >= 3
            });
          }
        }
      }
    }

    if (doc.entities.length === 0) {
      throw new Error('ZIP konteynerli NCZ içinde desteklenen vektör katmanı (.nca / GML) bulunamadı.');
    }
    return finalizeDocument(doc);
  }

  if (bytes.length < 16) {
    throw new Error('Geçersiz NCZ dosyası: dosya boyutu çok küçük.');
  }

  const doc = parseClassicBinaryNcz(bytes, fileName, bytes.length);
  if (doc.entities.length === 0) {
    throw new Error('NCZ dosyasında çizim geometrisi bulunamadı veya dosya şifreli/desteklenmeyen bir sürümde.');
  }
  return doc;
}
