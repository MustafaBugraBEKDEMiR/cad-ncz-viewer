/**
 * Netcad ASCII Coordinate Point File (.ncn / .xyz / .txt) Parser.
 * Supports lines formatted as:
 *   PointName  Y(Easting)  X(Northing)  [Z]  [Code]
 * or pure numeric:
 *   X  Y  [Z]
 */

import { EntityType, addEntity, createDocument, finalizeDocument } from '../core/model.js';
import { decodeSmartText } from '../utils/cp1254.js';

export function parseNcn(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const text = decodeSmartText(bytes);
  const doc = createDocument('NCN', fileName, bytes.length);
  doc.metadata.version = 'Netcad NCN Koordinat Listesi';

  const lines = text.split(/\r\n|\n|\r/);
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;

    // Normalize decimal commas only when delimiter is whitespace/tab/semicolon
    const cols = line.includes('\t') || line.includes(';') || /\s+/.test(line)
      ? line.split(/[\s;]+/)
      : line.split(',');

    if (cols.length < 2) continue;

    const toNum = (s) => {
      if (s === undefined) return NaN;
      const cleaned = s.trim().replace(',', '.');
      return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
    };

    const n0 = toNum(cols[0]);
    const n1 = toNum(cols[1]);
    const n2 = toNum(cols[2]);
    const n3 = toNum(cols[3]);

    let label = '';
    let x = 0;
    let y = 0;
    let z = 0;
    let code = '';

    if (Number.isNaN(n0) && !Number.isNaN(n1) && !Number.isNaN(n2)) {
      // Standard Netcad NCN: Name  Y(Easting)  X(Northing)  [Z]  [Code]
      label = cols[0];
      x = n1;
      y = n2;
      if (!Number.isNaN(n3)) {
        z = n3;
        code = cols.slice(4).join(' ').trim();
      } else {
        code = cols.slice(3).join(' ').trim();
      }
    } else if (!Number.isNaN(n0) && !Number.isNaN(n1) && !Number.isNaN(n2)) {
      // Check if 4th col is also a number -> PointID  Y  X  Z  [Code]
      if (!Number.isNaN(n3)) {
        label = cols[0];
        x = n1;
        y = n2;
        z = n3;
        code = cols.slice(4).join(' ').trim();
      } else {
        // Pure XYZ: X Y Z [Code]
        x = n0;
        y = n1;
        z = n2;
        code = cols.slice(3).join(' ').trim();
        label = String(++count);
      }
    } else if (!Number.isNaN(n0) && !Number.isNaN(n1)) {
      // Pure XY
      x = n0;
      y = n1;
      label = String(++count);
    } else {
      continue;
    }

    const layerName = code ? `NCN_${code}` : 'NOKTA';
    addEntity(doc, {
      type: EntityType.POINT,
      layer: layerName,
      x,
      y,
      z,
      label,
      dbTable: code || undefined
    });
  }

  if (doc.entities.length === 0) {
    throw new Error('NCN/XYZ dosyasında geçerli koordinat satırı bulunamadı.');
  }

  doc.metadata.extra = {
    'Nokta Sayısı': String(doc.entities.length),
    'Katman Sayısı': String(doc.layers.size)
  };
  return finalizeDocument(doc);
}
