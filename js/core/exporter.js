/**
 * Client-Side CAD & Vector Exporter: GeoJSON, AutoCAD ASCII DXF, SVG, and PNG.
 */

import { EntityType, sampleArcPoints, sampleEllipsePoints } from './model.js';
import { displayXY } from './spatial.js';

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(fileName) {
  return (fileName || 'cizim').replace(/\.[^.]+$/, '');
}

export function buildGeoJson(doc, swapAxes = false) {
  const features = [];
  for (const e of doc.entities) {
    const layer = doc.layers.get(e.layer);
    if (layer && !layer.visible) continue;

    const props = {
      layer: e.layer,
      type: e.type
    };
    if (e.label) props.label = e.label;
    if (e.text) props.text = e.text;
    if (e.dbTable) props.dbTable = e.dbTable;
    if (e.dbKey) props.dbKey = e.dbKey;

    const ptArr = (x, y, z = 0) => {
      const p = displayXY(x, y, swapAxes);
      return [p.x, p.y, z || 0];
    };

    let geometry = null;
    switch (e.type) {
      case EntityType.POINT:
      case EntityType.SYMBOL:
      case EntityType.TEXT:
        geometry = { type: 'Point', coordinates: ptArr(e.x, e.y, e.z) };
        break;
      case EntityType.LINE:
        geometry = { type: 'LineString', coordinates: [ptArr(e.x1, e.y1, e.z1), ptArr(e.x2, e.y2, e.z2)] };
        break;
      case EntityType.CIRCLE: {
        const ring = sampleEllipsePoints(e.cx, e.cy, e.r, 0, 1, 0, Math.PI * 2, 36)
          .map((p) => ptArr(p.x, p.y, e.z));
        ring.push(ring[0]);
        geometry = { type: 'Polygon', coordinates: [ring] };
        break;
      }
      case EntityType.ARC: {
        const pts = sampleArcPoints(e.cx, e.cy, e.r, e.startAngle, e.endAngle, 32)
          .map((p) => ptArr(p.x, p.y, e.z));
        geometry = { type: 'LineString', coordinates: pts };
        break;
      }
      case EntityType.ELLIPSE: {
        const pts = sampleEllipsePoints(e.cx, e.cy, e.mx, e.my, e.ratio, e.startParam, e.endParam, 40)
          .map((p) => ptArr(p.x, p.y, e.z));
        geometry = { type: 'LineString', coordinates: pts };
        break;
      }
      case EntityType.POLYLINE:
        geometry = { type: 'LineString', coordinates: e.points.map((p) => ptArr(p.x, p.y, p.z)) };
        break;
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const ring = e.points.map((p) => ptArr(p.x, p.y, p.z));
        if (ring.length >= 3) {
          ring.push(ring[0]);
          geometry = { type: 'Polygon', coordinates: [ring] };
        }
        break;
      }
      default:
        break;
    }

    if (geometry) {
      features.push({ type: 'Feature', properties: props, geometry });
    }
  }
  return JSON.stringify({ type: 'FeatureCollection', name: baseName(doc.fileName), features }, null, 2);
}

export function buildDxf(doc, swapAxes = false) {
  const out = [];
  const push = (c, v) => { out.push(String(c), String(v)); };

  push(0, 'SECTION');
  push(2, 'HEADER');
  push(9, '$ACADVER');
  push(1, 'AC1015');
  push(0, 'ENDSEC');

  push(0, 'SECTION');
  push(2, 'TABLES');
  push(0, 'TABLE');
  push(2, 'LAYER');
  push(70, doc.layers.size);
  for (const layer of doc.layers.values()) {
    push(0, 'LAYER');
    push(2, layer.name);
    push(70, 0);
    push(62, layer.visible ? (layer.aciColor || 7) : -(layer.aciColor || 7));
    push(6, 'CONTINUOUS');
  }
  push(0, 'ENDTAB');
  push(0, 'ENDSEC');

  push(0, 'SECTION');
  push(2, 'ENTITIES');
  for (const e of doc.entities) {
    const layer = doc.layers.get(e.layer);
    if (layer && !layer.visible) continue;
    const p = (x, y) => displayXY(x, y, swapAxes);

    switch (e.type) {
      case EntityType.POINT:
      case EntityType.SYMBOL: {
        const pt = p(e.x, e.y);
        push(0, 'POINT');
        push(8, e.layer);
        push(10, pt.x.toFixed(6));
        push(20, pt.y.toFixed(6));
        push(30, (e.z || 0).toFixed(4));
        break;
      }
      case EntityType.LINE: {
        const p1 = p(e.x1, e.y1);
        const p2 = p(e.x2, e.y2);
        push(0, 'LINE');
        push(8, e.layer);
        push(10, p1.x.toFixed(6));
        push(20, p1.y.toFixed(6));
        push(30, (e.z1 || 0).toFixed(4));
        push(11, p2.x.toFixed(6));
        push(21, p2.y.toFixed(6));
        push(31, (e.z2 || 0).toFixed(4));
        break;
      }
      case EntityType.CIRCLE: {
        const c = p(e.cx, e.cy);
        push(0, 'CIRCLE');
        push(8, e.layer);
        push(10, c.x.toFixed(6));
        push(20, c.y.toFixed(6));
        push(30, (e.z || 0).toFixed(4));
        push(40, e.r.toFixed(6));
        break;
      }
      case EntityType.ARC: {
        const c = p(e.cx, e.cy);
        push(0, 'ARC');
        push(8, e.layer);
        push(10, c.x.toFixed(6));
        push(20, c.y.toFixed(6));
        push(30, (e.z || 0).toFixed(4));
        push(40, e.r.toFixed(6));
        push(50, ((e.startAngle * 180) / Math.PI).toFixed(4));
        push(51, ((e.endAngle * 180) / Math.PI).toFixed(4));
        break;
      }
      case EntityType.TEXT: {
        const pt = p(e.x, e.y);
        push(0, 'TEXT');
        push(8, e.layer);
        push(10, pt.x.toFixed(6));
        push(20, pt.y.toFixed(6));
        push(30, (e.z || 0).toFixed(4));
        push(40, (e.height || 2).toFixed(4));
        push(50, (((e.angle || 0) * 180) / Math.PI).toFixed(4));
        push(1, e.text);
        break;
      }
      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        if (!e.points?.length) break;
        const closed = e.closed || e.type === EntityType.POLYGON || e.type === EntityType.FACE3D;
        push(0, 'LWPOLYLINE');
        push(8, e.layer);
        push(90, e.points.length);
        push(70, closed ? 1 : 0);
        for (const v of e.points) {
          const pt = p(v.x, v.y);
          push(10, pt.x.toFixed(6));
          push(20, pt.y.toFixed(6));
        }
        break;
      }
      default:
        break;
    }
  }
  push(0, 'ENDSEC');
  push(0, 'EOF');
  return out.join('\n');
}

