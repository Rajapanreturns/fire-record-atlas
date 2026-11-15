// Orthographic view of the atlas's existing latitude/longitude grid. Cell colours and
// sparsity flags use the same classification as the flat map; rotation only changes the view.
import { classify } from './monthly.js';
import { shortName } from './story.js';

const RAD = Math.PI / 180;
const INITIAL = { lon: 39, lat: 14 };
const wrap = (value) => ((((value + 180) % 360) + 360) % 360) - 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function unitVector(lon, lat) {
  const latitude = lat * RAD;
  return [Math.cos(latitude) * Math.cos(lon * RAD), Math.cos(latitude) * Math.sin(lon * RAD), Math.sin(latitude)];
}

// Project shared grid vertices once per frame. The small gap between adjacent cells
// keeps the shape of the sampling grid legible when the viewer rotates the globe.
function cellMesh(layer) {
  const vertices = [],
    cornerIds = new Map();
  const cells = new Uint32Array((layer?.n || 0) * 4);
  function vertex(lon, lat) {
    const key = lon + ',' + lat;
    if (cornerIds.has(key)) return cornerIds.get(key);
    const id = vertices.length / 3;
    vertices.push(...unitVector(lon, lat));
    cornerIds.set(key, id);
    return id;
  }
  for (let i = 0; i < (layer?.n || 0); i++) {
    const x = layer.lon[i],
      y = layer.lat[i],
      r = layer.res;
    cells.set([vertex(x, y), vertex(x + r, y), vertex(x + r, y + r), vertex(x, y + r)], i * 4);
  }
  return { xyz: new Float32Array(vertices), cells, projected: new Float32Array(vertices.length) };
}

