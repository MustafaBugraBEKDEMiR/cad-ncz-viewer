/**
 * High-Precision Float64 Canvas 2D & 3D Orbit CAD Rendering Engine.
 */

import { EntityType, adaptColorForTheme, computePolygonArea, sampleEllipsePoints } from './model.js';
import { displayXY, querySpatialBox } from './spatial.js';

export const THEMES = {
  dark: {
    bg: '#0c1118',
    gridMinor: 'rgba(148, 163, 184, 0.06)',
    gridMajor: 'rgba(148, 163, 184, 0.14)',
    gridAxis: 'rgba(56, 189, 248, 0.25)',
    gridText: 'rgba(148, 163, 184, 0.65)',
    halo: 'rgba(12, 17, 24, 0.82)',
    selection: '#38bdf8',
    measure: '#f59e0b',
    snapEndpoint: '#22c55e',
    snapMidpoint: '#f59e0b',
    snapCenter: '#38bdf8',
    isLight: false
  },
  charcoal: {
    bg: '#1c2128',
    gridMinor: 'rgba(255, 255, 255, 0.04)',
    gridMajor: 'rgba(255, 255, 255, 0.11)',
    gridAxis: 'rgba(56, 189, 248, 0.28)',
    gridText: 'rgba(173, 186, 199, 0.65)',
    halo: 'rgba(28, 33, 40, 0.85)',
    selection: '#22d3ee',
    measure: '#fbbf24',
    snapEndpoint: '#4ade80',
    snapMidpoint: '#fbbf24',
    snapCenter: '#22d3ee',
    isLight: false
  },
  light: {
    bg: '#f8fafc',
    gridMinor: 'rgba(15, 23, 42, 0.05)',
    gridMajor: 'rgba(15, 23, 42, 0.12)',
    gridAxis: 'rgba(2, 132, 199, 0.28)',
    gridText: 'rgba(71, 85, 105, 0.78)',
    halo: 'rgba(248, 250, 252, 0.88)',
    selection: '#0284c7',
    measure: '#d97706',
    snapEndpoint: '#16a34a',
    snapMidpoint: '#d97706',
    snapCenter: '#0284c7',
    isLight: true
  }
};

