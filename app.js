const canvas = document.querySelector("#fieldCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  gpsStatus: document.querySelector("#gpsStatus"),
  offsetValue: document.querySelector("#offsetValue"),
  swathValue: document.querySelector("#swathValue"),
  accuracyValue: document.querySelector("#accuracyValue"),
  speedValue: document.querySelector("#speedValue"),
  distanceValue: document.querySelector("#distanceValue"),
  areaValue: document.querySelector("#areaValue"),
  steerHint: document.querySelector("#steerHint"),
  locationReadout: document.querySelector("#locationReadout"),
  mapStatus: document.querySelector("#mapStatus"),
  recenterBtn: document.querySelector("#recenterBtn"),
  lightbar: document.querySelector("#lightbar"),
  fieldName: document.querySelector("#fieldName"),
  implementWidth: document.querySelector("#implementWidth"),
  viewDistance: document.querySelector("#viewDistance"),
  satelliteToggle: document.querySelector("#satelliteToggle"),
  historyList: document.querySelector("#historyList"),
  startGpsBtn: document.querySelector("#startGpsBtn"),
  demoBtn: document.querySelector("#demoBtn"),
  markABtn: document.querySelector("#markABtn"),
  markBBtn: document.querySelector("#markBBtn"),
  resetLineBtn: document.querySelector("#resetLineBtn"),
  clearTrackBtn: document.querySelector("#clearTrackBtn"),
  saveJobBtn: document.querySelector("#saveJobBtn"),
};

const state = {
  origin: null,
  current: null,
  previous: null,
  track: [],
  pointA: null,
  pointB: null,
  watchId: null,
  paused: false,
  distance: 0,
  mapPan: { x: 0, y: 0 },
  userPanned: false,
  drag: null,
  tileCache: new Map(),
  loadingTiles: 0,
  history: JSON.parse(localStorage.getItem("gps-agricola-history") || "[]"),
};

const TILE_SIZE = 256;
const SATELLITE_ZOOM = 18;
const SATELLITE_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

function toMeters(position) {
  if (!state.origin) {
    state.origin = { lat: position.lat, lon: position.lon };
  }

  const latMeters = 111320;
  const lonMeters = 111320 * Math.cos((state.origin.lat * Math.PI) / 180);

  return {
    x: (position.lon - state.origin.lon) * lonMeters,
    y: (position.lat - state.origin.lat) * latMeters,
    lat: position.lat,
    lon: position.lon,
    accuracy: position.accuracy || 0,
    speed: position.speed || 0,
    time: position.time || Date.now(),
  };
}

