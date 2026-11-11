/**
 * AutoCAD ASCII DXF Parser (R12 through 2024+).
 * Supports HEADER, TABLES (LAYER), BLOCKS (nested INSERTs), and all major ENTITIES:
 * POINT, LINE, LWPOLYLINE (with bulge arcs), POLYLINE/VERTEX, CIRCLE, ARC,
 * ELLIPSE, SPLINE, TEXT, MTEXT, SOLID, 3DFACE, INSERT, DIMENSION.
 */

import {
  EntityType,
  aciToHex,
  addEntity,
  bulgeToArcPoints,
  createDocument,
  ensureLayer,
  finalizeDocument,
  int24ToHex,
  sampleEllipsePoints
} from '../core/model.js';
import { decodeSmartText } from '../utils/cp1254.js';

const INSUNITS_MAP = {
  0: 'Birimsiz',
  1: 'inç',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
  7: 'km'
};

function cleanMtext(raw) {
  if (!raw) return '';
  return raw
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[fFhHwWcCqQaAlLoOkKtTpP][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[pP]/g, '±')
    .trim();
}

function interpolateSpline(pts) {
  if (pts.length < 3) return pts;
  const result = [];
  const segs = 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      const z = (p1.z || 0) + ((p2.z || 0) - (p1.z || 0)) * t;
      result.push({ x, y, z });
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

function parseDxfPairs(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return pairs;
}

function finalizeRawEntity(raw) {
  if (!raw || !raw.type) return null;
  const type = raw.type;
  const layer = raw.layer || '0';
  const color = raw.trueColor !== undefined
    ? int24ToHex(raw.trueColor)
    : (raw.aci !== undefined && raw.aci !== 256 ? aciToHex(Math.abs(raw.aci)) : null);

  switch (type) {
    case 'POINT':
      return { type: EntityType.POINT, layer, color, x: raw.x || 0, y: raw.y || 0, z: raw.z || 0 };

    case 'LINE':
      return {
        type: EntityType.LINE,
        layer,
        color,
        x1: raw.x || 0,
        y1: raw.y || 0,
        z1: raw.z || 0,
        x2: raw.x2 || 0,
        y2: raw.y2 || 0,
        z2: raw.z2 || 0
      };

    case 'CIRCLE':
      return {
        type: EntityType.CIRCLE,
        layer,
        color,
        cx: raw.x || 0,
        cy: raw.y || 0,
        z: raw.z || 0,
        r: Math.abs(raw.radius || 0)
      };

    case 'ARC':
      return {
        type: EntityType.ARC,
        layer,
        color,
        cx: raw.x || 0,
        cy: raw.y || 0,
        z: raw.z || 0,
        r: Math.abs(raw.radius || 0),
        startAngle: ((raw.startAngle || 0) * Math.PI) / 180,
        endAngle: ((raw.endAngle || 360) * Math.PI) / 180
      };

    case 'ELLIPSE':
      return {
        type: EntityType.ELLIPSE,
        layer,
        color,
        cx: raw.x || 0,
        cy: raw.y || 0,
        z: raw.z || 0,
        mx: raw.x2 ?? 1,
        my: raw.y2 ?? 0,
        ratio: raw.radius || 1,
        startParam: raw.startParam ?? 0,
        endParam: raw.endParam ?? Math.PI * 2
      };

    case 'LWPOLYLINE': {
      const verts = raw.vertices || [];
      if (verts.length < 2) return null;
      const closed = (raw.flags & 1) !== 0;
      const pts = [];
      for (let i = 0; i < verts.length; i++) {
        const cur = verts[i];
        if (i === 0) pts.push({ x: cur.x, y: cur.y, z: raw.elev || 0 });
        const nextIdx = i + 1;
        if (nextIdx < verts.length) {
          const next = { x: verts[nextIdx].x, y: verts[nextIdx].y, z: raw.elev || 0 };
          const seg = bulgeToArcPoints(cur, next, cur.bulge || 0);
          pts.push(...seg);
        } else if (closed && Math.abs(cur.bulge || 0) > 1e-6) {
          const seg = bulgeToArcPoints(cur, { x: verts[0].x, y: verts[0].y, z: raw.elev || 0 }, cur.bulge);
          pts.push(...seg);
        }
      }
      return {
        type: closed ? EntityType.POLYGON : EntityType.POLYLINE,
        layer,
        color,
        points: pts,
        closed
      };
    }

    case 'SPLINE': {
      const src = (raw.fitPoints && raw.fitPoints.length >= 2) ? raw.fitPoints : (raw.ctrlPoints || []);
      if (src.length < 2) return null;
      const closed = (raw.flags & 1) !== 0;
      return {
        type: closed ? EntityType.POLYGON : EntityType.POLYLINE,
        layer,
        color,
        points: interpolateSpline(src),
        closed
      };
    }

    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB': {
      const txt = type === 'MTEXT' ? cleanMtext((raw.textParts || []).join('')) : cleanMtext(raw.text || '');
      if (!txt) return null;
      return {
        type: EntityType.TEXT,
        layer,
        color,
        x: raw.x || 0,
        y: raw.y || 0,
        z: raw.z || 0,
        text: txt,
        height: raw.height || 2.5,
        angle: ((raw.angle || 0) * Math.PI) / 180
      };
    }

    case 'SOLID':
    case '3DFACE': {
      const pts = [
        { x: raw.x || 0, y: raw.y || 0, z: raw.z || 0 },
        { x: raw.x2 || 0, y: raw.y2 || 0, z: raw.z2 || 0 },
        { x: raw.x3 || 0, y: raw.y3 || 0, z: raw.z3 || 0 }
      ];
      if (raw.x4 !== undefined && raw.y4 !== undefined &&
          (Math.abs(raw.x4 - raw.x3) > 1e-6 || Math.abs(raw.y4 - raw.y3) > 1e-6)) {
        pts.push({ x: raw.x4, y: raw.y4, z: raw.z4 || 0 });
      }
      return {
        type: type === '3DFACE' ? EntityType.FACE3D : EntityType.POLYGON,
        layer,
        color,
        points: pts,
        closed: true
      };
    }

    case 'INSERT':
      return {
        type: 'INSERT',
        blockName: raw.blockName || '',
        layer,
        color,
        x: raw.x || 0,
        y: raw.y || 0,
        z: raw.z || 0,
        sx: raw.sx ?? 1,
        sy: raw.sy ?? 1,
        sz: raw.sz ?? 1,
        rotDeg: raw.angle || 0,
        cols: raw.cols || 1,
        rows: raw.rows || 1,
        colSpace: raw.colSpace || 0,
        rowSpace: raw.rowSpace || 0
      };

    case 'DIMENSION':
      if (raw.blockName) {
        return {
          type: 'INSERT',
          blockName: raw.blockName,
          layer,
          color,
          x: 0,
          y: 0,
          z: 0,
          sx: 1,
          sy: 1,
          sz: 1,
          rotDeg: 0
        };
      }
      if (raw.text) {
        return {
          type: EntityType.TEXT,
          layer,
          color,
          x: raw.x2 ?? raw.x ?? 0,
          y: raw.y2 ?? raw.y ?? 0,
          z: raw.z || 0,
          text: cleanMtext(raw.text),
          height: raw.height || 2.5,
          angle: 0
        };
      }
      return null;

    default:
      return null;
  }
}

