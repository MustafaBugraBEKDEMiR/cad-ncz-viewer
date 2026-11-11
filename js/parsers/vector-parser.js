/**
 * Vector Formats Parser: GeoJSON, KML, and SVG.
 */

import { EntityType, addEntity, createDocument, ensureLayer, finalizeDocument } from '../core/model.js';
import { decodeSmartText } from '../utils/cp1254.js';

function addGeoJsonGeometry(geom, props, doc) {
  if (!geom) return;
  const layer = props?.layer || props?.Layer || props?.katman || props?.type || 'GeoJSON';
  const color = props?.stroke || props?.color || null;
  const label = props?.name || props?.ad || props?.label || '';

  const toPt = (c) => ({ x: Number(c[0]) || 0, y: Number(c[1]) || 0, z: Number(c[2]) || 0 });

  switch (geom.type) {
    case 'Point': {
      const p = toPt(geom.coordinates);
      addEntity(doc, { type: EntityType.POINT, layer, color, x: p.x, y: p.y, z: p.z, label, props });
      break;
    }
    case 'MultiPoint': {
      for (const c of geom.coordinates || []) {
        const p = toPt(c);
        addEntity(doc, { type: EntityType.POINT, layer, color, x: p.x, y: p.y, z: p.z, label, props });
      }
      break;
    }
    case 'LineString': {
      const pts = (geom.coordinates || []).map(toPt);
      if (pts.length >= 2) {
        addEntity(doc, { type: EntityType.POLYLINE, layer, color, points: pts, closed: false, label, props });
      }
      break;
    }
    case 'MultiLineString': {
      for (const line of geom.coordinates || []) {
        const pts = line.map(toPt);
        if (pts.length >= 2) {
          addEntity(doc, { type: EntityType.POLYLINE, layer, color, points: pts, closed: false, label, props });
        }
      }
      break;
    }
    case 'Polygon': {
      for (const ring of geom.coordinates || []) {
        const pts = ring.map(toPt);
        if (pts.length >= 3) {
          addEntity(doc, { type: EntityType.POLYGON, layer, color, points: pts, closed: true, label, props });
        }
      }
      break;
    }
    case 'MultiPolygon': {
      for (const poly of geom.coordinates || []) {
        for (const ring of poly) {
          const pts = ring.map(toPt);
          if (pts.length >= 3) {
            addEntity(doc, { type: EntityType.POLYGON, layer, color, points: pts, closed: true, label, props });
          }
        }
      }
      break;
    }
    case 'GeometryCollection': {
      for (const g of geom.geometries || []) {
        addGeoJsonGeometry(g, props, doc);
      }
      break;
    }
    default:
      break;
  }
}

export function parseGeoJson(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const text = decodeSmartText(bytes);
  const json = JSON.parse(text);
  const doc = createDocument('GEOJSON', fileName, bytes.length);
  doc.metadata.version = 'RFC 7946 GeoJSON';

  if (json.type === 'FeatureCollection') {
    for (const f of json.features || []) {
      addGeoJsonGeometry(f.geometry, f.properties || {}, doc);
    }
  } else if (json.type === 'Feature') {
    addGeoJsonGeometry(json.geometry, json.properties || {}, doc);
  } else {
    addGeoJsonGeometry(json, {}, doc);
  }

  if (json.crs?.properties?.name) {
    doc.metadata.crs = json.crs.properties.name;
  }
  doc.metadata.extra = {
    'Katman Sayısı': String(doc.layers.size),
    'Unsur Sayısı': String(doc.entities.length)
  };
  return finalizeDocument(doc);
}

