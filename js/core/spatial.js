/**
 * Grid Spatial Index, Exact Hit-Testing, and CAD Object Snap (OSNAP).
 */

import { EntityType } from './model.js';

const GRID_RES = 48;

export function displayXY(x, y, swapAxes) {
  return swapAxes ? { x: y, y: x } : { x, y };
}

export function buildSpatialIndex(doc) {
  const b = doc.bounds;
  const spanX = Math.max(1e-6, b.maxX - b.minX);
  const spanY = Math.max(1e-6, b.maxY - b.minY);
  const cells = new Map();
  const globalEntities = [];

  for (const e of doc.entities) {
    const eb = e.bounds;
    if (!eb) continue;
    const gx0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((eb.minX - b.minX) / spanX) * GRID_RES)));
    const gx1 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((eb.maxX - b.minX) / spanX) * GRID_RES)));
    const gy0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((eb.minY - b.minY) / spanY) * GRID_RES)));
    const gy1 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((eb.maxY - b.minY) / spanY) * GRID_RES)));

    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 120) {
      globalEntities.push(e);
      continue;
    }

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = (gx << 8) | gy;
        let arr = cells.get(key);
        if (!arr) {
          arr = [];
          cells.set(key, arr);
        }
        arr.push(e);
      }
    }
  }

  return { b, spanX, spanY, cells, globalEntities };
}

export function querySpatialBox(doc, index, minDX, minDY, maxDX, maxDY, swapAxes) {
  if (!index) return doc.entities;
  // Convert display-space query box back to canonical bounds
  const minX = swapAxes ? minDY : minDX;
  const maxX = swapAxes ? maxDY : maxDX;
  const minY = swapAxes ? minDX : minDY;
  const maxY = swapAxes ? maxDX : maxDY;

  const { b, spanX, spanY, cells, globalEntities } = index;
  const gx0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((minX - b.minX) / spanX) * GRID_RES)));
  const gx1 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((maxX - b.minX) / spanX) * GRID_RES)));
  const gy0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((minY - b.minY) / spanY) * GRID_RES)));
  const gy1 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(((maxY - b.minY) / spanY) * GRID_RES)));

  const seen = new Set();
  const out = [];
  for (const e of globalEntities) {
    seen.add(e.id);
    out.push(e);
  }
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const arr = cells.get((gx << 8) | gy);
      if (!arr) continue;
      for (const e of arr) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
  }
  return out;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolygon(px, py, pts, swapAxes) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = displayXY(pts[i].x, pts[i].y, swapAxes);
    const b = displayXY(pts[j].x, pts[j].y, swapAxes);
    if (((a.y > py) !== (b.y > py)) &&
        (px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y + 1e-18) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Find the closest visible entity at display-space coordinate (wx, wy).
 */
export function hitTest(doc, index, wx, wy, tol, swapAxes) {
  const candidates = querySpatialBox(doc, index, wx - tol, wy - tol, wx + tol, wy + tol, swapAxes);
  let best = null;
  let bestScore = Infinity;

  for (const e of candidates) {
    const layer = doc.layers.get(e.layer);
    if (layer && !layer.visible) continue;

    let d = Infinity;
    switch (e.type) {
      case EntityType.POINT:
      case EntityType.SYMBOL: {
        const p = displayXY(e.x, e.y, swapAxes);
        d = Math.hypot(wx - p.x, wy - p.y);
        break;
      }
      case EntityType.TEXT: {
        const p = displayXY(e.x, e.y, swapAxes);
        const h = e.height || 2;
        const w = (e.text?.length || 2) * h * 0.6;
        // Check rotated anchor or bounding area
        const dx = wx - p.x;
        const dy = wy - p.y;
        const ang = e.angle || 0;
        const lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
        const ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
        if (lx >= -tol && lx <= w + tol && ly >= -h * 0.4 - tol && ly <= h * 1.2 + tol) {
          d = Math.hypot(dx, dy) * 0.25;
        }
        break;
      }
      case EntityType.LINE: {
        const p1 = displayXY(e.x1, e.y1, swapAxes);
        const p2 = displayXY(e.x2, e.y2, swapAxes);
        d = distToSegment(wx, wy, p1.x, p1.y, p2.x, p2.y);
        break;
      }
      case EntityType.CIRCLE: {
        const c = displayXY(e.cx, e.cy, swapAxes);
        const edgeD = Math.abs(Math.hypot(wx - c.x, wy - c.y) - e.r);
        d = edgeD;
        break;
      }
      case EntityType.ARC: {
        const c = displayXY(e.cx, e.cy, swapAxes);
        const dist = Math.hypot(wx - c.x, wy - c.y);
        if (Math.abs(dist - e.r) <= tol) {
          let ang = Math.atan2(wy - c.y, wx - c.x);
          if (swapAxes) ang = Math.PI * 0.5 - ang;
          let a0 = e.startAngle;
          let a1 = e.endAngle;
          while (a1 <= a0) a1 += Math.PI * 2;
          while (ang < a0) ang += Math.PI * 2;
          if (ang <= a1 + 0.05) d = Math.abs(dist - e.r);
        }
        break;
      }
      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const pts = e.points;
        if (!pts || pts.length < 2) break;
        for (let i = 1; i < pts.length; i++) {
          const a = displayXY(pts[i - 1].x, pts[i - 1].y, swapAxes);
          const b = displayXY(pts[i].x, pts[i].y, swapAxes);
          d = Math.min(d, distToSegment(wx, wy, a.x, a.y, b.x, b.y));
        }
        const isClosed = e.closed || e.type === EntityType.POLYGON || e.type === EntityType.FACE3D;
        if (isClosed && pts.length >= 3) {
          const a = displayXY(pts[pts.length - 1].x, pts[pts.length - 1].y, swapAxes);
          const b = displayXY(pts[0].x, pts[0].y, swapAxes);
          d = Math.min(d, distToSegment(wx, wy, a.x, a.y, b.x, b.y));
          // Allow selecting polygon by clicking inside, prioritizing borders first
          if (d > tol && pointInPolygon(wx, wy, pts, swapAxes)) {
            d = tol * 0.85;
          }
        }
        break;
      }
      default:
        break;
    }

    if (d <= tol && d < bestScore) {
      bestScore = d;
      best = e;
    }
  }

  return best;
}