export class CadRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 800;
    this.height = 600;
    this.dpr = 1;
    this.themeName = 'dark';
    this.camera = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      scale: 1,
      view3D: false,
      yaw: -0.65,
      pitch: 0.75
    };
    this.swapAxes = false;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(100, Math.floor(rect.width));
    this.height = Math.max(100, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  setTheme(name) {
    if (THEMES[name]) this.themeName = name;
  }

  fitBounds(bounds, padRatio = 0.08) {
    if (!bounds || !bounds.valid) return;
    const pMin = displayXY(bounds.minX, bounds.minY, this.swapAxes);
    const pMax = displayXY(bounds.maxX, bounds.maxY, this.swapAxes);
    const minX = Math.min(pMin.x, pMax.x);
    const maxX = Math.max(pMin.x, pMax.x);
    const minY = Math.min(pMin.y, pMax.y);
    const maxY = Math.max(pMin.y, pMax.y);

    const spanX = Math.max(1e-3, maxX - minX);
    const spanY = Math.max(1e-3, maxY - minY);
    const availW = this.width * (1 - padRatio * 2);
    const availH = this.height * (1 - padRatio * 2);

    this.camera.centerX = (minX + maxX) * 0.5;
    this.camera.centerY = (minY + maxY) * 0.5;
    this.camera.centerZ = ((bounds.minZ || 0) + (bounds.maxZ || 0)) * 0.5;
    this.camera.scale = Math.min(availW / spanX, availH / spanY);
    if (!Number.isFinite(this.camera.scale) || this.camera.scale <= 0) {
      this.camera.scale = 1;
    }
  }

  worldToScreen(wx, wy, wz = 0) {
    const c = this.camera;
    const dx = wx - c.centerX;
    const dy = wy - c.centerY;
    if (!c.view3D) {
      return {
        x: this.width * 0.5 + dx * c.scale,
        y: this.height * 0.5 - dy * c.scale
      };
    }
    const dz = (wz || 0) - c.centerZ;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const rx = dx * cy - dy * sy;
    const ry = dx * sy + dy * cy;
    const py = ry * cp - dz * sp;
    return {
      x: this.width * 0.5 + rx * c.scale,
      y: this.height * 0.5 - py * c.scale
    };
  }

  screenToWorld(sx, sy) {
    const c = this.camera;
    const dx = (sx - this.width * 0.5) / c.scale;
    const dy = (this.height * 0.5 - sy) / c.scale;
    if (!c.view3D) {
      return { x: c.centerX + dx, y: c.centerY + dy };
    }
    // Approximate inverse on Z=centerZ plane for 3D cursor readout
    const cp = Math.max(0.15, Math.cos(c.pitch));
    const ry = dy / cp;
    const cy = Math.cos(c.yaw), syYaw = Math.sin(c.yaw);
    return {
      x: c.centerX + (dx * cy + ry * syYaw),
      y: c.centerY + (-dx * syYaw + ry * cy)
    };
  }

  getVisibleWorldBounds() {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.width, this.height);
    return {
      minX: Math.min(tl.x, br.x),
      maxX: Math.max(tl.x, br.x),
      minY: Math.min(tl.y, br.y),
      maxY: Math.max(tl.y, br.y)
    };
  }

  render(doc, spatialIndex, state) {
    const ctx = this.ctx;
    const theme = THEMES[this.themeName] || THEMES.dark;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);

    if (state.showGrid !== false && !this.camera.view3D) {
      this.drawGrid(ctx, theme);
    } else if (this.camera.view3D) {
      this.draw3DAxes(ctx, theme, doc);
    }

    if (doc && doc.entities.length > 0) {
      let visibleEntities;
      if (this.camera.view3D || !spatialIndex) {
        visibleEntities = doc.entities;
      } else {
        const vb = this.getVisibleWorldBounds();
        const padX = (vb.maxX - vb.minX) * 0.05;
        const padY = (vb.maxY - vb.minY) * 0.05;
        visibleEntities = querySpatialBox(
          doc,
          spatialIndex,
          vb.minX - padX,
          vb.minY - padY,
          vb.maxX + padX,
          vb.maxY + padY,
          this.swapAxes
        );
      }

      // Draw fills / polygons first, then lines/arcs, then points/symbols/texts
      const texts = [];
      const points = [];

      for (const e of visibleEntities) {
        const layer = doc.layers.get(e.layer);
        if (layer && !layer.visible) continue;

        if (e.type === EntityType.TEXT) {
          texts.push(e);
          continue;
        }
        if (e.type === EntityType.POINT || e.type === EntityType.SYMBOL) {
          points.push(e);
          continue;
        }

        const baseColor = e.color || layer?.color || '#38bdf8';
        const color = adaptColorForTheme(baseColor, theme.isLight);
        const isSelected = state.selectedId === e.id;
        this.drawEntity(ctx, e, color, isSelected, theme);
      }

      for (const e of points) {
        const layer = doc.layers.get(e.layer);
        const baseColor = e.color || layer?.color || '#38bdf8';
        const color = adaptColorForTheme(baseColor, theme.isLight);
        this.drawEntity(ctx, e, color, state.selectedId === e.id, theme);
      }

      for (const e of texts) {
        const layer = doc.layers.get(e.layer);
        const baseColor = e.color || layer?.color || '#e2e8f0';
        const color = adaptColorForTheme(baseColor, theme.isLight);
        this.drawEntity(ctx, e, color, state.selectedId === e.id, theme);
      }

      if (state.hoveredEntity && state.hoveredEntity.id !== state.selectedId) {
        const layer = doc.layers.get(state.hoveredEntity.layer);
        if (!layer || layer.visible) {
          this.drawEntity(ctx, state.hoveredEntity, theme.selection, true, theme, 0.55);
        }
      }
    }

    // Draw OSNAP indicator
    if (state.snapPoint && !this.camera.view3D) {
      this.drawSnapMarker(ctx, state.snapPoint, theme);
    }

    // Draw Measure overlay
    if (state.measurePoints && state.measurePoints.length > 0) {
      this.drawMeasureOverlay(ctx, state.measurePoints, state.measureCursor, state.tool, theme);
    }

    ctx.restore();
  }

  drawGrid(ctx, theme) {
    const vb = this.getVisibleWorldBounds();
    const span = Math.max(vb.maxX - vb.minX, vb.maxY - vb.minY);
    if (!Number.isFinite(span) || span <= 0) return;

    const targetCells = 8;
    const rawStep = span / targetCells;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / pow10;
    let step = pow10;
    if (norm > 5) step = 10 * pow10;
    else if (norm > 2) step = 5 * pow10;
    else if (norm > 1) step = 2 * pow10;

    const minorStep = step / 5;
    const showMinor = minorStep * this.camera.scale >= 14;

    if (showMinor) {
      ctx.strokeStyle = theme.gridMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const xStart = Math.floor(vb.minX / minorStep) * minorStep;
      const yStart = Math.floor(vb.minY / minorStep) * minorStep;
      for (let x = xStart; x <= vb.maxX; x += minorStep) {
        const sx = this.worldToScreen(x, vb.minY).x;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.height);
      }
      for (let y = yStart; y <= vb.maxY; y += minorStep) {
        const sy = this.worldToScreen(vb.minX, y).y;
        ctx.moveTo(0, sy);
        ctx.lineTo(this.width, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = theme.gridText;

    const x0 = Math.floor(vb.minX / step) * step;
    const y0 = Math.floor(vb.minY / step) * step;
    const decimals = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;

    ctx.beginPath();
    for (let x = x0; x <= vb.maxX; x += step) {
      const sx = this.worldToScreen(x, vb.minY).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.height);
    }
    for (let y = y0; y <= vb.maxY; y += step) {
      const sy = this.worldToScreen(vb.minX, y).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.width, sy);
    }
    ctx.stroke();

    // Draw coordinate labels along edges
    for (let x = x0; x <= vb.maxX; x += step) {
      const sx = this.worldToScreen(x, vb.minY).x;
      if (sx > 40 && sx < this.width - 40) {
        ctx.fillText(x.toFixed(decimals), sx + 4, 14);
      }
    }
    for (let y = y0; y <= vb.maxY; y += step) {
      const sy = this.worldToScreen(vb.minX, y).y;
      if (sy > 24 && sy < this.height - 30) {
        ctx.fillText(y.toFixed(decimals), 6, sy - 4);
      }
    }

    // Origin cross if (0,0) is visible
    if (vb.minX <= 0 && vb.maxX >= 0 && vb.minY <= 0 && vb.maxY >= 0) {
      const o = this.worldToScreen(0, 0);
      ctx.strokeStyle = theme.gridAxis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.x - 16, o.y);
      ctx.lineTo(o.x + 16, o.y);
      ctx.moveTo(o.x, o.y - 16);
      ctx.lineTo(o.x, o.y + 16);
      ctx.stroke();
    }
  }

  draw3DAxes(ctx, theme, doc) {
    const b = doc?.bounds;
    const cx = b?.valid ? (b.minX + b.maxX) * 0.5 : 0;
    const cy = b?.valid ? (b.minY + b.maxY) * 0.5 : 0;
    const cz = b?.valid ? (b.minZ || 0) : 0;
    const p = displayXY(cx, cy, this.swapAxes);
    const len = b?.valid ? Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.2 : 50;

    const o = this.worldToScreen(p.x, p.y, cz);
    const ax = this.worldToScreen(p.x + len, p.y, cz);
    const ay = this.worldToScreen(p.x, p.y + len, cz);
    const az = this.worldToScreen(p.x, p.y, cz + len);

    const drawAxis = (end, col, lbl) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(lbl, end.x + 4, end.y);
    };
    drawAxis(ax, '#ef4444', 'X');
    drawAxis(ay, '#22c55e', 'Y');
    drawAxis(az, '#38bdf8', 'Z');
  }

  drawEntity(ctx, e, color, isSelected, theme, alphaOverride = 1) {
    ctx.save();
    if (alphaOverride < 1) ctx.globalAlpha = alphaOverride;
    const strokeCol = isSelected ? theme.selection : color;
    ctx.strokeStyle = strokeCol;
    ctx.fillStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.6 : 1.25;

    switch (e.type) {
      case EntityType.POINT: {
        const dp = displayXY(e.x, e.y, this.swapAxes);
        const s = this.worldToScreen(dp.x, dp.y, e.z);
        const r = isSelected ? 4.5 : 2.5;
        ctx.beginPath();
        ctx.moveTo(s.x - r, s.y - r);
        ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x + r, s.y - r);
        ctx.lineTo(s.x - r, s.y + r);
        ctx.stroke();
        if (e.label && this.camera.scale > 0.4) {
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(e.label, s.x + 5, s.y - 4);
        }
        break;
      }

      case EntityType.SYMBOL: {
        const dp = displayXY(e.x, e.y, this.swapAxes);
        const s = this.worldToScreen(dp.x, dp.y, e.z);
        const rPx = Math.max(3, Math.min(12, (e.size || 2) * this.camera.scale * 0.5));
        ctx.beginPath();
        if (e.symbolId === 240 || e.layer.toUpperCase().includes('GRID')) {
          ctx.moveTo(s.x - rPx, s.y);
          ctx.lineTo(s.x + rPx, s.y);
          ctx.moveTo(s.x, s.y - rPx);
          ctx.lineTo(s.x, s.y + rPx);
        } else {
          ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
          ctx.moveTo(s.x - rPx * 0.7, s.y);
          ctx.lineTo(s.x + rPx * 0.7, s.y);
          ctx.moveTo(s.x, s.y - rPx * 0.7);
          ctx.lineTo(s.x, s.y + rPx * 0.7);
        }
        ctx.stroke();
        break;
      }

      case EntityType.LINE: {
        const p1 = displayXY(e.x1, e.y1, this.swapAxes);
        const p2 = displayXY(e.x2, e.y2, this.swapAxes);
        const s1 = this.worldToScreen(p1.x, p1.y, e.z1);
        const s2 = this.worldToScreen(p2.x, p2.y, e.z2);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        break;
      }

      case EntityType.CIRCLE: {
        const c = displayXY(e.cx, e.cy, this.swapAxes);
        if (this.camera.view3D) {
          const pts = sampleEllipsePoints(c.x, c.y, e.r, 0, 1, 0, Math.PI * 2, 36);
          ctx.beginPath();
          pts.forEach((pt, idx) => {
            const sp = this.worldToScreen(pt.x, pt.y, e.z);
            if (idx === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.closePath();
          ctx.stroke();
        } else {
          const sc = this.worldToScreen(c.x, c.y, e.z);
          const sr = e.r * this.camera.scale;
          if (sr > 0.4) {
            ctx.beginPath();
            ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        break;
      }

      case EntityType.ARC: {
        const c = displayXY(e.cx, e.cy, this.swapAxes);
        if (this.camera.view3D) {
          const pts = sampleEllipsePoints(c.x, c.y, e.r, 0, 1, e.startAngle, e.endAngle, 28);
          ctx.beginPath();
          pts.forEach((pt, idx) => {
            const sp = this.worldToScreen(pt.x, pt.y, e.z);
            if (idx === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.stroke();
        } else {
          const sc = this.worldToScreen(c.x, c.y, e.z);
          const sr = e.r * this.camera.scale;
          if (sr > 0.4) {
            ctx.beginPath();
            // Canvas Y is downward, so CCW math angles become CW in canvas (-angle)
            if (!this.swapAxes) {
              ctx.arc(sc.x, sc.y, sr, -e.startAngle, -e.endAngle, true);
            } else {
              ctx.arc(sc.x, sc.y, sr, e.startAngle - Math.PI * 0.5, e.endAngle - Math.PI * 0.5, false);
            }
            ctx.stroke();
          }
        }
        break;
      }

      case EntityType.ELLIPSE: {
        const c = displayXY(e.cx, e.cy, this.swapAxes);
        const m = displayXY(e.mx, e.my, this.swapAxes);
        const pts = sampleEllipsePoints(c.x, c.y, m.x, m.y, e.ratio, e.startParam, e.endParam, 48);
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const sp = this.worldToScreen(pt.x, pt.y, e.z);
          if (idx === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.stroke();
        break;
      }

      case EntityType.POLYLINE:
      case EntityType.POLYGON:
      case EntityType.FACE3D: {
        const pts = e.points;
        if (!pts || pts.length < 2) break;
        const isClosed = e.closed || e.type === EntityType.POLYGON || e.type === EntityType.FACE3D;

        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const dp = displayXY(pts[i].x, pts[i].y, this.swapAxes);
          const sp = this.worldToScreen(dp.x, dp.y, pts[i].z);
          if (i === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        }
        if (isClosed) ctx.closePath();

        if (isClosed && e.type !== EntityType.FACE3D) {
          ctx.save();
          ctx.globalAlpha = isSelected ? 0.25 : 0.11;
          ctx.fillStyle = strokeCol;
          ctx.fill();
          ctx.restore();
        }
        ctx.stroke();

        // Draw vertex handles on selected entity
        if (isSelected && pts.length <= 250) {
          ctx.fillStyle = theme.selection;
          for (const pt of pts) {
            const dp = displayXY(pt.x, pt.y, this.swapAxes);
            const sp = this.worldToScreen(dp.x, dp.y, pt.z);
            ctx.fillRect(sp.x - 2.5, sp.y - 2.5, 5, 5);
          }
        }
        break;
      }

      case EntityType.TEXT: {
        const pxH = (e.height || 2) * this.camera.scale;
        if (pxH < 3.5 && !isSelected) break;
        const clampedH = Math.min(72, Math.max(8, pxH));
        const dp = displayXY(e.x, e.y, this.swapAxes);
        const s = this.worldToScreen(dp.x, dp.y, e.z);
        ctx.translate(s.x, s.y);
        const ang = e.angle || 0;
        ctx.rotate(this.swapAxes ? ang - Math.PI * 0.5 : -ang);
        ctx.font = `${Math.round(clampedH)}px "Inter", "Segoe UI", sans-serif`;
        ctx.textBaseline = 'alphabetic';
        const lines = String(e.text).split('\n');
        lines.forEach((ln, idx) => {
          const yOff = idx * clampedH * 1.15;
          ctx.lineWidth = 3;
          ctx.strokeStyle = theme.halo;
          ctx.strokeText(ln, 0, yOff);
          ctx.fillStyle = strokeCol;
          ctx.fillText(ln, 0, yOff);
        });
        break;
      }

      default:
        break;
    }

    ctx.restore();
  }

  drawSnapMarker(ctx, snap, theme) {
    const s = this.worldToScreen(snap.x, snap.y, snap.z);
    ctx.save();
    ctx.lineWidth = 2;
    if (snap.kind === 'endpoint') {
      ctx.strokeStyle = theme.snapEndpoint;
      ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
    } else if (snap.kind === 'midpoint') {
      ctx.strokeStyle = theme.snapMidpoint;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 5.5, s.y + 4.5);
      ctx.lineTo(s.x - 5.5, s.y + 4.5);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeStyle = theme.snapCenter;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMeasureOverlay(ctx, pts, cursor, tool, theme) {
    const all = cursor ? [...pts, cursor] : pts;
    if (all.length === 0) return;

    ctx.save();
    ctx.strokeStyle = theme.measure;
    ctx.fillStyle = theme.measure;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    all.forEach((p, idx) => {
      const s = this.worldToScreen(p.x, p.y, p.z || 0);
      if (idx === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (tool === 'area' && all.length >= 3) {
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.restore();
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertices and segment lengths
    let totalDist = 0;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    for (let i = 0; i < all.length; i++) {
      const s = this.worldToScreen(all[i].x, all[i].y, all[i].z || 0);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();

      if (i > 0) {
        const prev = all[i - 1];
        const seg = Math.hypot(all[i].x - prev.x, all[i].y - prev.y);
        totalDist += seg;
        if (seg > 1e-6) {
          const sp = this.worldToScreen(prev.x, prev.y, prev.z || 0);
          const mx = (sp.x + s.x) * 0.5;
          const my = (sp.y + s.y) * 0.5;
          const label = `${seg.toFixed(2)}`;
          ctx.fillStyle = theme.halo;
          const tw = ctx.measureText(label).width;
          ctx.fillRect(mx - tw * 0.5 - 4, my - 10, tw + 8, 16);
          ctx.fillStyle = theme.measure;
          ctx.fillText(label, mx - tw * 0.5, my + 2);
        }
      }
    }

    // Floating summary badge near last point
    const last = all[all.length - 1];
    const ls = this.worldToScreen(last.x, last.y, last.z || 0);
    let summary = `L: ${totalDist.toFixed(2)}`;
    if (tool === 'area' && all.length >= 3) {
      const area = computePolygonArea(all);
      summary = `Alan: ${area.toFixed(2)} m²  |  Çevre: ${totalDist.toFixed(2)} m`;
    }
    ctx.fillStyle = theme.halo;
    const sw = ctx.measureText(summary).width;
    ctx.fillRect(ls.x + 10, ls.y - 24, sw + 12, 20);
    ctx.strokeStyle = theme.measure;
    ctx.strokeRect(ls.x + 10, ls.y - 24, sw + 12, 20);
    ctx.fillStyle = theme.measure;
    ctx.fillText(summary, ls.x + 16, ls.y - 10);

    ctx.restore();
  }
}