export function createGlobe(
  host,
  { layer, thresholds, landGeo, regions = [], colours, zeroEdge = null, onPlace, onRegion, onCoordinates }
) {
  const canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute(
    'aria-label',
    'Interactive fire detection globe. Drag or use the arrow keys to rotate. Hold Shift for larger steps. Enter inspects the centre. Home resets the view.'
  );
  host.append(canvas);
  const g = canvas.getContext('2d');
  const d3 = window.d3;
  const projection = d3.geoOrthographic().clipAngle(90);
  const path = d3.geoPath(projection, g);
  const grid = d3.geoGraticule().step([20, 15])();
  const mesh = cellMesh(layer);
  const months = new Map();
  const markers = regions.map((region) => {
    const [west, south, east, north] = region.bbox;
    return { region, lon: (east + west) / 2, lat: (north + south) / 2, name: shortName(region.name) };
  });
  let center = { ...INITIAL },
    month = 0,
    labels = true,
    active = true;
  let width = 0,
    height = 0,
    radius = 0,
    ratio = 1;
  let queue = 0,
    drag = null,
    hovered = null,
    markerHits = [];
  const inside = (x, y) => Math.hypot(x - width / 2, y - height / 2) <= radius;
  function requestDraw() {
    if (active && !queue) queue = requestAnimationFrame(draw);
  }
  function surface() {
    const cosLon = Math.cos(center.lon * RAD),
      sinLon = Math.sin(center.lon * RAD);
    const cosLat = Math.cos(center.lat * RAD),
      sinLat = Math.sin(center.lat * RAD);
    const { xyz, projected: pts, cells } = mesh;
    for (let i = 0; i < xyz.length; i += 3) {
      const x = xyz[i],
        y = xyz[i + 1],
        z = xyz[i + 2];
      const meridian = x * cosLon + y * sinLon;
      pts[i] = width / 2 + radius * (-x * sinLon + y * cosLon);
      pts[i + 1] = height / 2 - radius * (z * cosLat - meridian * sinLat);
      pts[i + 2] = meridian * cosLat + z * sinLat;
    }
    if (!months.has(month)) months.set(month, classify(layer, month, thresholds));
    const { cls, sp } = months.get(month);
    const paths = colours.map(() => new Path2D()),
      sparse = colours.map(() => new Path2D());
    const dots = new Path2D();
    for (let i = 0; i < layer.n; i++) {
      const k = cls[i];
      if (k < 0) continue;
      const offset = i * 4,
        a = cells[offset] * 3,
        b = cells[offset + 1] * 3,
        c = cells[offset + 2] * 3,
        d = cells[offset + 3] * 3;
      if (pts[a + 2] + pts[b + 2] + pts[c + 2] + pts[d + 2] <= 0) continue;
      const cx = (pts[a] + pts[b] + pts[c] + pts[d]) / 4,
        cy = (pts[a + 1] + pts[b + 1] + pts[c + 1] + pts[d + 1]) / 4;
      const fill = sp[i] ? sparse[k] : paths[k];
      // A small inset exposes grid boundaries while each painted tile stays at its actual location.
      const factor = 0.89;
      fill.moveTo(cx + (pts[a] - cx) * factor, cy + (pts[a + 1] - cy) * factor);
      fill.lineTo(cx + (pts[b] - cx) * factor, cy + (pts[b + 1] - cy) * factor);
      fill.lineTo(cx + (pts[c] - cx) * factor, cy + (pts[c + 1] - cy) * factor);
      fill.lineTo(cx + (pts[d] - cx) * factor, cy + (pts[d + 1] - cy) * factor);
      fill.closePath();
      if (sp[i]) dots.rect(cx - 0.4, cy - 0.4, 0.8, 0.8);
    }
    colours.forEach((color, k) => {
      g.fillStyle = color;
      g.fill(paths[k]);
      g.fillStyle = '#c2c4ba';
      g.fill(sparse[k]);
      g.globalAlpha = 0.48;
      g.fillStyle = color;
      g.fill(sparse[k]);
      g.globalAlpha = 1;
    });
    if (zeroEdge) {
      // 'no detections reported' tiles: same grey fill, plus a thin lighter inner edge (not colour alone vs blank)
      g.save();
      g.clip(paths[0]);
      g.strokeStyle = zeroEdge;
      g.lineWidth = 1.2;
      g.stroke(paths[0]);
      g.restore();
    }
    g.fillStyle = '#242a2a';
    g.fill(dots);
  }
  function drawMarkers() {
    markerHits = [];
    if (!labels) return;
    for (const mark of markers) {
      if (d3.geoDistance([center.lon, center.lat], [mark.lon, mark.lat]) >= Math.PI / 2) continue;
      const [x, y] = projection([mark.lon, mark.lat]);
      // M4.5 (M3): every study region's marker alike; provisional ones dashed (the list carries each test and status)
      g.strokeStyle = '#e0f1eb';
      g.lineWidth = 1.2;
      g.setLineDash(mark.region.status === 'provisional' ? [2, 1.5] : []);
      g.strokeRect(x - 4, y - 4, 8, 8);
      g.setLineDash([]);
      g.fillStyle = '#101517';
      g.fillRect(x - 2, y - 2, 4, 4);
      markerHits.push({ mark, x, y });
      if (mark !== hovered) continue;
      const name = mark.name;
      g.font = '600 12px Archivo, sans-serif';
      const boxWidth = g.measureText(name).width + 14;
      const left = clamp(x + 10, 3, width - boxWidth - 3),
        top = clamp(y - 25, 3, height - 24);
      g.fillStyle = '#101617';
      g.fillRect(left, top, boxWidth, 21);
      g.strokeStyle = '#8e9e9a';
      g.strokeRect(left, top, boxWidth, 21);
      g.fillStyle = '#f1f4ef';
      g.fillText(name, left + 7, top + 14);
    }
  }
  function draw() {
    queue = 0;
    if (!active || !width || !height) return;
    projection
      .translate([width / 2, height / 2])
      .scale(radius)
      .rotate([-center.lon, -center.lat, 0]);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    g.beginPath();
    g.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    g.fillStyle = '#080c0d';
    g.fill();
    g.save();
    g.clip();
    if (landGeo) {
      g.beginPath();
      path(landGeo);
      g.fillStyle = '#202627';
      g.fill();
    }
    if (layer) surface();
    g.beginPath();
    path(grid);
    g.lineWidth = 0.65;
    g.strokeStyle = 'rgba(158,184,182,.37)';
    g.stroke();
    if (landGeo) {
      g.beginPath();
      path(landGeo);
      g.lineWidth = 0.65;
      g.strokeStyle = 'rgba(211,218,208,.54)';
      g.stroke();
    }
    g.restore();
    g.beginPath();
    g.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = '#778784';
    g.stroke();
    drawMarkers();
    if (canvas.matches(':focus-visible')) {
      const x = width / 2,
        y = height / 2;
      g.strokeStyle = '#c3e8de';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x - 8, y);
      g.lineTo(x + 8, y);
      g.moveTo(x, y - 8);
      g.lineTo(x, y + 8);
      g.stroke();
    }
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    width = w;
    height = h;
    radius = Math.min(w, h) * 0.46;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    requestDraw();
  }
  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * width) / rect.width,
      y = ((event.clientY - rect.top) * height) / rect.height;
    if (!inside(x, y)) return {};
    const [lon, lat] = projection.invert([x, y]);
    const hit = markerHits.find((p) => Math.hypot(x - p.x, y - p.y) <= 10);
    return { place: { lon, lat }, mark: hit?.mark };
  }
  function updateCoordinates(place) {
    onCoordinates?.(place || null);
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!active || event.button !== 0 || drag || !pointAt(event).place) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...center }, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!active) return;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      hovered = null;
      center = {
        lon: wrap(drag.origin.lon - dx / (radius * RAD)),
        lat: clamp(drag.origin.lat + dy / (radius * RAD), -90, 90),
      };
      updateCoordinates(center);
      requestDraw();
      return;
    }
    const { place, mark } = pointAt(event);
    canvas.style.cursor = mark ? 'pointer' : place ? 'grab' : 'default';
    updateCoordinates(place);
    if (mark !== hovered) {
      hovered = mark;
      requestDraw();
    }
  });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const select = event.type === 'pointerup' && !drag.moved;
    drag = null;
    canvas.style.cursor = 'grab';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!select) return;
    const { place, mark } = pointAt(event);
    if (mark) onRegion?.(mark.region);
    else if (place) onPlace?.(place);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endDrag);
  canvas.addEventListener('click', (event) => event.stopPropagation());
  canvas.addEventListener('pointerleave', () => {
    if (!drag) {
      hovered = null;
      updateCoordinates(null);
      requestDraw();
    }
  });
  canvas.addEventListener('focus', requestDraw);
  canvas.addEventListener('blur', requestDraw);
  canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 30 : 5;
    switch (event.key) {
      case 'ArrowLeft':
        center.lon = wrap(center.lon - step);
        break;
      case 'ArrowRight':
        center.lon = wrap(center.lon + step);
        break;
      case 'ArrowUp':
        center.lat = clamp(center.lat + step, -90, 90);
        break;
      case 'ArrowDown':
        center.lat = clamp(center.lat - step, -90, 90);
        break;
      case 'Home':
        center = { ...INITIAL };
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        onPlace?.({ ...center });
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    hovered = null;
    updateCoordinates(center);
    requestDraw();
  });
  resize();
  return {
    resize,
    setMonth(value) {
      month = layer?.monthly ? value : 0;
      requestDraw();
    },
    setLabels(value) {
      labels = value;
      hovered = null;
      requestDraw();
    },
    setActive(value) {
      active = value;
      canvas.tabIndex = value ? 0 : -1;
      if (value) resize();
      else {
        drag = null;
        hovered = null;
      }
    },
    focusPlace(place) {
      center = { lat: clamp(place.lat, -90, 90), lon: wrap(place.lon) };
      requestDraw();
    },
    reset() {
      center = { ...INITIAL };
      hovered = null;
      updateCoordinates(center);
      requestDraw();
    },
  };
}