/**
 * Find the closest CAD OSNAP target (endpoint, midpoint, or center) within tolerance.
 */
export function findSnapPoint(doc, index, wx, wy, tol, swapAxes) {
  const candidates = querySpatialBox(doc, index, wx - tol, wy - tol, wx + tol, wy + tol, swapAxes);
  let best = null;
  let bestDist = tol;

  const trySnap = (px, py, pz, kind, entityId) => {
    const p = displayXY(px, py, swapAxes);
    const d = Math.hypot(wx - p.x, wy - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: p.x, y: p.y, z: pz || 0, kind, entityId };
    }
  };

  for (const e of candidates) {
    const layer = doc.layers.get(e.layer);
    if (layer && !layer.visible) continue;

    switch (e.type) {
      case EntityType.POINT:
      case EntityType.SYMBOL:
      case EntityType.TEXT:
        trySnap(e.x, e.y, e.z, 'endpoint', e.id);
        break;
      case EntityType.LINE:
        trySnap(e.x1, e.y1, e.z1, 'endpoint', e.id);
        trySnap(e.x2, e.y2, e.z2, 'endpoint', e.id);
        trySnap((e.x1 + e.x2) * 0.5, (e.y1 + e.y2) * 0.5, ((e.z1 || 0) + (e.z2 || 0)) * 0.5, 'midpoint', e.id);
        break;
      case EntityType.CIRCLE:
      case EntityType.ARC:
      case EntityType.ELLIPSE:
        trySnap(e.cx, e.cy, e.z, 'center', e.id);
        break;
      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const pts = e.points || [];
        for (let i = 0; i < pts.length; i++) {
          trySnap(pts[i].x, pts[i].y, pts[i].z, 'endpoint', e.id);
          if (i + 1 < pts.length) {
            trySnap(
              (pts[i].x + pts[i + 1].x) * 0.5,
              (pts[i].y + pts[i + 1].y) * 0.5,
              ((pts[i].z || 0) + (pts[i + 1].z || 0)) * 0.5,
              'midpoint',
              e.id
            );
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return best;
}
