/**
 * Automated Unit & Integration Test Suite for cad-ncz-viewer (MIT Licensed).
 * Covers: Binary NCZ TLV, ZIP-packaged NCZ (.nca & GML), DXF (BLOCKS/INSERT, bulges,
 * ELLIPSE, SPLINE, MTEXT), NCN, GeoJSON, KML, SVG, OBJ, ASCII & Binary STL,
 * Float64 shoelace geometry math, grid spatial index/hitTest/OSNAP, and exporters.
 */

import {
  EntityType,
  bulgeToArcPoints,
  computeEntityArea,
  computeEntityLength,
  computePolygonArea
} from '../js/core/model.js';
import { buildSpatialIndex, findSnapPoint, hitTest } from '../js/core/spatial.js';
import { buildDxf, buildGeoJson, buildSvg } from '../js/core/exporter.js';
import { parseCadFile } from '../js/parsers/index.js';
import { parseNcz } from '../js/parsers/ncz-parser.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertClose(actual, expected, eps = 1e-4, label = 'value') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected} (±${eps}), got ${actual}`);
  }
}

/**
 * Create a valid minimal uncompressed (Stored method=0) ZIP ArrayBuffer in pure JS.
 */
function buildStoredZip(files) {
  const enc = new TextEncoder();
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const payload = data instanceof Uint8Array ? data : enc.encode(String(data));
    const size = payload.length;

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    const cdf = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdf.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cdf.set(nameBytes, 46);

    localParts.push(lfh, payload);
    cdParts.push(cdf);
    offset += lfh.length + size;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let ptr = 0;
  for (const p of localParts) { out.set(p, ptr); ptr += p.length; }
  for (const p of cdParts) { out.set(p, ptr); ptr += p.length; }
  out.set(eocd, ptr);
  return out.buffer;
}

const encUtf8 = (s) => new TextEncoder().encode(s).buffer;