export function parseKml(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const text = decodeSmartText(bytes);
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  const doc = createDocument('KML', fileName, bytes.length);
  doc.metadata.version = 'OGC KML';
  doc.metadata.crs = 'WGS84 (EPSG:4326)';

  const parseCoords = (str) => {
    const pts = [];
    for (const token of str.trim().split(/\s+/)) {
      const parts = token.split(',').map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        pts.push({ x: parts[0], y: parts[1], z: Number.isFinite(parts[2]) ? parts[2] : 0 });
      }
    }
    return pts;
  };

  const placemarks = xml.getElementsByTagName('Placemark');
  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName('name')[0];
    const label = nameEl ? nameEl.textContent.trim() : '';
    const folder = pm.closest('Folder')?.getElementsByTagName('name')[0]?.textContent?.trim();
    const layer = folder || 'KML';

    for (const ptEl of pm.getElementsByTagName('Point')) {
      const coords = ptEl.getElementsByTagName('coordinates')[0]?.textContent || '';
      const pts = parseCoords(coords);
      if (pts[0]) addEntity(doc, { type: EntityType.POINT, layer, ...pts[0], label });
    }
    for (const lsEl of pm.getElementsByTagName('LineString')) {
      const coords = lsEl.getElementsByTagName('coordinates')[0]?.textContent || '';
      const pts = parseCoords(coords);
      if (pts.length >= 2) addEntity(doc, { type: EntityType.POLYLINE, layer, points: pts, closed: false, label });
    }
    for (const polyEl of pm.getElementsByTagName('Polygon')) {
      const coords = polyEl.getElementsByTagName('coordinates')[0]?.textContent || '';
      const pts = parseCoords(coords);
      if (pts.length >= 3) addEntity(doc, { type: EntityType.POLYGON, layer, points: pts, closed: true, label });
    }
  }

  return finalizeDocument(doc);
}

// Parse SVG path d="" attribute into one or more point chains (inverting Y for CAD orientation)
function parseSvgPath(d, flipY = true) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const chains = [];
  let current = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let cmd = '';
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const pt = (x, y) => ({ x, y: flipY ? -y : y, z: 0 });

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        if (current.length >= 2) {
          chains.push({ points: current, closed: true });
        }
        current = [];
        cx = sx;
        cy = sy;
        continue;
      }
    }
    if (!cmd) break;

    switch (cmd) {
      case 'M':
      case 'm': {
        if (current.length >= 2) chains.push({ points: current, closed: false });
        const nx = num(), ny = num();
        cx = cmd === 'm' ? cx + nx : nx;
        cy = cmd === 'm' ? cy + ny : ny;
        sx = cx; sy = cy;
        current = [pt(cx, cy)];
        cmd = cmd === 'm' ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'l': {
        const nx = num(), ny = num();
        cx = cmd === 'l' ? cx + nx : nx;
        cy = cmd === 'l' ? cy + ny : ny;
        current.push(pt(cx, cy));
        break;
      }
      case 'H':
      case 'h': {
        const nx = num();
        cx = cmd === 'h' ? cx + nx : nx;
        current.push(pt(cx, cy));
        break;
      }
      case 'V':
      case 'v': {
        const ny = num();
        cy = cmd === 'v' ? cy + ny : ny;
        current.push(pt(cx, cy));
        break;
      }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        const x1 = (rel ? cx : 0) + num(), y1 = (rel ? cy : 0) + num();
        const x2 = (rel ? cx : 0) + num(), y2 = (rel ? cy : 0) + num();
        const x3 = (rel ? cx : 0) + num(), y3 = (rel ? cy : 0) + num();
        for (let s = 1; s <= 10; s++) {
          const t = s / 10, mt = 1 - t;
          const bx = mt ** 3 * cx + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3;
          const by = mt ** 3 * cy + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3;
          current.push(pt(bx, by));
        }
        cx = x3; cy = y3;
        break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        const x1 = (rel ? cx : 0) + num(), y1 = (rel ? cy : 0) + num();
        const x2 = (rel ? cx : 0) + num(), y2 = (rel ? cy : 0) + num();
        for (let s = 1; s <= 8; s++) {
          const t = s / 8, mt = 1 - t;
          const bx = mt * mt * cx + 2 * mt * t * x1 + t * t * x2;
          const by = mt * mt * cy + 2 * mt * t * y1 + t * t * y2;
          current.push(pt(bx, by));
        }
        cx = x2; cy = y2;
        break;
      }
      case 'A':
      case 'a': {
        // Skip rx, ry, rot, large, sweep and connect endpoint
        num(); num(); num(); num(); num();
        const nx = num(), ny = num();
        cx = cmd === 'a' ? cx + nx : nx;
        cy = cmd === 'a' ? cy + ny : ny;
        current.push(pt(cx, cy));
        break;
      }
      default:
        i++;
        break;
    }
  }
  if (current.length >= 2) chains.push({ points: current, closed: false });
  return chains;
}