function metersToLatLon(point) {
  if (!state.origin) return null;

  const latMeters = 111320;
  const lonMeters = 111320 * Math.cos((state.origin.lat * Math.PI) / 180);

  return {
    lat: state.origin.lat + point.y / latMeters,
    lon: state.origin.lon + point.x / lonMeters,
  };
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setPosition(position) {
  const next = toMeters(position);
  state.previous = state.current;
  state.current = next;
  if (!state.userPanned) {
    state.mapPan = { x: 0, y: 0 };
  }

  if (!state.paused && (!state.track.length || distanceBetween(state.track[state.track.length - 1], next) > 0.4)) {
    if (state.track.length) {
      state.distance += distanceBetween(state.track[state.track.length - 1], next);
    }
    state.track.push(next);
  }

  updateMetrics();
  draw();
}

function getGuidance() {
  if (!state.current || !state.pointA || !state.pointB) return null;

  const width = Number(ui.implementWidth.value) || 1;
  const dx = state.pointB.x - state.pointA.x;
  const dy = state.pointB.y - state.pointA.y;
  const len = Math.hypot(dx, dy);
  if (len < 3) return null;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const relX = state.current.x - state.pointA.x;
  const relY = state.current.y - state.pointA.y;
  const signed = relX * nx + relY * ny;
  const swath = Math.round(signed / width);
  const targetOffset = swath * width;
  const error = signed - targetOffset;

  return { ux, uy, nx, ny, len, signed, swath, targetOffset, error, width };
}

function updateMetrics() {
  const guidance = getGuidance();
  const accuracy = state.current ? state.current.accuracy : 0;
  const speed = state.current ? Math.max(0, state.current.speed * 3.6) : 0;
  const areaHa = ((state.distance * (Number(ui.implementWidth.value) || 0)) / 10000);

  ui.accuracyValue.textContent = accuracy ? `${accuracy.toFixed(1)} m` : "--";
  ui.speedValue.textContent = `${speed.toFixed(1)} km/h`;
  ui.distanceValue.textContent = state.distance < 1000 ? `${state.distance.toFixed(0)} m` : `${(state.distance / 1000).toFixed(2)} km`;
  ui.areaValue.textContent = `${areaHa.toFixed(2)} ha`;
  ui.locationReadout.textContent = state.current
    ? `Mi ubicacion: ${state.current.lat.toFixed(6)}, ${state.current.lon.toFixed(6)}`
    : "Sin ubicacion";

  if (!guidance) {
    ui.offsetValue.textContent = "--";
    ui.swathValue.textContent = "--";
    if (!state.current) {
      ui.steerHint.textContent = "Inicia GPS para comenzar";
    } else if (state.current.accuracy > 100) {
      ui.steerHint.textContent = `Ubicacion aproximada, error ${state.current.accuracy.toFixed(0)} m`;
    } else {
      ui.steerHint.textContent = "Marca A y B para guiar";
    }
    updateLightbar(null);
    return;
  }

  const absError = Math.abs(guidance.error);
  ui.offsetValue.textContent = `${absError.toFixed(2)} m`;
  ui.swathValue.textContent = `${guidance.swath >= 0 ? "+" : ""}${guidance.swath}`;

  if (absError < 0.35) {
    ui.steerHint.textContent = "Centrado";
  } else if (guidance.error > 0) {
    ui.steerHint.textContent = `Corrige ${absError.toFixed(1)} m a la izquierda`;
  } else {
    ui.steerHint.textContent = `Corrige ${absError.toFixed(1)} m a la derecha`;
  }

  updateLightbar(guidance.error / Math.max(1, guidance.width / 2));
}

function updateLightbar(normalized) {
  const lights = [...ui.lightbar.querySelectorAll("span")];
  lights.forEach((light) => light.classList.remove("active"));
  if (normalized === null) return;

  const clamped = Math.max(-1, Math.min(1, normalized));
  const index = Math.round(((clamped + 1) / 2) * (lights.length - 1));
  lights[index].classList.add("active");
}

function getBounds() {
  const points = [...state.track, state.current, state.pointA, state.pointB].filter(Boolean);
  const viewDistance = Number(ui.viewDistance.value) || 220;

  if (!points.length) {
    const half = viewDistance / 2;
    return { minX: -half, maxX: half, minY: -half, maxY: half };
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const centerX = (state.current ? state.current.x : (Math.min(...xs) + Math.max(...xs)) / 2) + state.mapPan.x;
  const centerY = (state.current ? state.current.y : (Math.min(...ys) + Math.max(...ys)) / 2) + state.mapPan.y;
  const minSpan = viewDistance;
  const contentSpanX = Math.max(...xs) - Math.min(...xs);
  const contentSpanY = Math.max(...ys) - Math.min(...ys);
  const spanX = Math.max(minSpan, contentSpanX + viewDistance * 0.45);
  const spanY = Math.max(minSpan, contentSpanY + viewDistance * 0.45);

  return {
    minX: centerX - spanX / 2,
    maxX: centerX + spanX / 2,
    minY: centerY - spanY / 2,
    maxY: centerY + spanY / 2,
  };
}

function project(point, bounds) {
  const w = canvas.width;
  const h = canvas.height;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = Math.min(w / spanX, h / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const ox = (w - usedW) / 2;
  const oy = (h - usedH) / 2;

  return {
    x: ox + (point.x - bounds.minX) * scale,
    y: h - (oy + (point.y - bounds.minY) * scale),
    scale,
  };
}

function drawGrid(bounds) {
  const step = 20;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";

  for (let x = Math.floor(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
    const p1 = project({ x, y: bounds.minY }, bounds);
    const p2 = project({ x, y: bounds.maxY }, bounds);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (let y = Math.floor(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
    const p1 = project({ x: bounds.minX, y }, bounds);
    const p2 = project({ x: bounds.maxX, y }, bounds);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const cached = state.tileCache.get(key);
  if (cached) return cached;

  const tile = { status: "loading", image: new Image() };
  state.tileCache.set(key, tile);
  state.loadingTiles += 1;
  updateMapStatus();

  tile.image.crossOrigin = "anonymous";
  tile.image.onload = () => {
    tile.status = "ready";
    state.loadingTiles = Math.max(0, state.loadingTiles - 1);
    updateMapStatus();
    draw();
  };
  tile.image.onerror = () => {
    tile.status = "error";
    state.loadingTiles = Math.max(0, state.loadingTiles - 1);
    updateMapStatus();
    draw();
  };
  tile.image.src = `${SATELLITE_URL}/${z}/${y}/${x}`;

  return tile;
}

function updateMapStatus() {
  if (!ui.satelliteToggle.checked) {
    ui.mapStatus.textContent = "Satelite apagado";
  } else if (!state.origin) {
    ui.mapStatus.textContent = "Satelite espera GPS";
  } else if (state.loadingTiles > 0) {
    ui.mapStatus.textContent = "Cargando satelite";
  } else {
    ui.mapStatus.textContent = "Vista satelital";
  }
}

function drawFallbackBackground() {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#233628");
  gradient.addColorStop(0.45, "#425035");
  gradient.addColorStop(1, "#151d18");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawSatellite(bounds) {
  drawFallbackBackground();

  if (!ui.satelliteToggle.checked || !state.origin) {
    updateMapStatus();
    return;
  }

  const nw = metersToLatLon({ x: bounds.minX, y: bounds.maxY });
  const se = metersToLatLon({ x: bounds.maxX, y: bounds.minY });
  if (!nw || !se) return;

  const zoom = SATELLITE_ZOOM;
  const minTileX = lonToTileX(nw.lon, zoom);
  const maxTileX = lonToTileX(se.lon, zoom);
  const minTileY = latToTileY(nw.lat, zoom);
  const maxTileY = latToTileY(se.lat, zoom);

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      const tile = getTile(zoom, x, y);
      if (tile.status !== "ready") continue;

      const tileNw = latLonToMeters({ lat: tileYToLat(y, zoom), lon: tileXToLon(x, zoom) });
      const tileSe = latLonToMeters({ lat: tileYToLat(y + 1, zoom), lon: tileXToLon(x + 1, zoom) });
      const p1 = project(tileNw, bounds);
      const p2 = project(tileSe, bounds);
      ctx.drawImage(tile.image, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }
  }

  ctx.fillStyle = "rgba(5, 8, 6, 0.18)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  updateMapStatus();
}

function latLonToMeters(position) {
  if (!state.origin) return { x: 0, y: 0 };

  const latMeters = 111320;
  const lonMeters = 111320 * Math.cos((state.origin.lat * Math.PI) / 180);

  return {
    x: (position.lon - state.origin.lon) * lonMeters,
    y: (position.lat - state.origin.lat) * latMeters,
  };
}

function drawTrack(bounds) {
  if (state.track.length < 2) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const width = Number(ui.implementWidth.value) || 1;
  const sample = project(state.track[0], bounds);
  ctx.lineWidth = Math.max(5, width * sample.scale);
  ctx.strokeStyle = "rgba(110, 231, 125, 0.2)";
  ctx.beginPath();
  state.track.forEach((point, index) => {
    const p = project(point, bounds);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#6ee77d";
  ctx.beginPath();
  state.track.forEach((point, index) => {
    const p = project(point, bounds);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawGuidanceLines(bounds) {
  const guidance = getGuidance();
  if (!guidance || !state.pointA) return;

  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1.5;
  const count = Math.ceil(extent / guidance.width);

  for (let i = -count; i <= count; i += 1) {
    const base = {
      x: state.pointA.x + guidance.nx * i * guidance.width,
      y: state.pointA.y + guidance.ny * i * guidance.width,
    };
    const p1 = project({ x: base.x - guidance.ux * extent, y: base.y - guidance.uy * extent }, bounds);
    const p2 = project({ x: base.x + guidance.ux * extent, y: base.y + guidance.uy * extent }, bounds);
    const active = i === guidance.swath;

    ctx.lineWidth = active ? 4 : 1.5;
    ctx.strokeStyle = active ? "#f4c95d" : "rgba(113, 184, 255, 0.36)";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

function drawMarker(point, label, color, bounds) {
  if (!point) return;

  const p = project(point, bounds);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#0b110e";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, p.x, p.y + 1);
}

function drawTractor(bounds) {
  if (!state.current) return;

  const p = project(state.current, bounds);
  const accuracyRadius = Math.min(260, Math.max(12, state.current.accuracy * p.scale));

  ctx.fillStyle = "rgba(113, 184, 255, 0.16)";
  ctx.strokeStyle = "rgba(113, 184, 255, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, accuracyRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  let angle = -Math.PI / 2;
  if (state.previous) {
    angle = Math.atan2(-(state.current.y - state.previous.y), state.current.x - state.previous.x);
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = "#f4c95d";
  ctx.strokeStyle = "#0b110e";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(15, 16);
  ctx.lineTo(0, 9);
  ctx.lineTo(-15, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(9, 13, 11, 0.78)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(p.x - 54, p.y + 24, 108, 28, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f3f7f0";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Mi ubicacion", p.x, p.y + 38);
}

function draw() {
  const bounds = getBounds();
  drawSatellite(bounds);
  drawGrid(bounds);
  drawTrack(bounds);
  drawGuidanceLines(bounds);
  drawMarker(state.pointA, "A", "#71b8ff", bounds);
  drawMarker(state.pointB, "B", "#ff6b5e", bounds);
  drawTractor(bounds);
}

function startGps() {
  if (!("geolocation" in navigator)) {
    ui.gpsStatus.textContent = "GPS no disponible";
    return;
  }

  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
  }

  resetRun(false);
  state.paused = false;
  ui.demoBtn.textContent = "Pausar";
  ui.gpsStatus.textContent = "Buscando GPS";
  ui.gpsStatus.className = "status-pill";

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      ui.gpsStatus.textContent = "GPS activo";
      ui.gpsStatus.className = "status-pill live";
      setPosition({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed || 0,
        time: position.timestamp,
      });
    },
    (error) => {
      const messages = {
        1: "Permiso GPS bloqueado",
        2: "Ubicacion no disponible",
        3: "GPS sin respuesta",
      };
      ui.gpsStatus.textContent = messages[error.code] || "Error GPS";
      ui.gpsStatus.className = "status-pill";
      ui.steerHint.textContent = "Revisa permisos de ubicacion";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 },
  );
}
function togglePause() {
  if (!state.current) {
    ui.steerHint.textContent = "Inicia GPS antes de pausar";
    return;
  }

  state.paused = !state.paused;
  ui.demoBtn.textContent = state.paused ? "Continuar" : "Pausar";
  ui.gpsStatus.textContent = state.paused ? "Pausado" : "GPS activo";
  ui.gpsStatus.className = state.paused ? "status-pill demo" : "status-pill live";
  ui.steerHint.textContent = state.paused ? "Recorrido pausado" : "Recorrido activo";
  draw();
}

function resetRun(keepLine) {
  state.origin = null;
  state.current = null;
  state.previous = null;
  state.track = [];
  state.distance = 0;
  state.paused = false;
  ui.demoBtn.textContent = "Pausar";
  state.mapPan = { x: 0, y: 0 };
  state.userPanned = false;
  if (!keepLine) {
    state.pointA = null;
    state.pointB = null;
  }
  updateMetrics();
  draw();
}

function saveJob() {
  const areaHa = ((state.distance * (Number(ui.implementWidth.value) || 0)) / 10000);
  const entry = {
    name: ui.fieldName.value || "Trabajo sin nombre",
    date: new Date().toLocaleString("es-CL"),
    distance: state.distance,
    areaHa,
    width: Number(ui.implementWidth.value) || 0,
  };

  state.history.unshift(entry);
  state.history = state.history.slice(0, 8);
  localStorage.setItem("gps-agricola-history", JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    ui.historyList.innerHTML = `<p class="empty">Aun no hay trabajos guardados.</p>`;
    return;
  }

  ui.historyList.innerHTML = state.history
    .map((item) => `
      <div class="history-item">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.date} | ${item.areaHa.toFixed(2)} ha | ancho ${item.width} m</span>
      </div>
    `)
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

ui.startGpsBtn.addEventListener("click", startGps);
ui.demoBtn.addEventListener("click", togglePause);
ui.markABtn.addEventListener("click", () => {
  if (!state.current) return;
  state.pointA = { ...state.current };
  state.pointB = null;
  updateMetrics();
  draw();
});
ui.markBBtn.addEventListener("click", () => {
  if (!state.current || !state.pointA) return;
  state.pointB = { ...state.current };
  updateMetrics();
  draw();
});
ui.resetLineBtn.addEventListener("click", () => {
  state.pointA = null;
  state.pointB = null;
  updateMetrics();
  draw();
});
ui.clearTrackBtn.addEventListener("click", () => resetRun(true));
ui.saveJobBtn.addEventListener("click", saveJob);
ui.implementWidth.addEventListener("input", () => {
  updateMetrics();
  draw();
});
ui.viewDistance.addEventListener("change", draw);
ui.satelliteToggle.addEventListener("change", draw);
ui.recenterBtn.addEventListener("click", () => {
  state.mapPan = { x: 0, y: 0 };
  state.userPanned = false;
  draw();
});

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY;

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    rect,
  };
}

function beginPan(event) {
  if (!state.current) return;
  const point = getCanvasPoint(event);
  const bounds = getBounds();
  const scale = project(state.current, bounds).scale;
  state.drag = {
    x: point.x,
    y: point.y,
    panX: state.mapPan.x,
    panY: state.mapPan.y,
    scale,
  };
  canvas.setPointerCapture?.(event.pointerId);
}

function movePan(event) {
  if (!state.drag) return;
  event.preventDefault();
  const point = getCanvasPoint(event);
  const dx = (point.x - state.drag.x) / state.drag.scale;
  const dy = (point.y - state.drag.y) / state.drag.scale;
  state.mapPan = {
    x: state.drag.panX - dx,
    y: state.drag.panY + dy,
  };
  state.userPanned = true;
  draw();
}

function endPan() {
  state.drag = null;
}

canvas.addEventListener("pointerdown", beginPan);
canvas.addEventListener("pointermove", movePan);
canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  });
}

renderHistory();
updateMetrics();
draw();



