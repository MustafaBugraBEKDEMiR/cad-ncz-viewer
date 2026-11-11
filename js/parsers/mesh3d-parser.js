/**
 * 3D CAD Mesh Parser: Wavefront OBJ & ASCII/Binary STL.
 * Emits FACE3D / POLYLINE entities and activates 3D orbit projection by default.
 */

import { EntityType, addEntity, createDocument, finalizeDocument } from '../core/model.js';
import { decodeSmartText } from '../utils/cp1254.js';

export function parseObj(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const text = decodeSmartText(bytes);
  const doc = createDocument('OBJ', fileName, bytes.length);
  doc.metadata.version = 'Wavefront OBJ 3D';
  doc.defaultView3D = true;

  const verts = [];
  let curLayer = 'Mesh';

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v' && parts.length >= 4) {
      verts.push({
        x: parseFloat(parts[1]) || 0,
        y: parseFloat(parts[2]) || 0,
        z: parseFloat(parts[3]) || 0
      });
    } else if ((cmd === 'g' || cmd === 'o' || cmd === 'usemtl') && parts[1]) {
      curLayer = parts.slice(1).join('_');
    } else if (cmd === 'f' && parts.length >= 4) {
      const pts = [];
      for (let i = 1; i < parts.length; i++) {
        const idxStr = parts[i].split('/')[0];
        let idx = parseInt(idxStr, 10);
        if (idx < 0) idx = verts.length + idx;
        else idx = idx - 1;
        if (verts[idx]) pts.push({ ...verts[idx] });
      }
      if (pts.length >= 3) {
        addEntity(doc, { type: EntityType.FACE3D, layer: curLayer, points: pts, closed: true });
      }
    } else if (cmd === 'l' && parts.length >= 3) {
      const pts = [];
      for (let i = 1; i < parts.length; i++) {
        let idx = parseInt(parts[i], 10);
        if (idx < 0) idx = verts.length + idx;
        else idx = idx - 1;
        if (verts[idx]) pts.push({ ...verts[idx] });
      }
      if (pts.length >= 2) {
        addEntity(doc, { type: EntityType.POLYLINE, layer: curLayer, points: pts, closed: false });
      }
    }
  }

  doc.metadata.extra = {
    'Tepe Noktası (Vertex)': String(verts.length),
    'Yüzey (Face)': String(doc.entities.length)
  };
  return finalizeDocument(doc);
}

export function parseStl(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const doc = createDocument('STL', fileName, bytes.length);
  doc.defaultView3D = true;

  // Distinguish ASCII STL from Binary STL safely
  const headText = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(256, bytes.length)));
  const view = new DataView(buffer);
  const triCount = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  const expectedBinarySize = 84 + triCount * 50;
  const isBinary = bytes.length >= 84 && (expectedBinarySize === bytes.length || !headText.trimStart().startsWith('solid'));

  if (!isBinary) {
    doc.metadata.version = 'ASCII STL 3D';
    const text = decodeSmartText(bytes);
    let curPts = [];
    for (const rawLine of text.split(/\r\n|\n|\r/)) {
      const line = rawLine.trim();
      if (line.startsWith('vertex ')) {
        const p = line.split(/\s+/);
        if (p.length >= 4) {
          curPts.push({ x: parseFloat(p[1]) || 0, y: parseFloat(p[2]) || 0, z: parseFloat(p[3]) || 0 });
        }
      } else if (line.startsWith('endloop') && curPts.length >= 3) {
        addEntity(doc, { type: EntityType.FACE3D, layer: 'STL_Mesh', points: curPts, closed: true });
        curPts = [];
      }
    }
  } else {
    doc.metadata.version = 'Binary STL 3D';
    let offset = 84;
    const maxTris = Math.min(triCount, Math.floor((bytes.length - 84) / 50));
    for (let i = 0; i < maxTris; i++) {
      // Skip 12-byte normal vector
      const v1 = { x: view.getFloat32(offset + 12, true), y: view.getFloat32(offset + 16, true), z: view.getFloat32(offset + 20, true) };
      const v2 = { x: view.getFloat32(offset + 24, true), y: view.getFloat32(offset + 28, true), z: view.getFloat32(offset + 32, true) };
      const v3 = { x: view.getFloat32(offset + 36, true), y: view.getFloat32(offset + 40, true), z: view.getFloat32(offset + 44, true) };
      addEntity(doc, { type: EntityType.FACE3D, layer: 'STL_Mesh', points: [v1, v2, v3], closed: true });
      offset += 50;
    }
  }

  doc.metadata.extra = { 'Üçgen Yüzey': String(doc.entities.length) };
  return finalizeDocument(doc);
}