function transformPoint(pt, tx, ty, tz, sx, sy, sz, cosA, sinA, bx, by, bz) {
  const lx = (pt.x - bx) * sx;
  const ly = (pt.y - by) * sy;
  const lz = ((pt.z || 0) - bz) * sz;
  return {
    x: tx + lx * cosA - ly * sinA,
    y: ty + lx * sinA + ly * cosA,
    z: tz + lz
  };
}

function expandEntities(rawList, blocks, doc, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1, rotDeg = 0, bx = 0, by = 0, bz = 0, parentLayer = null, parentColor = null, depth = 0) {
  if (depth > 8) return;
  const rad = (rotDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  for (const item of rawList) {
    const layer = (item.layer === '0' && parentLayer) ? parentLayer : item.layer;
    const color = item.color || parentColor;

    if (item.type === 'INSERT') {
      const blk = blocks.get(item.blockName);
      if (!blk) continue;
      const cols = Math.max(1, Math.min(50, item.cols || 1));
      const rows = Math.max(1, Math.min(50, item.rows || 1));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = transformPoint(
            { x: item.x + c * (item.colSpace || 0), y: item.y + r * (item.rowSpace || 0), z: item.z },
            tx, ty, tz, sx, sy, sz, cosA, sinA, bx, by, bz
          );
          expandEntities(
            blk.entities,
            blocks,
            doc,
            p.x, p.y, p.z,
            sx * item.sx, sy * item.sy, sz * item.sz,
            rotDeg + item.rotDeg,
            blk.bx, blk.by, blk.bz,
            layer,
            color,
            depth + 1
          );
        }
      }
      continue;
    }

    // Fast path at root depth=0 without block transform
    if (depth === 0 && tx === 0 && ty === 0 && sx === 1 && sy === 1 && rotDeg === 0) {
      addEntity(doc, item);
      continue;
    }

    const xf = (x, y, z = 0) => transformPoint({ x, y, z }, tx, ty, tz, sx, sy, sz, cosA, sinA, bx, by, bz);

    switch (item.type) {
      case EntityType.POINT: {
        const p = xf(item.x, item.y, item.z);
        addEntity(doc, { ...item, layer, color, x: p.x, y: p.y, z: p.z });
        break;
      }
      case EntityType.LINE: {
        const p1 = xf(item.x1, item.y1, item.z1);
        const p2 = xf(item.x2, item.y2, item.z2);
        addEntity(doc, { ...item, layer, color, x1: p1.x, y1: p1.y, z1: p1.z, x2: p2.x, y2: p2.y, z2: p2.z });
        break;
      }
      case EntityType.CIRCLE: {
        if (Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-4) {
          const c = xf(item.cx, item.cy, item.z);
          addEntity(doc, { ...item, layer, color, cx: c.x, cy: c.y, z: c.z, r: item.r * Math.abs(sx) });
        } else {
          // Non-uniformly scaled circle becomes polygon
          const pts = sampleEllipsePoints(item.cx, item.cy, item.r, 0, 1, 0, Math.PI * 2, 36)
            .map((pt) => xf(pt.x, pt.y, item.z));
          addEntity(doc, { type: EntityType.POLYGON, layer, color, points: pts, closed: true });
        }
        break;
      }
      case EntityType.ARC: {
        if (Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-4) {
          const c = xf(item.cx, item.cy, item.z);
          addEntity(doc, {
            ...item,
            layer,
            color,
            cx: c.x,
            cy: c.y,
            z: c.z,
            r: item.r * Math.abs(sx),
            startAngle: item.startAngle + rad,
            endAngle: item.endAngle + rad
          });
        } else {
          const pts = sampleEllipsePoints(item.cx, item.cy, item.r, 0, 1, item.startAngle, item.endAngle, 32)
            .map((pt) => xf(pt.x, pt.y, item.z));
          addEntity(doc, { type: EntityType.POLYLINE, layer, color, points: pts, closed: false });
        }
        break;
      }
      case EntityType.ELLIPSE: {
        const pts = sampleEllipsePoints(item.cx, item.cy, item.mx, item.my, item.ratio, item.startParam, item.endParam, 40)
          .map((pt) => xf(pt.x, pt.y, item.z));
        addEntity(doc, { type: EntityType.POLYLINE, layer, color, points: pts, closed: false });
        break;
      }
      case EntityType.TEXT: {
        const p = xf(item.x, item.y, item.z);
        addEntity(doc, {
          ...item,
          layer,
          color,
          x: p.x,
          y: p.y,
          z: p.z,
          height: item.height * Math.abs(sy),
          angle: item.angle + rad
        });
        break;
      }
      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const pts = item.points.map((pt) => xf(pt.x, pt.y, pt.z));
        addEntity(doc, { ...item, layer, color, points: pts });
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Parse an ASCII DXF file buffer into a unified CadDocument.
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {object}
 */
export function parseDxf(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  // Check binary DXF signature
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) {
    throw new Error('İkili (Binary) DXF biçimi henüz desteklenmiyor. Lütfen ASCII DXF olarak dışa aktarın.');
  }

  const text = decodeSmartText(bytes);
  const pairs = parseDxfPairs(text);
  const doc = createDocument('DXF', fileName, bytes.length);

  const blocks = new Map();
  const rootEntities = [];

  let i = 0;
  let section = '';
  let headerVar = '';
  let inTable = '';
  let curLayer = null;
  let curBlock = null;
  let curEntity = null;
  let inPolyline = null;
  let curVertex = null;

  const pushEntityTarget = (ent) => {
    if (!ent) return;
    if (curBlock) curBlock.entities.push(ent);
    else rootEntities.push(ent);
  };

  const commitCurEntity = () => {
    if (!curEntity) return;
    if (curEntity.type === 'POLYLINE') {
      inPolyline = {
        layer: curEntity.layer || '0',
        color: curEntity.trueColor !== undefined
          ? int24ToHex(curEntity.trueColor)
          : (curEntity.aci !== undefined && curEntity.aci !== 256 ? aciToHex(Math.abs(curEntity.aci)) : null),
        closed: ((curEntity.flags || 0) & 1) !== 0,
        points: []
      };
      curEntity = null;
      return;
    }
    const built = finalizeRawEntity(curEntity);
    pushEntityTarget(built);
    curEntity = null;
  };

  while (i < pairs.length) {
    const [code, val] = pairs[i++];
    const trimmed = val.trim();

    if (code === 0 && trimmed === 'SECTION') {
      const next = pairs[i++];
      if (next && next[0] === 2) {
        section = next[1].trim().toUpperCase();
        doc.metadata.rawSections.push(section);
      }
      continue;
    }

    if (code === 0 && trimmed === 'ENDSEC') {
      commitCurEntity();
      if (curLayer && curLayer.name) {
        ensureLayer(doc, curLayer.name, curLayer);
        curLayer = null;
      }
      section = '';
      inTable = '';
      continue;
    }

    if (section === 'HEADER') {
      if (code === 9) {
        headerVar = trimmed;
      } else if (headerVar === '$ACADVER' && code === 1) {
        doc.metadata.version = trimmed;
      } else if (headerVar === '$INSUNITS' && code === 70) {
        const u = parseInt(trimmed, 10);
        doc.metadata.units = INSUNITS_MAP[u] || `Birim #${u}`;
      }
      continue;
    }

    if (section === 'TABLES') {
      if (code === 0 && trimmed === 'TABLE') {
        const next = pairs[i++];
        inTable = next && next[0] === 2 ? next[1].trim().toUpperCase() : '';
        continue;
      }
      if (code === 0 && trimmed === 'ENDTAB') {
        if (curLayer && curLayer.name) {
          ensureLayer(doc, curLayer.name, curLayer);
          curLayer = null;
        }
        inTable = '';
        continue;
      }
      if (inTable === 'LAYER') {
        if (code === 0 && trimmed === 'LAYER') {
          if (curLayer && curLayer.name) ensureLayer(doc, curLayer.name, curLayer);
          curLayer = { name: '', aciColor: 7, visible: true, frozen: false, lineType: 'CONTINUOUS' };
        } else if (curLayer) {
          if (code === 2) curLayer.name = trimmed;
          else if (code === 6) curLayer.lineType = trimmed;
          else if (code === 62) {
            const c = parseInt(trimmed, 10);
            curLayer.aciColor = Math.abs(c);
            curLayer.color = aciToHex(Math.abs(c));
            if (c < 0) curLayer.visible = false;
          } else if (code === 70) {
            const fl = parseInt(trimmed, 10);
            curLayer.frozen = (fl & 1) !== 0;
            if (curLayer.frozen) curLayer.visible = false;
          }
        }
      }
      continue;
    }

    if (section === 'BLOCKS' || section === 'ENTITIES') {
      if (code === 0) {
        // Handle POLYLINE / VERTEX / SEQEND state machine
        if (inPolyline) {
          if (trimmed === 'VERTEX') {
            if (curVertex) inPolyline.points.push(curVertex);
            curVertex = { x: 0, y: 0, z: 0 };
            continue;
          }
          if (trimmed === 'SEQEND') {
            if (curVertex) {
              inPolyline.points.push(curVertex);
              curVertex = null;
            }
            if (inPolyline.points.length >= 2) {
              pushEntityTarget({
                type: inPolyline.closed ? EntityType.POLYGON : EntityType.POLYLINE,
                layer: inPolyline.layer,
                color: inPolyline.color,
                points: inPolyline.points,
                closed: inPolyline.closed
              });
            }
            inPolyline = null;
            continue;
          }
        }

        commitCurEntity();

        if (section === 'BLOCKS') {
          if (trimmed === 'BLOCK') {
            curBlock = { name: '', bx: 0, by: 0, bz: 0, entities: [] };
            continue;
          }
          if (trimmed === 'ENDBLK') {
            if (curBlock && curBlock.name) {
              blocks.set(curBlock.name, curBlock);
            }
            curBlock = null;
            continue;
          }
        }

        if (trimmed === 'EOF') break;

        // Start a new entity
        curEntity = { type: trimmed, layer: '0' };
        continue;
      }

      if (curVertex) {
        if (code === 10) curVertex.x = parseFloat(trimmed) || 0;
        else if (code === 20) curVertex.y = parseFloat(trimmed) || 0;
        else if (code === 30) curVertex.z = parseFloat(trimmed) || 0;
        continue;
      }

      if (curBlock && !curEntity) {
        if (code === 2 || code === 3) curBlock.name = trimmed;
        else if (code === 10) curBlock.bx = parseFloat(trimmed) || 0;
        else if (code === 20) curBlock.by = parseFloat(trimmed) || 0;
        else if (code === 30) curBlock.bz = parseFloat(trimmed) || 0;
        continue;
      }

      if (!curEntity) continue;

      // Common entity group codes
      if (code === 8) curEntity.layer = trimmed || '0';
      else if (code === 62) curEntity.aci = parseInt(trimmed, 10);
      else if (code === 420) curEntity.trueColor = parseInt(trimmed, 10);
      else if (code === 70) {
        if (curEntity.type === 'INSERT') curEntity.cols = parseInt(trimmed, 10) || 1;
        else curEntity.flags = parseInt(trimmed, 10) || 0;
      } else if (code === 71 && curEntity.type === 'INSERT') curEntity.rows = parseInt(trimmed, 10) || 1;
      else if (code === 10) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'LWPOLYLINE') {
          if (!curEntity.vertices) curEntity.vertices = [];
          curEntity.vertices.push({ x: num, y: 0, bulge: 0 });
        } else if (curEntity.type === 'SPLINE') {
          if (!curEntity.ctrlPoints) curEntity.ctrlPoints = [];
          curEntity.ctrlPoints.push({ x: num, y: 0, z: 0 });
        } else {
          curEntity.x = num;
        }
      } else if (code === 20) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'LWPOLYLINE' && curEntity.vertices?.length) {
          curEntity.vertices[curEntity.vertices.length - 1].y = num;
        } else if (curEntity.type === 'SPLINE' && curEntity.ctrlPoints?.length) {
          curEntity.ctrlPoints[curEntity.ctrlPoints.length - 1].y = num;
        } else {
          curEntity.y = num;
        }
      } else if (code === 30) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'SPLINE' && curEntity.ctrlPoints?.length) {
          curEntity.ctrlPoints[curEntity.ctrlPoints.length - 1].z = num;
        } else {
          curEntity.z = num;
        }
      } else if (code === 11) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'SPLINE') {
          if (!curEntity.fitPoints) curEntity.fitPoints = [];
          curEntity.fitPoints.push({ x: num, y: 0, z: 0 });
        } else {
          curEntity.x2 = num;
        }
      } else if (code === 21) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'SPLINE' && curEntity.fitPoints?.length) {
          curEntity.fitPoints[curEntity.fitPoints.length - 1].y = num;
        } else {
          curEntity.y2 = num;
        }
      } else if (code === 31) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'SPLINE' && curEntity.fitPoints?.length) {
          curEntity.fitPoints[curEntity.fitPoints.length - 1].z = num;
        } else {
          curEntity.z2 = num;
        }
      } else if (code === 12) curEntity.x3 = parseFloat(trimmed) || 0;
      else if (code === 22) curEntity.y3 = parseFloat(trimmed) || 0;
      else if (code === 32) curEntity.z3 = parseFloat(trimmed) || 0;
      else if (code === 13) curEntity.x4 = parseFloat(trimmed) || 0;
      else if (code === 23) curEntity.y4 = parseFloat(trimmed) || 0;
      else if (code === 33) curEntity.z4 = parseFloat(trimmed) || 0;
      else if (code === 38) curEntity.elev = parseFloat(trimmed) || 0;
      else if (code === 40) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'TEXT' || curEntity.type === 'MTEXT' || curEntity.type === 'ATTRIB' || curEntity.type === 'DIMENSION') {
          curEntity.height = num;
        } else {
          curEntity.radius = num;
        }
      } else if (code === 41) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'ELLIPSE') curEntity.startParam = num;
        else if (curEntity.type === 'INSERT') curEntity.sx = num;
      } else if (code === 42) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'LWPOLYLINE' && curEntity.vertices?.length) {
          curEntity.vertices[curEntity.vertices.length - 1].bulge = num;
        } else if (curEntity.type === 'ELLIPSE') curEntity.endParam = num;
        else if (curEntity.type === 'INSERT') curEntity.sy = num;
      } else if (code === 43 && curEntity.type === 'INSERT') curEntity.sz = parseFloat(trimmed) || 1;
      else if (code === 44 && curEntity.type === 'INSERT') curEntity.colSpace = parseFloat(trimmed) || 0;
      else if (code === 45 && curEntity.type === 'INSERT') curEntity.rowSpace = parseFloat(trimmed) || 0;
      else if (code === 50) {
        const num = parseFloat(trimmed) || 0;
        if (curEntity.type === 'ARC') curEntity.startAngle = num;
        else curEntity.angle = num;
      } else if (code === 51 && curEntity.type === 'ARC') curEntity.endAngle = parseFloat(trimmed) || 0;
      else if (code === 1 || code === 3) {
        if (curEntity.type === 'MTEXT') {
          if (!curEntity.textParts) curEntity.textParts = [];
          curEntity.textParts.push(val);
        } else if (code === 1) {
          curEntity.text = val;
        }
      } else if (code === 2) {
        curEntity.blockName = trimmed;
      }
    }
  }

  expandEntities(rootEntities, blocks, doc);

  if (!doc.metadata.version) doc.metadata.version = 'ASCII DXF';
  doc.metadata.extra = {
    'Katman Sayısı': String(doc.layers.size),
    'Blok Tanımı': String(blocks.size),
    'Çizim Nesnesi': String(doc.entities.length)
  };

  return finalizeDocument(doc);
}
