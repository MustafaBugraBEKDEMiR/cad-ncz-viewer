/**
 * Unified CAD Document Model, ACI 256 Color Palette, and Double-Precision Geometry Math.
 */

export const EntityType = Object.freeze({
  POINT: 'POINT',
  LINE: 'LINE',
  POLYLINE: 'POLYLINE',
  POLYGON: 'POLYGON',
  CIRCLE: 'CIRCLE',
  ARC: 'ARC',
  ELLIPSE: 'ELLIPSE',
  TEXT: 'TEXT',
  SYMBOL: 'SYMBOL',
  FACE3D: 'FACE3D'
});

// Standard AutoCAD / Netcad Color Index (ACI) 0..255 palette
const BASE_ACI = [
  '#ffffff', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff',
  '#808080', '#c0c0c0', '#ff0000', '#ff7f7f', '#cc0000', '#cc6666', '#990000', '#994c4c',
  '#7f0000', '#7f3f3f', '#4c0000', '#4c2626', '#ff3f00', '#ff9f7f', '#cc3300', '#cc7f66',
  '#992600', '#995f4c', '#7f1f00', '#7f4f3f', '#4c1300', '#4c2f26', '#ff7f00', '#ffbf7f',
  '#cc6600', '#cc9966', '#994c00', '#99724c', '#7f3f00', '#7f5f3f', '#4c2600', '#4c3926',
  '#ffbf00', '#ffdf7f', '#cc9900', '#ccb266', '#997200', '#99854c', '#7f5f00', '#7f6f3f',
  '#4c3900', '#4c4226', '#ffff00', '#ffff7f', '#cccc00', '#cccc66', '#999900', '#99994c',
  '#7f7f00', '#7f7f3f', '#4c4c00', '#4c4c26', '#bfff00', '#dfff7f', '#99cc00', '#b2cc66',
  '#729900', '#85994c', '#5f7f00', '#6f7f3f', '#394c00', '#424c26', '#7fff00', '#bfff7f',
  '#66cc00', '#99cc66', '#4c9900', '#72994c', '#3f7f00', '#5f7f3f', '#264c00', '#394c26',
  '#3fff00', '#9fff7f', '#33cc00', '#7fcc66', '#269900', '#5f994c', '#1f7f00', '#4f7f3f',
  '#134c00', '#2f4c26', '#00ff00', '#7fff7f', '#00cc00', '#66cc66', '#009900', '#4c994c',
  '#007f00', '#3f7f3f', '#004c00', '#264c26', '#00ff3f', '#7fff9f', '#00cc33', '#66cc7f',
  '#009926', '#4c995f', '#007f1f', '#3f7f4f', '#004c13', '#264c2f', '#00ff7f', '#7fffbf',
  '#00cc66', '#66cc99', '#00994c', '#4c9972', '#007f3f', '#3f7f5f', '#004c26', '#264c39',
  '#00ffbf', '#7fffdf', '#00cc99', '#66ccb2', '#009972', '#4c9985', '#007f5f', '#3f7f6f',
  '#004c39', '#264c42', '#00ffff', '#7fffff', '#00cccc', '#66cccc', '#009999', '#4c9999',
  '#007f7f', '#3f7f7f', '#004c4c', '#264c4c', '#00bfff', '#7fdfff', '#0099cc', '#66b2cc',
  '#007299', '#4c8599', '#005f7f', '#3f6f7f', '#00394c', '#26424c', '#007fff', '#7fbfff',
  '#0066cc', '#6699cc', '#004c99', '#4c7299', '#003f7f', '#3f5f7f', '#00264c', '#26394c',
  '#003fff', '#7f9fff', '#0033cc', '#667fcc', '#002699', '#4c5f99', '#001f7f', '#3f4f7f',
  '#00134c', '#262f4c', '#0000ff', '#7f7fff', '#0000cc', '#6666cc', '#000099', '#4c4c99',
  '#00007f', '#3f3f7f', '#00004c', '#26264c', '#3f00ff', '#9f7fff', '#3300cc', '#7f66cc',
  '#260099', '#5f4c99', '#1f007f', '#4f3f7f', '#13004c', '#2f264c', '#7f00ff', '#bf7fff',
  '#6600cc', '#9966cc', '#4c0099', '#724c99', '#3f007f', '#5f3f7f', '#26004c', '#39264c',
  '#bf00ff', '#df7fff', '#9900cc', '#b266cc', '#720099', '#854c99', '#5f007f', '#6f3f7f',
  '#39004c', '#42264c', '#ff00ff', '#ff7fff', '#cc00cc', '#cc66cc', '#990099', '#994c99',
  '#7f007f', '#7f3f7f', '#4c004c', '#4c264c', '#ff00bf', '#ff7fdf', '#cc0099', '#cc66b2',
  '#990072', '#994c85', '#7f005f', '#7f3f6f', '#4c0039', '#4c2642', '#ff007f', '#ff7fbf',
  '#cc0066', '#cc6699', '#99004c', '#994c72', '#7f003f', '#7f3f5f', '#4c0026', '#4c2639',
  '#ff003f', '#ff7f9f', '#cc0033', '#cc667f', '#990026', '#994c5f', '#7f001f', '#7f3f4f',
  '#4c0013', '#4c262f', '#333333', '#505050', '#696969', '#828282', '#bebebe', '#ffffff'
];