export async function runAllTests() {
  const results = [];
  let cachedNczBuf = null;

  async function test(name, fn) {
    const t0 = performance.now();
    try {
      await fn();
      results.push({ name, passed: true, ms: +(performance.now() - t0).toFixed(2) });
    } catch (err) {
      results.push({ name, passed: false, ms: +(performance.now() - t0).toFixed(2), error: err.message });
    }
  }

  await test('1. Classic Binary NCZ (ornek_imar_projesi.ncz)', async () => {
    const resp = await fetch('../samples/ornek_imar_projesi.ncz');
    assert(resp.ok, `HTTP ${resp.status} fetching NCZ sample`);
    cachedNczBuf = await resp.arrayBuffer();
    const doc = await parseCadFile(cachedNczBuf, 'ornek_imar_projesi.ncz');

    assert(doc.format === 'NCZ', `format=${doc.format}`);
    assert(doc.layers.size === 10, `expected 10 layers, got ${doc.layers.size}`);
    assert(doc.entities.length >= 60, `expected >=60 entities, got ${doc.entities.length}`);
    assert(doc.metadata.version.includes('5.2.0.1000'), `version=${doc.metadata.version}`);
    assert(doc.metadata.author.includes('Görüntüleyici'), `author CP1254 mismatch: ${doc.metadata.author}`);
    assert(doc.metadata.crs.includes('ITRF96') && doc.metadata.crs.includes('5254'), `crs=${doc.metadata.crs}`);
    assert(Boolean(doc.metadata.thumbnailDataUrl), 'missing Tag 14 BMP thumbnail');

    const p101_1 = doc.entities.find((e) => e.dbTable === 'VT_PARSEL' && e.dbKey === '101/1');
    assert(Boolean(p101_1), 'missing Tag 22 VT_PARSEL 101/1');
    assertClose(computeEntityArea(p101_1), 33 * 61, 1e-3, 'Parcel 101/1 area');
    assertClose(computeEntityLength(p101_1), 2 * (33 + 61), 1e-3, 'Parcel 101/1 perimeter');

    const roadTxt = doc.entities.find((e) => e.type === EntityType.TEXT && e.text.includes('CUMHURİYET CADDESİ'));
    assert(Boolean(roadTxt), 'missing Turkish CP1254 road text entity');
  });

  await test('2. Modern ZIP-packaged NCZ container (.nca inside ZIP)', async () => {
    assert(cachedNczBuf !== null, 'NCZ buffer not cached');
    const zipBuf = buildStoredZip([{ name: 'proje.nca', data: new Uint8Array(cachedNczBuf) }]);
    const doc = await parseNcz(zipBuf, 'paket.ncz');

    assert(doc.metadata.version.includes('ZIP Konteyner'), `version=${doc.metadata.version}`);
    assert(doc.layers.size === 10, `layers=${doc.layers.size}`);
    assert(doc.entities.length >= 60, `entities=${doc.entities.length}`);
  });

  await test('3. Modern ZIP-packaged NCZ container (GML fallback)', async () => {
    const gml = `<?xml version="1.0" encoding="utf-8"?>
      <FeatureCollection xmlns:gml="http://www.opengis.net/gml">
        <gml:Polygon><gml:outerBoundaryIs><gml:LinearRing>
          <gml:posList>4400000 500000 4400000 500040 4400025 500040 4400025 500000 4400000 500000</gml:posList>
        </gml:LinearRing></gml:outerBoundaryIs></gml:Polygon>
      </FeatureCollection>`;
    const zipBuf = buildStoredZip([{ name: 'katman/parsel.gml', data: gml }]);
    const doc = await parseNcz(zipBuf, 'gml_paket.ncz');

    assert(doc.entities.length === 1, `expected 1 GML polygon, got ${doc.entities.length}`);
    assertClose(computeEntityArea(doc.entities[0]), 40 * 25, 1e-3, 'GML polygon area');
  });

  await test('4. AutoCAD ASCII DXF (BLOCKS/INSERT, bulges, ELLIPSE, SPLINE, MTEXT)', async () => {
    const resp = await fetch('../samples/ornek_mimari_plan.dxf');
    assert(resp.ok, `HTTP ${resp.status} fetching DXF sample`);
    const buf = await resp.arrayBuffer();
    const doc = await parseCadFile(buf, 'ornek_mimari_plan.dxf');

    assert(doc.format === 'DXF', `format=${doc.format}`);
    assert(doc.layers.has('DUVARLAR') && doc.layers.has('DOGRAMA_KAPI'), 'missing expected DXF layers');
    assert(doc.entities.length >= 30, `expected >=30 expanded DXF entities, got ${doc.entities.length}`);

    const doorUniformArcs = doc.entities.filter((e) => e.layer === 'DOGRAMA_KAPI' && e.type === EntityType.ARC);
    const doorScaledPolys = doc.entities.filter((e) => e.layer === 'DOGRAMA_KAPI' && e.type === EntityType.POLYLINE);
    assert(doorUniformArcs.length === 3 && doorScaledPolys.length === 2,
      `expected 3 uniform ARC + 2 non-uniformly scaled POLYLINE door swings, got ${doorUniformArcs.length}+${doorScaledPolys.length}`);

    const balcony = doc.entities.find((e) => e.layer === 'KAPLAMA_BALKON');
    assert(balcony && balcony.points.length > 6, 'expected LWPOLYLINE bulge to tessellate into >6 points');

    const ellipse = doc.entities.find((e) => e.type === EntityType.ELLIPSE);
    assert(Boolean(ellipse), 'missing ELLIPSE entity');

    const salonTxt = doc.entities.find((e) => e.type === EntityType.TEXT && e.text.includes('SALON'));
    assert(Boolean(salonTxt), 'missing SALON MTEXT');
  });

  await test('5. Netcad ASCII Points (.ncn)', async () => {
    const resp = await fetch('../samples/ornek_arazi_noktalari.ncn');
    assert(resp.ok, `HTTP ${resp.status} fetching NCN sample`);
    const buf = await resp.arrayBuffer();
    const doc = await parseCadFile(buf, 'ornek_arazi_noktalari.ncn');

    assert(doc.format === 'NCN', `format=${doc.format}`);
    assert(doc.entities.length === 62, `expected 62 NCN points, got ${doc.entities.length}`);
    assert(doc.hasZ === true, 'NCN should set hasZ=true');
    const pl100 = doc.entities.find((e) => e.label === 'PL100');
    assert(pl100 && Math.abs(pl100.z - 941.45) < 1e-3, 'PL100 Z elevation mismatch');
  });

  await test('6. GeoJSON FeatureCollection parser', async () => {
    const geo = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { layer: 'YOL', name: 'A1' }, geometry: { type: 'Point', coordinates: [10, 20, 5] } },
        { type: 'Feature', properties: { layer: 'SINIR' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [50, 0], [50, 30], [0, 30], [0, 0]]] } }
      ]
    });
    const doc = await parseCadFile(encUtf8(geo), 'test.geojson');
    assert(doc.entities.length === 2, `expected 2 GeoJSON entities, got ${doc.entities.length}`);
    const poly = doc.entities.find((e) => e.type === EntityType.POLYGON);
    assertClose(computeEntityArea(poly), 1500, 1e-3, 'GeoJSON Polygon area');
  });

  await test('7. KML Placemark parser', async () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Kadastro</name>
        <Placemark><name>Nokta1</name><Point><coordinates>32.85,39.92,950</coordinates></Point></Placemark>
        <Placemark><name>Ada</name><Polygon><outerBoundaryIs><LinearRing>
          <coordinates>0,0,0 10,0,0 10,20,0 0,20,0 0,0,0</coordinates>
        </LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Folder></Document></kml>`;
    const doc = await parseCadFile(encUtf8(kml), 'test.kml');
    assert(doc.entities.length === 2, `expected 2 KML entities, got ${doc.entities.length}`);
    assert(doc.entities.some((e) => e.type === EntityType.POINT), 'missing KML Point');
    assert(doc.entities.some((e) => e.type === EntityType.POLYGON), 'missing KML Polygon');
  });

  await test('8. SVG path & primitives parser', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="0" y="0" width="20" height="10" stroke="#ff0000"/>
      <circle cx="50" cy="50" r="15"/>
      <line x1="0" y1="0" x2="30" y2="40"/>
      <path d="M 10 10 L 30 10 L 30 20 Z"/>
      <text x="5" y="15">Plan</text>
    </svg>`;
    const doc = await parseCadFile(encUtf8(svg), 'test.svg');
    assert(doc.entities.length === 5, `expected 5 SVG entities, got ${doc.entities.length}`);
    assertClose(computeEntityLength(doc.entities.find((e) => e.type === EntityType.LINE)), 50, 1e-3, 'SVG 3-4-5 triangle line length');
  });

  await test('9. Wavefront OBJ & ASCII/Binary STL 3D mesh parsers', async () => {
    const obj = [
      'g Prizma',
      'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'v 5 5 8',
      'f 1 2 3 4',
      'f 1 2 5'
    ].join('\n');
    const objDoc = await parseCadFile(encUtf8(obj), 'prizma.obj');
    assert(objDoc.defaultView3D === true, 'OBJ should enable defaultView3D');
    assert(objDoc.entities.length === 2, `expected 2 OBJ faces, got ${objDoc.entities.length}`);

    const asciiStl = `solid kule
      facet normal 0 0 1
        outer loop
          vertex 0 0 0
          vertex 4 0 0
          vertex 0 3 0
        endloop
      endfacet
    endsolid kule`;
    const stlADoc = await parseCadFile(encUtf8(asciiStl), 'ascii.stl');
    assert(stlADoc.entities.length === 1 && stlADoc.entities[0].type === EntityType.FACE3D, 'ASCII STL triangle');

    // Binary STL: 80-byte header + 4-byte count (2) + 2 * 50 bytes = 184 bytes
    const bin = new ArrayBuffer(84 + 2 * 50);
    const dv = new DataView(bin);
    new Uint8Array(bin).set(new TextEncoder().encode('BIN_STL_MIT_TEST'), 0);
    dv.setUint32(80, 2, true);
    // Triangle 1 at offset 84
    const writeTri = (off, v1, v2, v3) => {
      const vals = [0, 0, 1, ...v1, ...v2, ...v3];
      vals.forEach((f, idx) => dv.setFloat32(off + idx * 4, f, true));
    };
    writeTri(84, [0, 0, 0], [2, 0, 0], [0, 2, 0]);
    writeTri(134, [2, 0, 0], [2, 2, 0], [0, 2, 0]);
    const stlBDoc = await parseCadFile(bin, 'binary.stl');
    assert(stlBDoc.entities.length === 2, `expected 2 Binary STL faces, got ${stlBDoc.entities.length}`);
  });

  await test('10. Float64 Origin-Shifted UTM Area & Bulge Arc Math', () => {
    const utmRect = [
      { x: 485210.0, y: 4418523.0, z: 0 },
      { x: 485310.0, y: 4418523.0, z: 0 },
      { x: 485310.0, y: 4418573.0, z: 0 },
      { x: 485210.0, y: 4418573.0, z: 0 }
    ];
    assertClose(computePolygonArea(utmRect), 5000.0, 1e-6, 'UTM shifted rectangle area');

    const semi = bulgeToArcPoints({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 1.0, 16);
    assert(semi.length >= 4, 'bulgeToArcPoints returned interpolated curve points');
    const mid = semi[Math.floor(semi.length / 2)];
    const distFromCenter = Math.hypot(mid.x - 5, mid.y - 0);
    assertClose(distFromCenter, 5.0, 0.25, 'semicircle midpoint radius');
  });

  await test('11. Spatial Grid Index, hitTest & CAD OSNAP', async () => {
    const doc = await parseCadFile(cachedNczBuf, 'ornek_imar_projesi.ncz');
    const index = buildSpatialIndex(doc);
    // Parcel 101/1 spans E: [485210..485243], N: [4418523..4418584]
    const hitEdge = hitTest(doc, index, 485210.2, 4418550.0, 1.5, false);
    assert(hitEdge !== null, 'hitTest should select edge entity near parcel boundary');

    const snapCorner = findSnapPoint(doc, index, 485210.1, 4418523.1, 2.0, false);
    assert(snapCorner && snapCorner.kind === 'endpoint', `expected endpoint snap, got ${snapCorner?.kind}`);
    assertClose(snapCorner.x, 485210.0, 1e-4, 'snap corner X');
    assertClose(snapCorner.y, 4418523.0, 1e-4, 'snap corner Y');
  });

  await test('12. Exporters Round-Trip (GeoJSON, DXF, SVG)', async () => {
    const doc = await parseCadFile(cachedNczBuf, 'ornek_imar_projesi.ncz');

    const geoStr = buildGeoJson(doc, false);
    const geoObj = JSON.parse(geoStr);
    assert(geoObj.type === 'FeatureCollection' && geoObj.features.length >= 50, 'GeoJSON export count');
    const reGeo = await parseCadFile(encUtf8(geoStr), 'reexport.geojson');
    assert(reGeo.entities.length >= 50, 'GeoJSON round-trip parse');

    const dxfStr = buildDxf(doc, false);
    assert(dxfStr.includes('SECTION') && dxfStr.includes('EOF'), 'DXF structure');
    const reDxf = await parseCadFile(encUtf8(dxfStr), 'reexport.dxf');
    assert(reDxf.entities.length >= 40, `DXF round-trip entities=${reDxf.entities.length}`);

    const svgStr = buildSvg(doc, false);
    assert(svgStr.startsWith('<svg') && svgStr.includes('</svg>'), 'SVG output header');
    const reSvg = await parseCadFile(encUtf8(svgStr), 'reexport.svg');
    assert(reSvg.entities.length >= 30, `SVG round-trip entities=${reSvg.entities.length}`);
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed, results };
}