export function buildSvg(doc, swapAxes = false) {
  const b = doc.bounds;
  if (!b?.valid) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const p0 = displayXY(b.minX, b.minY, swapAxes);
  const p1 = displayXY(b.maxX, b.maxY, swapAxes);
  const minX = Math.min(p0.x, p1.x), maxX = Math.max(p0.x, p1.x);
  const minY = Math.min(p0.y, p1.y), maxY = Math.max(p0.y, p1.y);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const sw = Math.max(w, h) * 0.0015;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">`,
    `<rect width="100%" height="100%" fill="#0c1118"/>`
  ];
  const tx = (x) => (x - minX).toFixed(3);
  const ty = (y) => (maxY - y).toFixed(3);

  for (const e of doc.entities) {
    const layer = doc.layers.get(e.layer);
    if (layer && !layer.visible) continue;
    const col = e.color || layer?.color || '#38bdf8';

    switch (e.type) {
      case EntityType.LINE: {
        const a = displayXY(e.x1, e.y1, swapAxes);
        const c = displayXY(e.x2, e.y2, swapAxes);
        lines.push(`<line x1="${tx(a.x)}" y1="${ty(a.y)}" x2="${tx(c.x)}" y2="${ty(c.y)}" stroke="${col}" stroke-width="${sw}"/>`);
        break;
      }
      case EntityType.CIRCLE: {
        const c = displayXY(e.cx, e.cy, swapAxes);
        lines.push(`<circle cx="${tx(c.x)}" cy="${ty(c.y)}" r="${e.r.toFixed(3)}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
        break;
      }
      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const pts = e.points.map((pt) => {
          const d = displayXY(pt.x, pt.y, swapAxes);
          return `${tx(d.x)},${ty(d.y)}`;
        }).join(' ');
        const tag = (e.closed || e.type === EntityType.POLYGON) ? 'polygon' : 'polyline';
        lines.push(`<${tag} points="${pts}" fill="${tag === 'polygon' ? col : 'none'}" fill-opacity="${tag === 'polygon' ? '0.12' : '0'}" stroke="${col}" stroke-width="${sw}"/>`);
        break;
      }
      case EntityType.TEXT: {
        const d = displayXY(e.x, e.y, swapAxes);
        const deg = -((e.angle || 0) * 180) / Math.PI;
        const x = tx(d.x), y = ty(d.y);
        lines.push(`<text x="${x}" y="${y}" fill="${col}" font-size="${(e.height || 2).toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${x} ${y})">${esc(e.text)}</text>`);
        break;
      }
      default:
        break;
    }
  }
  lines.push('</svg>');
  return lines.join('\n');
}

export function exportDocument(doc, format, swapAxes, canvas) {
  const base = baseName(doc.fileName);
  if (format === 'geojson') {
    const str = buildGeoJson(doc, swapAxes);
    triggerDownload(new Blob([str], { type: 'application/geo+json' }), `${base}.geojson`);
  } else if (format === 'dxf') {
    const str = buildDxf(doc, swapAxes);
    triggerDownload(new Blob([str], { type: 'application/dxf' }), `${base}.dxf`);
  } else if (format === 'svg') {
    const str = buildSvg(doc, swapAxes);
    triggerDownload(new Blob([str], { type: 'image/svg+xml' }), `${base}.svg`);
  } else if (format === 'png' && canvas) {
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `${base}.png`);
    }, 'image/png');
  }
}