/**
 * Convert an ACI color index (0..255) to a CSS hex color string.
 * @param {number} index
 * @returns {string}
 */
export function aciToHex(index) {
  const idx = Math.abs(Math.trunc(index || 0)) % 256;
  return BASE_ACI[idx] || '#e2e8f0';
}

/**
 * Convert a 24-bit DXF trueColor integer (0xRRGGBB) to hex.
 * @param {number} rgbInt
 * @returns {string}
 */
export function int24ToHex(rgbInt) {
  const n = rgbInt >>> 0;
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

/**
 * Adjust foreground CAD stroke color for contrast against light vs dark canvas.
 * @param {string} hex
 * @param {boolean} isLightCanvas
 * @returns {string}
 */
export function adaptColorForTheme(hex, isLightCanvas) {
  if (!hex) return isLightCanvas ? '#0f172a' : '#e2e8f0';
  const h = hex.toLowerCase();
  if (isLightCanvas) {
    if (h === '#ffffff' || h === '#f8fafc' || h === '#f1f5f9' || h === '#e2e8f0') return '#1e293b';
    if (h === '#ffff00') return '#a16207'; // darker amber for yellow on white paper
    if (h === '#00ffff') return '#0e7490'; // deeper cyan on white paper
    if (h === '#00ff00') return '#15803d'; // deeper green on white paper
  } else {
    if (h === '#000000' || h === '#0f172a' || h === '#111827') return '#e2e8f0';
  }
  return hex;
}

/**
 * Create an empty unified CAD document.
 */
export function createDocument(format, fileName, fileSize = 0) {
  return {
    format,
    fileName,
    fileSize,
    defaultSwapAxes: format === 'NCZ' || format === 'NCN',
    hasZ: false,
    metadata: {
      version: '',
      author: '',
      crs: '',
      units: format === 'NCZ' || format === 'NCN' ? 'm' : '',
      thumbnailDataUrl: '',
      extra: {},
      rawSections: []
    },
    layers: new Map(),
    entities: [],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, valid: false }
  };
}

const FALLBACK_COLORS = [
  '#38bdf8', '#22c55e', '#f59e0b', '#ec4899', '#a78bfa',
  '#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#34d399'
];

/**
 * Ensure a layer exists in the document's layer map and return it.
 */
export function ensureLayer(doc, name, opts = {}) {
  const key = (name && String(name).trim()) || '0';
  if (doc.layers.has(key)) {
    const existing = doc.layers.get(key);
    if (opts.color && existing._autoColor) {
      existing.color = opts.color;
      existing._autoColor = false;
    }
    return existing;
  }
  const idx = doc.layers.size;
  const aci = opts.aciColor ?? 7;
  const color = opts.color || (aci !== 7 ? aciToHex(aci) : FALLBACK_COLORS[idx % FALLBACK_COLORS.length]);
  const layer = {
    id: opts.id ?? idx,
    name: key,
    color,
    aciColor: aci,
    lineType: opts.lineType || 'CONTINUOUS',
    visible: opts.visible !== undefined ? opts.visible : true,
    frozen: Boolean(opts.frozen),
    entityCount: 0,
    _autoColor: !opts.color && aci === 7
  };
  doc.layers.set(key, layer);
  return layer;
}