export function parseSvg(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const text = decodeSmartText(bytes);
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  const doc = createDocument('SVG', fileName, bytes.length);
  doc.metadata.version = 'W3C SVG Vector';

  const getLayer = (el) => {
    const g = el.closest('g[id], g[inkscape\\:label]');
    return g?.getAttribute('inkscape:label') || g?.getAttribute('id') || 'SVG';
  };
  const getColor = (el) => {
    const s = el.getAttribute('stroke');
    if (s && s !== 'none') return s;
    const f = el.getAttribute('fill');
    if (f && f !== 'none') return f;
    return null;
  };

  for (const el of xml.querySelectorAll('line')) {
    const x1 = parseFloat(el.getAttribute('x1')) || 0;
    const y1 = -(parseFloat(el.getAttribute('y1')) || 0);
    const x2 = parseFloat(el.getAttribute('x2')) || 0;
    const y2 = -(parseFloat(el.getAttribute('y2')) || 0);
    addEntity(doc, { type: EntityType.LINE, layer: getLayer(el), color: getColor(el), x1, y1, z1: 0, x2, y2, z2: 0 });
  }

  for (const el of xml.querySelectorAll('rect')) {
    const x = parseFloat(el.getAttribute('x')) || 0;
    const y = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width')) || 0;
    const h = parseFloat(el.getAttribute('height')) || 0;
    addEntity(doc, {
      type: EntityType.POLYGON,
      layer: getLayer(el),
      color: getColor(el),
      points: [
        { x, y: -y, z: 0 },
        { x: x + w, y: -y, z: 0 },
        { x: x + w, y: -(y + h), z: 0 },
        { x, y: -(y + h), z: 0 }
      ],
      closed: true
    });
  }

  for (const el of xml.querySelectorAll('circle')) {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = -(parseFloat(el.getAttribute('cy')) || 0);
    const r = parseFloat(el.getAttribute('r')) || 0;
    if (r > 0) addEntity(doc, { type: EntityType.CIRCLE, layer: getLayer(el), color: getColor(el), cx, cy, z: 0, r });
  }

  for (const el of xml.querySelectorAll('ellipse')) {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = -(parseFloat(el.getAttribute('cy')) || 0);
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    const ry = parseFloat(el.getAttribute('ry')) || 0;
    if (rx > 0 && ry > 0) {
      addEntity(doc, {
        type: EntityType.ELLIPSE,
        layer: getLayer(el),
        color: getColor(el),
        cx, cy, z: 0,
        mx: rx, my: 0,
        ratio: ry / rx,
        startParam: 0,
        endParam: Math.PI * 2
      });
    }
  }

  for (const el of xml.querySelectorAll('polyline, polygon')) {
    const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const pts = [];
    for (let i = 0; i + 1 < raw.length; i += 2) pts.push({ x: raw[i], y: -raw[i + 1], z: 0 });
    const closed = el.tagName.toLowerCase() === 'polygon';
    if (pts.length >= 2) {
      addEntity(doc, { type: closed ? EntityType.POLYGON : EntityType.POLYLINE, layer: getLayer(el), color: getColor(el), points: pts, closed });
    }
  }

  for (const el of xml.querySelectorAll('path')) {
    const d = el.getAttribute('d') || '';
    const layer = getLayer(el);
    const color = getColor(el);
    for (const ch of parseSvgPath(d, true)) {
      addEntity(doc, {
        type: ch.closed ? EntityType.POLYGON : EntityType.POLYLINE,
        layer,
        color,
        points: ch.points,
        closed: ch.closed
      });
    }
  }

  for (const el of xml.querySelectorAll('text')) {
    const x = parseFloat(el.getAttribute('x')) || 0;
    const y = -(parseFloat(el.getAttribute('y')) || 0);
    const content = el.textContent.trim();
    const fs = parseFloat(el.getAttribute('font-size')) || 12;
    if (content) {
      ensureLayer(doc, getLayer(el));
      addEntity(doc, { type: EntityType.TEXT, layer: getLayer(el), color: getColor(el), x, y, z: 0, text: content, height: fs, angle: 0 });
    }
  }

  return finalizeDocument(doc);
}