/**
 * Push a normalized entity into the document and compute its bounding box.
 */
export function addEntity(doc, entity) {
  const layer = ensureLayer(doc, entity.layer || '0');
  const id = doc.entities.length;
  const e = {
    id,
    layer: layer.name,
    color: entity.color || null, // null means inherit layer color
    ...entity
  };
  e.bounds = computeEntityBounds(e);
  if (!e.bounds) return null;

  if (Number.isFinite(e.bounds.minZ) && Number.isFinite(e.bounds.maxZ)) {
    if (Math.abs(e.bounds.minZ) > 1e-6 || Math.abs(e.bounds.maxZ) > 1e-6) {
      doc.hasZ = true;
    }
  }

  layer.entityCount++;
  doc.entities.push(e);
  return e;
}

/**
 * Finalize document bounds and summary statistics.
 */
export function finalizeDocument(doc) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let valid = false;

  for (const e of doc.entities) {
    const b = e.bounds;
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    const z0 = Number.isFinite(b.minZ) ? b.minZ : 0;
    const z1 = Number.isFinite(b.maxZ) ? b.maxZ : 0;
    if (z0 < minZ) minZ = z0;
    if (z1 > maxZ) maxZ = z1;
    valid = true;
  }

  if (!valid) {
    doc.bounds = { minX: -100, minY: -100, minZ: 0, maxX: 100, maxY: 100, maxZ: 0, valid: false };
  } else {
    doc.bounds = { minX, minY, minZ, maxX, maxY, maxZ, valid: true };
  }
  return doc;
}

/**
 * Compute bounding box for a single entity in canonical coordinates.
 */
export function computeEntityBounds(e) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const include = (x, y, z = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    const zv = Number.isFinite(z) ? z : 0;
    if (zv < minZ) minZ = zv;
    if (zv > maxZ) maxZ = zv;
  };

  switch (e.type) {
    case EntityType.POINT:
    case EntityType.SYMBOL:
      include(e.x, e.y, e.z);
      if (e.size > 0) {
        const pad = e.size * 0.5;
        include(e.x - pad, e.y - pad, e.z);
        include(e.x + pad, e.y + pad, e.z);
      }
      break;
    case EntityType.TEXT: {
      const h = e.height || 2;
      const w = (e.text ? e.text.length : 1) * h * 0.6;
      include(e.x, e.y, e.z);
      include(e.x + w, e.y + h, e.z);
      include(e.x - w * 0.25, e.y - h * 0.25, e.z);
      break;
    }
    case EntityType.LINE:
      include(e.x1, e.y1, e.z1);
      include(e.x2, e.y2, e.z2);
      break;
    case EntityType.CIRCLE:
      if (!Number.isFinite(e.cx) || !Number.isFinite(e.cy) || !Number.isFinite(e.r)) return null;
      include(e.cx - e.r, e.cy - e.r, e.z);
      include(e.cx + e.r, e.cy + e.r, e.z);
      break;
    case EntityType.ARC: {
      if (!Number.isFinite(e.cx) || !Number.isFinite(e.cy) || !Number.isFinite(e.r)) return null;
      const pts = sampleArcPoints(e.cx, e.cy, e.r, e.startAngle, e.endAngle, 24);
      for (const p of pts) include(p.x, p.y, e.z);
      break;
    }
    case EntityType.ELLIPSE: {
      const pts = sampleEllipsePoints(e.cx, e.cy, e.mx, e.my, e.ratio, e.startParam, e.endParam, 32);
      for (const p of pts) include(p.x, p.y, e.z);
      break;
    }
    case EntityType.POLYLINE:
    case EntityType.POLYGON:
    case EntityType.FACE3D:
      if (!e.points || e.points.length === 0) return null;
      for (const p of e.points) include(p.x, p.y, p.z);
      break;
    default:
      return null;
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Sample points along a circular arc (angles in radians, CCW).
 */
export function sampleArcPoints(cx, cy, r, startRad, endRad, segments = 48) {
  let sweep = endRad - startRad;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2 + 1e-6) sweep = Math.PI * 2;
  const steps = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * segments));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = startRad + (sweep * i) / steps;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Sample points along a DXF ellipse defined by center + major-axis vector + minor/major ratio.
 */
export function sampleEllipsePoints(cx, cy, mx, my, ratio = 1, startParam = 0, endParam = Math.PI * 2, segments = 64) {
  const majorLen = Math.hypot(mx, my);
  if (majorLen === 0) return [{ x: cx, y: cy }];
  const ux = mx / majorLen;
  const uy = my / majorLen;
  const vx = -uy;
  const vy = ux;
  const minorLen = majorLen * ratio;

  let sweep = endParam - startParam;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2 + 1e-6) sweep = Math.PI * 2;
  const steps = Math.max(12, Math.ceil((sweep / (Math.PI * 2)) * segments));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = startParam + (sweep * i) / steps;
    const lx = majorLen * Math.cos(t);
    const ly = minorLen * Math.sin(t);
    pts.push({
      x: cx + lx * ux + ly * vx,
      y: cy + lx * uy + ly * vy
    });
  }
  return pts;
}

/**
 * Convert a DXF LWPOLYLINE bulge segment between p1 and p2 into arc points.
 * bulge = tan(includedAngle / 4). Positive bulge curves CCW, negative curves CW.
 */
export function bulgeToArcPoints(p1, p2, bulge, maxSegs = 24) {
  if (!bulge || Math.abs(bulge) < 1e-6) return [p2];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [p2];

  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(Math.abs(theta) / 2);
  if (sinHalf < 1e-9) return [p2];
  const radius = chord / (2 * sinHalf);

  // Distance from chord midpoint to circle center
  const h = (chord / 2) / Math.tan(theta / 2);
  const mx = (p1.x + p2.x) * 0.5;
  const my = (p1.y + p2.y) * 0.5;
  const nx = -dy / chord;
  const ny = dx / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;

  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(4, Math.min(maxSegs, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 48)));
  const pts = [];
  const z1 = p1.z ?? 0;
  const z2 = p2.z ?? 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = a1 + theta * t;
    pts.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a),
      z: z1 + (z2 - z1) * t
    });
  }
  return pts;
}

/**
 * Total 2D/3D length of an entity.
 */
export function computeEntityLength(e) {
  switch (e.type) {
    case EntityType.LINE:
      return Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    case EntityType.CIRCLE:
      return 2 * Math.PI * e.r;
    case EntityType.ARC: {
      let sweep = e.endAngle - e.startAngle;
      while (sweep <= 0) sweep += Math.PI * 2;
      return e.r * sweep;
    }
    case EntityType.POLYLINE:
    case EntityType.POLYGON:
    case EntityType.FACE3D: {
      const pts = e.points;
      if (!pts || pts.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      if ((e.closed || e.type === EntityType.POLYGON || e.type === EntityType.FACE3D) && pts.length > 2) {
        const first = pts[0], last = pts[pts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) {
          total += Math.hypot(first.x - last.x, first.y - last.y);
        }
      }
      return total;
    }
    default:
      return 0;
  }
}

/**
 * Shoelace polygon area using Float64 origin-shifting for full precision on UTM coordinates.
 */
export function computePolygonArea(points) {
  if (!points || points.length < 3) return 0;
  const ox = points[0].x;
  const oy = points[0].y;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a.x - ox) * (b.y - oy) - (b.x - ox) * (a.y - oy);
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Total area of a closed entity (Polygon, Circle, closed Polyline).
 */
export function computeEntityArea(e) {
  if (e.type === EntityType.CIRCLE) return Math.PI * e.r * e.r;
  if ((e.type === EntityType.POLYGON || e.type === EntityType.FACE3D || (e.type === EntityType.POLYLINE && e.closed)) && e.points?.length >= 3) {
    return computePolygonArea(e.points);
  }
  return 0;
}
