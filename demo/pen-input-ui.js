(() => {
  const u = window.PenInputUtils;
  if (!u) {
    throw new Error("Missing window.PenInputUtils. Load pen-input-utils.js before pen-input-ui.js");
  }

  const {
    simplifyRDP3D,
    fitBSpline,
    evalS,
    getSVGPath,
    computeMaxDistanceErrorXY,
    formatPointList,
    deboorEval,
  } = u;

  /* ============================================================
   * DOM
   * ============================================================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  const ui = {
    // sliders
    eps: document.getElementById("param-eps"),
    p: document.getElementById("param-p"),
    maxW: document.getElementById("param-maxw"),
    fit: document.getElementById("param-fit"),
    tol: document.getElementById("param-tol"),
    // readouts
    dEps: document.getElementById("disp-eps"),
    dP: document.getElementById("disp-p"),
    dMaxW: document.getElementById("disp-maxw"),
    dFit: document.getElementById("disp-fit"),
    dTol: document.getElementById("disp-tol"),
    dCp: document.getElementById("disp-cp"),
    // panes
    logDebug: document.getElementById("log-debug"),
    logExport: document.getElementById("log-export"),
    logDBSC: document.getElementById("log"),
    svgPreview: document.getElementById("svg-preview"),
    paneDebug: document.getElementById("pane-debug"),
    paneExport: document.getElementById("pane-export"),
    paneLog: document.getElementById("pane-log"),
    paneSvg: document.getElementById("pane-svg"),
    chkDebug: document.getElementById("chk-debug"),
    chkExport: document.getElementById("chk-export"),
    chkLog: document.getElementById("chk-log"),
    chkSvg: document.getElementById("chk-svg"),
    chkVerbose: document.getElementById("chk-verbose"),
    // renderer
    chkCompare: document.getElementById("chk-compare"),
    chkClosed: document.getElementById("chk-closed"),
    chkColor: document.getElementById("chk-color"),
    chkPathPoints: document.getElementById("chk-path-points"),
    methodLegend: document.getElementById("method-legend"),
    // visibility
    togRaw: document.getElementById("tog-raw"),
    togReduced: document.getElementById("tog-reduced"),
    togCurve: document.getElementById("tog-curve"),
    togSkel: document.getElementById("tog-skel"),
    togNorm: document.getElementById("tog-norm"),
    togDisks: document.getElementById("tog-disks"),
    togCusps: document.getElementById("tog-cusps"),
    cuspBadge: document.getElementById("cusp-badge"),
    // actions
    btnClear: document.getElementById("btn-clear"),
    btnDeleteLast: document.getElementById("btn-delete-last"),
    btnDownload: document.getElementById("btn-download"),
    btnLoad: document.getElementById("btn-load"),
    presetSelect: document.getElementById("preset-select"),
    // color popover
    cpPop: document.getElementById("color-picker-popover"),
    cpInput: document.getElementById("cp-input"),
    cpApply: document.getElementById("cp-apply"),
    cpReset: document.getElementById("cp-reset"),
    cpClose: document.getElementById("cp-close"),
    cpAll: document.getElementById("cp-all"),
    cpTitle: document.getElementById("cp-title"),
    // toast
    toast: document.getElementById("toast"),
  };

  /* ============================================================
   * State
   * ============================================================ */
  let dpr = window.devicePixelRatio || 1;

  // Multi-stroke: committed are finalized and rendered read-only; active is editable.
  const committed = []; // [{ rawPoints, rdpPoints, spline }]
  let active = null; //    { rawPoints, rdpPoints, spline } | null

  let isDrawing = false;
  let draggingCenterIndex = -1;
  let draggingRadiusIndex = -1;
  let draggingPointerId = null;
  let colorPickIndex = -1;

  const state = {
    // Visibility
    raw: true, reduced: true, curve: true,
    skeleton: false, normals: false, disks: true, cusps: false,
    // Renderer
    method: "analytical", // simple | analytical | skinning
    compare: false,
    closed: false,
    color: true,
    pathPoints: true,
    // Tunables
    degree: 3,
    renderTol: 0.5,
    // Fit
    eps: 2.0, pWeight: 1000, maxW: 30, fit: 2.0,
    // Pressure
    psim: "input",
    // Debug
    verboseLog: false,
  };

  const colorPalette = [
    { r: 1, g: 0, b: 0, a: 1 },
    { r: 0, g: 1, b: 0, a: 1 },
    { r: 0, g: 0, b: 1, a: 1 },
    { r: 1, g: 1, b: 0, a: 1 },
    { r: 0, g: 1, b: 1, a: 1 },
    { r: 1, g: 0, b: 1, a: 1 },
  ];

  /* ============================================================
   * Small helpers
   * ============================================================ */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function toast(msg, ms = 1400) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => ui.toast.classList.remove("visible"), ms);
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => toast("Copied"),
        () => toast("Copy failed")
      );
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast("Copied");
      } catch (_) { toast("Copy failed"); }
    }
  }

  function hexToRGBA01(hex, a = 1) {
    const h = (hex || "").replace("#", "");
    if (h.length !== 6) return { r: 0, g: 0, b: 0, a };
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a,
    };
  }

  function rgba01ToHex(c) {
    if (!c) return "#000000";
    const to = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
    return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
  }

  function paletteColorForIndex(i) {
    return colorPalette[i % colorPalette.length];
  }

  /* ============================================================
   * Resize / canvas
   * ============================================================ */
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    draw();
  }
  window.addEventListener("resize", resize);

  function getC(e) {
    const r = canvas.getBoundingClientRect();
    const p = e.pressure || 0.5;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, p };
  }

  /* ============================================================
   * Stroke-width helpers
   * ============================================================ */
  function strokeWidthCssPx(pressure01) {
    const maxW = Math.max(1, state.maxW);
    return 1 + clamp01(pressure01) * (maxW - 1);
  }

  function getEffectiveWidthCssPxForCP(cp) {
    if (cp && Number.isFinite(cp.widthOverrideCssPx)) {
      return Math.max(0.5, cp.widthOverrideCssPx);
    }
    return Math.max(0.5, strokeWidthCssPx(cp?.p ?? 0));
  }

  function diskRadiusCssPxForCP(cp) {
    return Math.max(0.25, getEffectiveWidthCssPxForCP(cp) / 2);
  }

  function isCurveEditable() {
    return !!(state.disks && active?.spline?.controlPoints?.length);
  }

  /* ============================================================
   * Pressure simulation
   * ============================================================ */
  function applyPressureSim(points, mode) {
    if (!points?.length) return points;
    if (mode === "input") return points;

    const n = points.length;
    const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

    if (mode === "uniform") {
      return points.map((p) => ({ ...p, p: 0.8 }));
    }
    if (mode === "ease") {
      return points.map((p, i) => ({ ...p, p: 0.15 + 0.85 * easeInOut(i / Math.max(1, n - 1)) }));
    }
    if (mode === "speed") {
      // Map speed (dist between samples) inversely to pressure. Faster → thinner.
      const speeds = new Array(n).fill(0);
      for (let i = 1; i < n; i++) {
        speeds[i] = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      speeds[0] = speeds[1] || 0;
      const maxS = Math.max(1, ...speeds);
      return points.map((p, i) => {
        const normalized = speeds[i] / maxS;
        return { ...p, p: Math.max(0.1, Math.min(1, 1 - normalized * 0.8)) };
      });
    }
    return points;
  }

  /* ============================================================
   * Active-stroke processing: RDP + adaptive B-spline fit
   * ============================================================ */
  function processActive() {
    if (!active || active.rawPoints.length < 2) return;

    const pressured = applyPressureSim(active.rawPoints, state.psim);

    active.rdpPoints = simplifyRDP3D(pressured, state.eps * dpr, state.pWeight);

    const targetErr = Math.max(0.5 * dpr, state.fit * dpr);
    const minCPs = Math.max(state.degree + 1, Math.min(8, active.rdpPoints.length));
    const maxCPs = Math.max(minCPs, Math.min(50, active.rdpPoints.length));

    let bestSpline = null;
    let bestErr = Infinity;
    let chosenCPs = minCPs;

    for (let cpCount = minCPs; cpCount <= maxCPs; cpCount++) {
      const s = fitBSpline(active.rdpPoints, cpCount, state.degree);
      if (!s) continue;
      const err = computeMaxDistanceErrorXY(s, active.rdpPoints, s.params);
      if (err < bestErr) {
        bestErr = err;
        bestSpline = s;
        chosenCPs = cpCount;
      }
      if (err <= targetErr) break;
    }

    active.spline = bestSpline;
    ui.dCp.textContent = chosenCPs;
  }

  /* ============================================================
   * Preset stroke library (test-case strokes)
   * ============================================================ */
  function sampleParametric(n, fn) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(fn(i / (n - 1)));
    return pts;
  }

  function presetStroke(name) {
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const scale = Math.min(w, h) * 0.35;

    switch (name) {
      case "calligraphic-s":
        return sampleParametric(40, (t) => {
          const s = Math.sin(t * Math.PI * 1.2);
          return {
            x: cx + (t - 0.5) * scale * 2.4,
            y: cy - s * scale * 0.8,
            p: 0.2 + 0.8 * Math.sin(t * Math.PI),
          };
        });
      case "tight-loop":
        return sampleParametric(80, (t) => {
          const theta = t * Math.PI * 2.6;
          const r = scale * (0.15 + 0.35 * t);
          return {
            x: cx + r * Math.cos(theta),
            y: cy + r * Math.sin(theta),
            p: 0.25 + 0.75 * t,
          };
        });
      case "zero-tail":
        return sampleParametric(30, (t) => ({
          x: cx - scale + t * scale * 2,
          y: cy + Math.sin(t * Math.PI * 2) * scale * 0.15,
          p: Math.max(0.01, 1 - t),
        }));
      case "figure-eight":
        return sampleParametric(120, (t) => {
          const theta = t * Math.PI * 2;
          return {
            x: cx + scale * Math.sin(theta),
            y: cy + scale * 0.6 * Math.sin(2 * theta),
            p: 0.3 + 0.7 * Math.abs(Math.sin(2 * theta)),
          };
        });
      case "circle":
        return sampleParametric(60, (t) => {
          const theta = t * Math.PI * 2;
          return {
            x: cx + scale * Math.cos(theta),
            y: cy + scale * Math.sin(theta),
            p: 0.6,
          };
        });
      default:
        return null;
    }
  }

  function applyPreset(name) {
    if (!name) return;
    const pts = presetStroke(name);
    if (!pts) return;
    // Closed shapes auto-enable Closed toggle
    const wasClosed = state.closed;
    if (name === "circle" || name === "figure-eight") {
      state.closed = true;
      ui.chkClosed.checked = true;
    }
    commitActiveIfAny();
    active = { rawPoints: pts.map((p) => ({ ...p })), rdpPoints: [], spline: null };
    processActive();
    draw();
    updatePanes();
    writeHash();
    if (wasClosed !== state.closed) { /* noop, reflected in UI already */ }
  }

  /* ============================================================
   * DBSC import: parse DBSC-array text into a stroke
   * ============================================================ */
  function parseDBSCArray(text) {
    if (!text) return null;
    const lines = String(text).split(/\r?\n/);
    const entries = [];
    let closed = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // Skip obvious headers/labels
      if (/^---|^<|^\[/.test(line)) continue;
      if (/^z$|^Z$/.test(line)) { closed = true; continue; }
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      if (parts.length < 3) continue;
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const w = parseFloat(parts[2]);
      let hex = null;
      if (parts[3] && /^#?[0-9a-fA-F]{6}$/.test(parts[3])) {
        hex = parts[3].startsWith("#") ? parts[3] : "#" + parts[3];
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w)) continue;
      entries.push({ x, y, w, hex });
    }
    if (entries.length < 2) return null;
    return { entries, closed };
  }

  function loadFromExport() {
    const txt = ui.logExport.value || "";
    // Find the DBSC ARRAY block specifically, or parse the whole text tolerantly
    let block = txt;
    const marker = "--- DBSC ARRAY ---";
    const idx = txt.indexOf(marker);
    if (idx >= 0) {
      block = txt.slice(idx + marker.length);
      const next = block.indexOf("\n---");
      if (next >= 0) block = block.slice(0, next);
    }
    const parsed = parseDBSCArray(block);
    if (!parsed) { toast("No DBSC array found"); return; }

    // Interpret coordinates as CSS px (exports are CSS px). Convert to device px.
    const pts = parsed.entries.map((e) => {
      const maxW = Math.max(1, state.maxW);
      const pPressure = clamp01((e.w - 1) / Math.max(0.0001, maxW - 1));
      return { x: e.x * dpr, y: e.y * dpr, p: pPressure };
    });

    // Build an rdpPoints-like array and fit it. Preserve widths via widthOverrideCssPx.
    commitActiveIfAny();
    active = {
      rawPoints: pts.map((p) => ({ ...p })),
      rdpPoints: [],
      spline: null,
    };
    processActive();

    // Re-apply widths & colors from import as overrides on control points.
    // CP count won't match imported disks exactly, so we index proportionally.
    if (active.spline?.controlPoints?.length && parsed.entries.length) {
      const cps = active.spline.controlPoints;
      for (let i = 0; i < cps.length; i++) {
        const tIdx = (i / Math.max(1, cps.length - 1)) * (parsed.entries.length - 1);
        const lo = Math.floor(tIdx), hi = Math.min(parsed.entries.length - 1, lo + 1);
        const f = tIdx - lo;
        const w = parsed.entries[lo].w * (1 - f) + parsed.entries[hi].w * f;
        cps[i].widthOverrideCssPx = w;
        const nearest = f < 0.5 ? parsed.entries[lo] : parsed.entries[hi];
        if (nearest.hex) cps[i].colorOverride = hexToRGBA01(nearest.hex);
      }
    }

    if (parsed.closed) { state.closed = true; ui.chkClosed.checked = true; }

    draw();
    updatePanes();
    writeHash();
    toast("Loaded from export");
  }

  /* ============================================================
   * DiskBSpline construction for a stroke (device-px coordinates)
   * ============================================================ */
  function isDiskBSplineAvailable() {
    return typeof window.DiskBSpline === "function";
  }

  function buildControlDisksPx(spline) {
    if (!spline?.controlPoints?.length) return [];
    return spline.controlPoints.map((cp, i) => {
      const widthCss = getEffectiveWidthCssPxForCP(cp);
      const radiusPx = (widthCss / 2) * dpr;
      let color;
      if (cp.colorOverride) color = cp.colorOverride;
      else if (state.color) color = paletteColorForIndex(i);
      else color = { r: 0, g: 0, b: 0, a: 1 };
      return {
        center: { x: cp.x, y: cp.y },
        radius: Math.max(0, radiusPx),
        color,
      };
    });
  }

  function buildDBSC(spline, opts = {}) {
    if (!isDiskBSplineAvailable()) return null;
    const disks = buildControlDisksPx(spline);
    if (disks.length < (opts.degree ?? state.degree) + 1) return null;
    try {
      return new window.DiskBSpline(disks, {
        degree: opts.degree ?? state.degree,
        debug: !!opts.debug,
        closed: opts.closed ?? state.closed,
      });
    } catch (_) { return null; }
  }

  /* ============================================================
   * Cusp (admissibility) detection
   * ============================================================ */
  function detectCuspRanges(bs, numSamples = 200) {
    if (!bs || !Array.isArray(bs.knots) || bs.knots.length === 0) {
      return { ranges: [], total: 0 };
    }
    const startU = bs.knots[bs.degree];
    const endU = bs.knots[bs.controlDisks.length];
    if (!Number.isFinite(startU) || !Number.isFinite(endU) || endU <= startU) {
      return { ranges: [], total: 0 };
    }
    const ranges = [];
    let inCusp = false;
    let startT = 0;
    let total = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = startU + (i / (numSamples - 1)) * (endU - startU);
      let admissible = true;
      try { admissible = bs.isAdmissibleAt(t, false); } catch (_) { admissible = true; }
      if (!admissible) {
        total++;
        if (!inCusp) { inCusp = true; startT = t; }
      } else if (inCusp) {
        ranges.push({ start: startT, end: t });
        inCusp = false;
      }
    }
    if (inCusp) ranges.push({ start: startT, end: startU + (endU - startU) });
    return { ranges, total };
  }

  /* ============================================================
   * Rendering
   * ============================================================ */
  function drawRawPoints(stroke) {
    if (!stroke?.rawPoints?.length) return;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1 * dpr;
    for (const p of stroke.rawPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (strokeWidthCssPx(p.p) / 2) * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawReducedPoints(stroke) {
    if (!stroke?.rdpPoints?.length) return;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = "#33c31e";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    stroke.rdpPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = "#33c31e";
    for (const p of stroke.rdpPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (strokeWidthCssPx(p.p) / 2) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function evalEffectiveWidthCssPxAt(spline, t01) {
    if (!spline?.controlPoints?.length || !spline?.knots?.length) return 1;
    const cps = spline.controlPoints.map((cp) => ({ x: 0, y: 0, p: getEffectiveWidthCssPxForCP(cp) }));
    const pt = deboorEval(clamp01(t01), spline.degree, cps, spline.knots);
    return Math.max(0.5, pt?.p ?? 1);
  }

  function parseSvgPolygon(polyStr) {
    const pointsMatch = polyStr.match(/points="([^"]+)"/);
    if (!pointsMatch) return null;
    const fillMatch = polyStr.match(/fill="([^"]+)"/);
    const fill = fillMatch ? fillMatch[1] : "rgba(0,0,0,1)";
    const pts = pointsMatch[1].trim().split(/\s+/).map((pair) => {
      const [xs, ys] = pair.split(",");
      const x = parseFloat(xs), y = parseFloat(ys);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }).filter(Boolean);
    if (pts.length < 3) return null;
    return { points: pts, fill };
  }

  function parsePathAnchors(d) {
    const anchors = [];
    if (!d || typeof d !== "string") return anchors;
    let i = 0;
    const n = d.length;
    let cmd = null;
    let currX = 0, currY = 0, subpathStartX = 0, subpathStartY = 0;
    const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
    const readNum = () => {
      skip();
      const m = d.slice(i).match(/^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/);
      if (!m) return null;
      i += m[0].length;
      skip();
      return parseFloat(m[0]);
    };
    while (i < n) {
      skip();
      if (i >= n) break;
      const ch = d[i];
      if (/[a-zA-Z]/.test(ch)) { cmd = ch; i++; }
      else if (cmd == null) break;
      const rel = cmd === cmd.toLowerCase();
      const push = (x, y) => { currX = x; currY = y; anchors.push({ x, y }); };
      switch (cmd) {
        case "M": case "m": {
          const x = readNum(), y = readNum();
          if (x == null || y == null) break;
          const nx = rel ? currX + x : x, ny = rel ? currY + y : y;
          subpathStartX = nx; subpathStartY = ny;
          push(nx, ny);
          while (true) {
            const ax = readNum(), ay = readNum();
            if (ax == null || ay == null) break;
            push(rel ? currX + ax : ax, rel ? currY + ay : ay);
          }
          break;
        }
        case "L": case "l": case "T": case "t": {
          while (true) {
            const x = readNum(), y = readNum();
            if (x == null || y == null) break;
            push(rel ? currX + x : x, rel ? currY + y : y);
          }
          break;
        }
        case "H": case "h": {
          while (true) {
            const x = readNum(); if (x == null) break;
            push(rel ? currX + x : x, currY);
          }
          break;
        }
        case "V": case "v": {
          while (true) {
            const y = readNum(); if (y == null) break;
            push(currX, rel ? currY + y : y);
          }
          break;
        }
        case "C": case "c": {
          while (true) {
            const x1 = readNum(), y1 = readNum(), x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
            if ([x1, y1, x2, y2, x, y].some((v) => v == null)) break;
            push(rel ? currX + x : x, rel ? currY + y : y);
          }
          break;
        }
        case "S": case "s": case "Q": case "q": {
          while (true) {
            const x1 = readNum(), y1 = readNum(), x = readNum(), y = readNum();
            if ([x1, y1, x, y].some((v) => v == null)) break;
            push(rel ? currX + x : x, rel ? currY + y : y);
          }
          break;
        }
        case "A": case "a": {
          while (true) {
            const rx = readNum(), ry = readNum(), rot = readNum(), laf = readNum(), sf = readNum(), x = readNum(), y = readNum();
            if ([rx, ry, rot, laf, sf, x, y].some((v) => v == null)) break;
            push(rel ? currX + x : x, rel ? currY + y : y);
          }
          break;
        }
        case "Z": case "z": {
          currX = subpathStartX; currY = subpathStartY;
          break;
        }
        default: i++; break;
      }
    }
    return anchors;
  }

  function renderDBSCPath(pathStr, fillStyle, lineWidth, dashed) {
    if (!pathStr) return;
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = lineWidth * dpr;
    if (dashed) ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.stroke(new Path2D(pathStr));
    ctx.restore();
  }

  function renderDBSCOutlineFilled(pathStr, rgba) {
    if (!pathStr) return;
    ctx.save();
    ctx.fillStyle = rgba;
    ctx.fill(new Path2D(pathStr));
    ctx.restore();
  }

  function renderDBSCMesh(mesh) {
    if (!Array.isArray(mesh) || !mesh.length) return;
    ctx.save();
    for (const poly of mesh) {
      const parsed = parseSvgPolygon(poly);
      if (!parsed) continue;
      ctx.beginPath();
      ctx.moveTo(parsed.points[0].x, parsed.points[0].y);
      for (let j = 1; j < parsed.points.length; j++) ctx.lineTo(parsed.points[j].x, parsed.points[j].y);
      ctx.closePath();
      ctx.fillStyle = parsed.fill;
      ctx.strokeStyle = parsed.fill;
      ctx.lineWidth = 0.5 * dpr;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderNormalsAt(bs, length = 16) {
    if (!bs || !bs.knots?.length) return;
    const startU = bs.knots[bs.degree];
    const endU = bs.knots[bs.controlDisks.length];
    if (!Number.isFinite(startU) || !Number.isFinite(endU)) return;
    const samples = 30;
    ctx.save();
    ctx.strokeStyle = "rgba(0,122,255,0.65)";
    ctx.lineWidth = 1 * dpr;
    for (let i = 0; i < samples; i++) {
      const t = startU + (i / (samples - 1)) * (endU - startU);
      const disk = bs.evaluateAt(t);
      const d = bs.evaluateDerivativeAt(t);
      const len = Math.hypot(d.x, d.y);
      if (len < 1e-6) continue;
      const nx = -d.y / len, ny = d.x / len;
      const L = length * dpr;
      ctx.beginPath();
      ctx.moveTo(disk.center.x - nx * L * 0.5, disk.center.y - ny * L * 0.5);
      ctx.lineTo(disk.center.x + nx * L * 0.5, disk.center.y + ny * L * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderCuspOverlay(bs, cusps) {
    if (!bs || !cusps?.ranges?.length) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,59,48,0.8)";
    ctx.lineWidth = 4 * dpr;
    ctx.lineCap = "round";
    for (const range of cusps.ranges) {
      const steps = Math.max(2, Math.ceil((range.end - range.start) * 40));
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = range.start + (i / steps) * (range.end - range.start);
        const pt = bs.evaluateAt(t).center;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderDBSCForStroke(stroke, isActive) {
    if (!stroke?.spline) return;
    const spline = stroke.spline;

    // Clear the DBSC log for this frame's DBSC instance (so the pane always reflects the latest build)
    if (state.verboseLog && isActive && ui.logDBSC) ui.logDBSC.value = "";

    const verbose = isActive && state.verboseLog;

    if (state.compare) {
      const methods = [
        { name: "simple", color: "rgba(136,136,136,0.45)" },
        { name: "analytical", color: "rgba(0,122,255,0.45)" },
        { name: "skinning", color: "rgba(255,59,48,0.45)" },
      ];
      for (const m of methods) {
        const bs = buildDBSC(spline, { debug: verbose });
        if (!bs) continue;
        try {
          const res = bs.render({ method: m.name, tessellate: false, tolerance: state.renderTol });
          renderDBSCPath(res.outlinePath, m.color, 1.5, false);
        } catch (_) {}
      }
      return;
    }

    const bs = buildDBSC(spline, { debug: verbose });
    if (!bs) return;

    let res = null;
    try {
      res = bs.render({
        method: state.method,
        tessellate: state.color,
        tolerance: state.renderTol,
      });
    } catch (_) { return; }

    if (state.curve) {
      if (state.color && res.mesh?.length) {
        renderDBSCMesh(res.mesh);
      } else {
        renderDBSCOutlineFilled(res.outlinePath, "rgba(0,0,0,0.18)");
      }
    }

    if (state.skeleton && res.skeletonPath) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,0,0,0.5)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.stroke(new Path2D(res.skeletonPath));
      ctx.restore();
    }

    if (state.normals) renderNormalsAt(bs);

    if (state.pathPoints && res.outlinePath) {
      ctx.save();
      ctx.fillStyle = "rgba(0,102,204,0.75)";
      const r = 1.5 * dpr;
      const anchors = parsePathAnchors(res.outlinePath);
      const step = Math.max(1, Math.floor(anchors.length / 150));
      for (let i = 0; i < anchors.length; i += step) {
        const a = anchors[i];
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.cusps) {
      const cusps = detectCuspRanges(bs);
      renderCuspOverlay(bs, cusps);
      if (isActive) {
        const badge = ui.cuspBadge;
        if (cusps.ranges.length > 0) {
          badge.textContent = `${cusps.ranges.length}`;
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      }
    } else if (isActive) {
      ui.cuspBadge.classList.add("hidden");
    }
  }

  function renderControlDisks(stroke) {
    if (!stroke?.spline?.controlPoints?.length) return;
    ctx.save();
    const centerDotR = 3.5 * dpr;
    const handleDotR = 3.5 * dpr;
    const labelPad = 6 * dpr;
    ctx.font = `${Math.max(10, Math.round(10 * dpr))}px Menlo, monospace`;
    ctx.textBaseline = "middle";

    stroke.spline.controlPoints.forEach((cp, i) => {
      const rpx = diskRadiusCssPxForCP(cp) * dpr;
      const cx = cp.x, cy = cp.y;
      const hx = cx + rpx, hy = cy;

      ctx.beginPath(); ctx.arc(cx, cy, rpx, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 59, 48, 0.25)"; ctx.lineWidth = 1 * dpr; ctx.stroke();

      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy);
      ctx.strokeStyle = "rgba(255, 59, 48, 0.35)"; ctx.stroke();

      // Center dot — colored if overridden
      const centerFill = cp.colorOverride
        ? `rgba(${Math.round(cp.colorOverride.r * 255)},${Math.round(cp.colorOverride.g * 255)},${Math.round(cp.colorOverride.b * 255)},1)`
        : "#ff3b30";
      ctx.beginPath(); ctx.arc(cx, cy, centerDotR, 0, Math.PI * 2);
      ctx.fillStyle = centerFill; ctx.fill();

      // Radius handle dot
      ctx.beginPath(); ctx.arc(hx, hy, handleDotR, 0, Math.PI * 2);
      ctx.fillStyle = "#007AFF"; ctx.fill();

      const radiusCss = rpx / dpr;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(`r=${radiusCss.toFixed(1)}`, hx + labelPad, hy);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillText(String(i), cx + labelPad, cy - 10 * dpr);
    });
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Committed strokes (finalized, rendered dimmed)
    for (const stroke of committed) {
      if (state.raw) drawRawPoints(stroke);
      if (state.reduced) drawReducedPoints(stroke);
      renderDBSCForStroke(stroke, false);
      if (state.disks) renderControlDisks(stroke);
    }

    // Active stroke
    if (active) {
      if (state.raw) drawRawPoints(active);
      if (state.reduced) drawReducedPoints(active);
      renderDBSCForStroke(active, true);
      if (state.disks) renderControlDisks(active);
    }
  }

  /* ============================================================
   * Hit testing
   * ============================================================ */
  function hitTestControlDiskHandle(pos) {
    if (!isCurveEditable()) return null;
    const centerHitRadius = 8 * dpr;
    const handleHitRadius = 8 * dpr;
    let closest = null;
    let closestDist = Infinity;
    const cps = active.spline.controlPoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const dC = Math.hypot(pos.x - cp.x, pos.y - cp.y);
      if (dC <= centerHitRadius && dC < closestDist) { closest = { type: "center", index: i }; closestDist = dC; }
      const rPx = diskRadiusCssPxForCP(cp) * dpr;
      const dH = Math.hypot(pos.x - (cp.x + rPx), pos.y - cp.y);
      if (dH <= handleHitRadius && dH < closestDist) { closest = { type: "radius", index: i }; closestDist = dH; }
    }
    return closest;
  }

  /* ============================================================
   * Pointer events
   * ============================================================ */
  function commitActiveIfAny() {
    if (active?.spline?.controlPoints?.length) committed.push(active);
    active = null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const pos = getC(e);

    // Close color popover on canvas click
    if (ui.cpPop.classList.contains("visible")) {
      const inside = (() => {
        const r = ui.cpPop.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      })();
      if (!inside) ui.cpPop.classList.remove("visible");
    }

    const hit = hitTestControlDiskHandle(pos);
    if (hit) {
      draggingPointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      if (hit.type === "center") {
        draggingCenterIndex = hit.index;
        draggingRadiusIndex = -1;
        canvas.style.cursor = "move";
        // A single click (no drag) on a center opens the color picker.
        // We detect that at pointerup when the pointer hasn't moved.
        draggingCenterIndex = hit.index;
      } else {
        draggingRadiusIndex = hit.index;
        draggingCenterIndex = -1;
        canvas.style.cursor = "ew-resize";
      }
      active._dragStartPos = pos;
      active._dragMoved = false;
      return;
    }

    // Start new active stroke
    commitActiveIfAny();
    active = { rawPoints: [], rdpPoints: [], spline: null };
    isDrawing = true;
    active.rawPoints.push(pos);
    canvas.setPointerCapture(e.pointerId);
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = getC(e);

    if (draggingCenterIndex >= 0 && active?.spline?.controlPoints?.[draggingCenterIndex]) {
      const cp = active.spline.controlPoints[draggingCenterIndex];
      cp.x = pos.x; cp.y = pos.y;
      if (active._dragStartPos) {
        const d = Math.hypot(pos.x - active._dragStartPos.x, pos.y - active._dragStartPos.y);
        if (d > 3 * dpr) active._dragMoved = true;
      }
      updatePanes();
      draw();
      return;
    }
    if (draggingRadiusIndex >= 0 && active?.spline?.controlPoints?.[draggingRadiusIndex]) {
      const cp = active.spline.controlPoints[draggingRadiusIndex];
      const dx = pos.x - cp.x, dy = pos.y - cp.y;
      const radiusPx = Math.max(0.5 * dpr, Math.hypot(dx, dy));
      const radiusCss = radiusPx / dpr;
      cp.widthOverrideCssPx = Math.max(0.5, radiusCss * 2);
      updatePanes();
      draw();
      return;
    }

    if (!isDrawing && isCurveEditable()) {
      const hit = hitTestControlDiskHandle(pos);
      if (hit?.type === "center") canvas.style.cursor = "move";
      else if (hit?.type === "radius") canvas.style.cursor = "ew-resize";
      else canvas.style.cursor = "crosshair";
    }

    if (!isDrawing) return;
    if (e.getCoalescedEvents) e.getCoalescedEvents().forEach((ev) => active.rawPoints.push(getC(ev)));
    else active.rawPoints.push(pos);
    draw();
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerId === draggingPointerId && (draggingCenterIndex >= 0 || draggingRadiusIndex >= 0)) {
      const wasCenter = draggingCenterIndex;
      const moved = !!active?._dragMoved;
      draggingCenterIndex = -1;
      draggingRadiusIndex = -1;
      draggingPointerId = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      canvas.style.cursor = "crosshair";
      writeHash();
      if (!moved && wasCenter >= 0) openColorPicker(wasCenter, e.clientX, e.clientY);
      draw();
      return;
    }
    isDrawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    processActive();
    draw();
    updatePanes();
    writeHash();
  });

  /* ============================================================
   * Export / SVG preview
   * ============================================================ */
  function scaleSplineXY(s, scale) {
    if (!s) return s;
    if (!Number.isFinite(scale) || scale === 1) return s;
    return {
      ...s,
      controlPoints: s.controlPoints.map((cp) => ({ ...cp, x: cp.x * scale, y: cp.y * scale })),
    };
  }

  function getDBSCArrayFromSpline(s) {
    if (!s?.controlPoints?.length) return "";
    const cps = s.controlPoints;
    let minX = Infinity, minY = Infinity;
    for (const cp of cps) {
      if (cp.x < minX) minX = cp.x;
      if (cp.y < minY) minY = cp.y;
    }
    const offsetX = 10 - minX;
    const offsetY = 10 - minY;
    return cps.map((cp) => {
      const w = getEffectiveWidthCssPxForCP(cp);
      const x = cp.x + offsetX, y = cp.y + offsetY;
      const hex = cp.colorOverride ? rgba01ToHex(cp.colorOverride) : "";
      return `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(2)}${hex ? "," + hex : ""}`;
    }).join("\n");
  }

  function buildExportText() {
    if (!active?.spline) return "";
    const s = scaleSplineXY(active.spline, 1 / dpr);
    let out = "";
    out += `--- SVG PATH ---\n<path d="${getSVGPath(s)}" fill="none" stroke="rgba(255,0,0,0.25)" stroke-width="2" />\n\n`;
    out += `--- DBSC ARRAY ---\n${getDBSCArrayFromSpline(s)}`;
    if (state.closed) out += "\nz";

    if (isDiskBSplineAvailable()) {
      try {
        const disks = s.controlPoints.map((cp, i) => {
          const widthCss = getEffectiveWidthCssPxForCP(cp);
          let color;
          if (cp.colorOverride) color = cp.colorOverride;
          else if (state.color) color = paletteColorForIndex(i);
          else color = { r: 0, g: 0, b: 0, a: 1 };
          return { center: { x: cp.x, y: cp.y }, radius: Math.max(0, widthCss / 2), color };
        });
        const bs = new window.DiskBSpline(disks, { degree: state.degree, closed: state.closed, debug: false });
        const res = bs.render({
          method: state.method,
          tessellate: state.color,
          tolerance: state.renderTol,
        });
        const inner = state.color
          ? `<g>${res.mesh.join("")}</g><path d="${res.outlinePath}" fill="none" />`
          : `<path d="${res.outlinePath}" fill="black" opacity="0.85" stroke="none" />`;
        out += `\n\n--- DBSC SVG (${state.method}${state.color ? ", colored" : ""}${state.closed ? ", closed" : ""}) ---\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${window.innerWidth} ${window.innerHeight}">\n${inner}\n</svg>`;
      } catch (_) {}
    }
    return out;
  }

  function buildFullSvgMarkup(forDownload = false) {
    const strokes = [...committed];
    if (active) strokes.push(active);
    if (!strokes.length) return "";

    // Compute combined bounding box in CSS px
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) {
      const cps = s.spline?.controlPoints || [];
      for (const cp of cps) {
        const r = getEffectiveWidthCssPxForCP(cp) / 2;
        const cx = cp.x / dpr, cy = cp.y / dpr;
        if (cx - r < minX) minX = cx - r;
        if (cy - r < minY) minY = cy - r;
        if (cx + r > maxX) maxX = cx + r;
        if (cy + r > maxY) maxY = cy + r;
      }
    }
    if (!Number.isFinite(minX)) return "";
    const pad = 10;
    const vbX = Math.floor(minX - pad);
    const vbY = Math.floor(minY - pad);
    const vbW = Math.ceil((maxX - minX) + pad * 2);
    const vbH = Math.ceil((maxY - minY) + pad * 2);

    let body = "";
    for (const s of strokes) {
      const scaled = scaleSplineXY(s.spline, 1 / dpr);
      if (!scaled) continue;
      const disks = scaled.controlPoints.map((cp, i) => {
        const widthCss = getEffectiveWidthCssPxForCP(cp);
        let color;
        if (cp.colorOverride) color = cp.colorOverride;
        else if (state.color) color = paletteColorForIndex(i);
        else color = { r: 0, g: 0, b: 0, a: 1 };
        return { center: { x: cp.x, y: cp.y }, radius: Math.max(0, widthCss / 2), color };
      });
      if (disks.length < state.degree + 1) continue;
      try {
        const bs = new window.DiskBSpline(disks, { degree: state.degree, closed: state.closed, debug: false });
        const res = bs.render({ method: state.method, tessellate: state.color, tolerance: state.renderTol });
        if (state.color && res.mesh?.length) {
          body += `<g>${res.mesh.join("")}</g>`;
          body += `<path d="${res.outlinePath}" fill="none" stroke="black" stroke-width="0.5" opacity="0.3" />`;
        } else {
          body += `<path d="${res.outlinePath}" fill="black" />`;
        }
      } catch (_) {}
    }
    const bg = forDownload ? "" : `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="white" />`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">${bg}${body}</svg>`;
  }

  function updatePanes() {
    // Coord debug pane
    if (active?.spline && ui.paneDebug.classList.contains("visible")) {
      const fmt = typeof formatPointList === "function" ? formatPointList : null;
      let dbg = "";
      dbg += `--- RAW POINTS (${active.rawPoints.length}) ---\n`;
      dbg += fmt ? fmt(active.rawPoints) : "";
      dbg += `\n\n--- REDUCED POINTS (RDP) (${active.rdpPoints.length}) ---\n`;
      dbg += fmt ? fmt(active.rdpPoints) : "";
      dbg += `\n\n--- CONTROL POINTS (${active.spline.controlPoints.length}) ---\n`;
      dbg += fmt ? fmt(active.spline.controlPoints) : "";
      ui.logDebug.value = dbg + "\n";
    }
    // Export pane
    if (ui.paneExport.classList.contains("visible")) {
      ui.logExport.value = buildExportText();
    }
    // SVG preview pane
    if (ui.paneSvg.classList.contains("visible")) {
      const svg = buildFullSvgMarkup(false);
      ui.svgPreview.innerHTML = svg || "";
    }
  }

  /* ============================================================
   * Download SVG
   * ============================================================ */
  function downloadSvg() {
    const svg = buildFullSvgMarkup(true);
    if (!svg) { toast("Nothing to download"); return; }
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `dbsc-stroke-${ts}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast("Downloaded");
  }

  /* ============================================================
   * URL hash state
   * ============================================================ */
  function encodeHash() {
    const flat = {
      st: {
        r: state.raw ? 1 : 0,
        d: state.reduced ? 1 : 0,
        c: state.curve ? 1 : 0,
        sk: state.skeleton ? 1 : 0,
        nm: state.normals ? 1 : 0,
        dk: state.disks ? 1 : 0,
        cu: state.cusps ? 1 : 0,
        m: state.method,
        cp: state.compare ? 1 : 0,
        cl: state.closed ? 1 : 0,
        cc: state.color ? 1 : 0,
        pp: state.pathPoints ? 1 : 0,
        dg: state.degree,
        rt: state.renderTol,
        e: state.eps, pw: state.pWeight, mw: state.maxW, f: state.fit,
        ps: state.psim,
      },
    };
    // Persist active DBSC array if it fits
    if (active?.spline) {
      const s = scaleSplineXY(active.spline, 1 / dpr);
      const csv = getDBSCArrayFromSpline(s);
      if (csv.length < 1500) flat.dbsc = csv;
      if (state.closed) flat.cl = 1;
    }
    try {
      return encodeURIComponent(JSON.stringify(flat));
    } catch (_) { return ""; }
  }

  let hashTimer = null;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const h = encodeHash();
      if (h) location.hash = h;
    }, 200);
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    let obj;
    try { obj = JSON.parse(decodeURIComponent(raw)); } catch (_) { return; }
    if (obj?.st) {
      const s = obj.st;
      state.raw = !!s.r;
      state.reduced = !!s.d;
      state.curve = !!s.c;
      state.skeleton = !!s.sk;
      state.normals = !!s.nm;
      state.disks = !!s.dk;
      state.cusps = !!s.cu;
      if (s.m) state.method = s.m;
      state.compare = !!s.cp;
      state.closed = !!s.cl;
      state.color = !!s.cc;
      state.pathPoints = !!s.pp;
      if (Number.isFinite(s.dg)) state.degree = s.dg;
      if (Number.isFinite(s.rt)) state.renderTol = s.rt;
      if (Number.isFinite(s.e)) state.eps = s.e;
      if (Number.isFinite(s.pw)) state.pWeight = s.pw;
      if (Number.isFinite(s.mw)) state.maxW = s.mw;
      if (Number.isFinite(s.f)) state.fit = s.f;
      if (s.ps) state.psim = s.ps;
      reflectStateToUI();
    }
    if (obj?.dbsc) {
      ui.logExport.value = `--- DBSC ARRAY ---\n${obj.dbsc}`;
      loadFromExport();
    } else {
      draw();
      updatePanes();
    }
  }

  function reflectStateToUI() {
    ui.togRaw.classList.toggle("active", state.raw);
    ui.togReduced.classList.toggle("active", state.reduced);
    ui.togCurve.classList.toggle("active", state.curve);
    ui.togSkel.classList.toggle("active", state.skeleton);
    ui.togNorm.classList.toggle("active", state.normals);
    ui.togDisks.classList.toggle("active", state.disks);
    ui.togCusps.classList.toggle("active", state.cusps);
    ui.chkCompare.checked = state.compare;
    ui.chkClosed.checked = state.closed;
    ui.chkColor.checked = state.color;
    ui.chkPathPoints.checked = state.pathPoints;
    ui.methodLegend.style.display = state.compare ? "flex" : "none";
    document.querySelectorAll('input[name="method"]').forEach((el) => { el.checked = el.value === state.method; });
    document.querySelectorAll('input[name="degree"]').forEach((el) => { el.checked = parseInt(el.value, 10) === state.degree; });
    document.querySelectorAll('input[name="psim"]').forEach((el) => { el.checked = el.value === state.psim; });
    ui.eps.value = state.eps; ui.dEps.textContent = state.eps + " px";
    ui.p.value = state.pWeight; ui.dP.textContent = String(state.pWeight);
    ui.maxW.value = state.maxW; ui.dMaxW.textContent = state.maxW + " px";
    ui.fit.value = state.fit; ui.dFit.textContent = state.fit + " px";
    ui.tol.value = state.renderTol; ui.dTol.textContent = state.renderTol + " px";
  }

  /* ============================================================
   * Color picker popover
   * ============================================================ */
  function openColorPicker(cpIndex, clientX, clientY) {
    if (!active?.spline?.controlPoints?.[cpIndex]) return;
    colorPickIndex = cpIndex;
    const cp = active.spline.controlPoints[cpIndex];
    ui.cpTitle.textContent = `Disk ${cpIndex} color`;
    ui.cpInput.value = cp.colorOverride ? rgba01ToHex(cp.colorOverride) : "#000000";
    ui.cpAll.checked = false;
    ui.cpPop.style.left = `${Math.min(window.innerWidth - 200, clientX + 10)}px`;
    ui.cpPop.style.top = `${Math.min(window.innerHeight - 120, clientY + 10)}px`;
    ui.cpPop.classList.add("visible");
  }
  function applyColorPicker() {
    if (!active?.spline?.controlPoints?.length) return;
    const rgba = hexToRGBA01(ui.cpInput.value);
    if (ui.cpAll.checked) {
      active.spline.controlPoints.forEach((cp) => { cp.colorOverride = { ...rgba }; });
    } else if (colorPickIndex >= 0) {
      active.spline.controlPoints[colorPickIndex].colorOverride = rgba;
    }
    ui.cpPop.classList.remove("visible");
    draw(); updatePanes(); writeHash();
  }
  function resetColorPicker() {
    if (!active?.spline?.controlPoints?.length) return;
    if (ui.cpAll.checked) {
      active.spline.controlPoints.forEach((cp) => { delete cp.colorOverride; });
    } else if (colorPickIndex >= 0) {
      delete active.spline.controlPoints[colorPickIndex].colorOverride;
    }
    ui.cpPop.classList.remove("visible");
    draw(); updatePanes(); writeHash();
  }

  /* ============================================================
   * Event wiring
   * ============================================================ */
  // Pane visibility checkboxes
  ui.chkDebug.onchange = () => { ui.paneDebug.classList.toggle("visible", ui.chkDebug.checked); updatePanes(); };
  ui.chkExport.onchange = () => { ui.paneExport.classList.toggle("visible", ui.chkExport.checked); updatePanes(); };
  ui.chkLog.onchange = () => { ui.paneLog.classList.toggle("visible", ui.chkLog.checked); };
  ui.chkSvg.onchange = () => { ui.paneSvg.classList.toggle("visible", ui.chkSvg.checked); updatePanes(); };
  ui.chkVerbose.onchange = () => { state.verboseLog = !!ui.chkVerbose.checked; draw(); };

  // Visibility toggle buttons
  const wireToggle = (btn, key) => {
    btn.onclick = () => {
      state[key] = !state[key];
      btn.classList.toggle("active", state[key]);
      draw(); writeHash();
    };
  };
  wireToggle(ui.togRaw, "raw");
  wireToggle(ui.togReduced, "reduced");
  wireToggle(ui.togCurve, "curve");
  wireToggle(ui.togSkel, "skeleton");
  wireToggle(ui.togNorm, "normals");
  wireToggle(ui.togDisks, "disks");
  wireToggle(ui.togCusps, "cusps");

  // Renderer
  document.querySelectorAll('input[name="method"]').forEach((el) => {
    el.onchange = () => {
      if (el.checked) { state.method = el.value; draw(); updatePanes(); writeHash(); }
    };
  });
  ui.chkCompare.onchange = () => {
    state.compare = !!ui.chkCompare.checked;
    ui.methodLegend.style.display = state.compare ? "flex" : "none";
    draw(); updatePanes(); writeHash();
  };
  ui.chkClosed.onchange = () => { state.closed = !!ui.chkClosed.checked; draw(); updatePanes(); writeHash(); };
  ui.chkColor.onchange = () => { state.color = !!ui.chkColor.checked; draw(); updatePanes(); writeHash(); };
  ui.chkPathPoints.onchange = () => { state.pathPoints = !!ui.chkPathPoints.checked; draw(); writeHash(); };

  // Degree
  document.querySelectorAll('input[name="degree"]').forEach((el) => {
    el.onchange = () => {
      if (el.checked) {
        state.degree = parseInt(el.value, 10) || 3;
        processActive();
        draw(); updatePanes(); writeHash();
      }
    };
  });
  // Render tolerance
  ui.tol.oninput = () => {
    state.renderTol = parseFloat(ui.tol.value) || 0.5;
    ui.dTol.textContent = ui.tol.value + " px";
    draw(); updatePanes(); writeHash();
  };

  // Fit params
  ui.eps.oninput = () => { state.eps = parseFloat(ui.eps.value); ui.dEps.textContent = ui.eps.value + " px"; processActive(); draw(); updatePanes(); writeHash(); };
  ui.p.oninput = () => { state.pWeight = parseFloat(ui.p.value); ui.dP.textContent = ui.p.value; processActive(); draw(); updatePanes(); writeHash(); };
  ui.maxW.oninput = () => { state.maxW = parseFloat(ui.maxW.value); ui.dMaxW.textContent = ui.maxW.value + " px"; draw(); updatePanes(); writeHash(); };
  ui.fit.oninput = () => { state.fit = parseFloat(ui.fit.value); ui.dFit.textContent = ui.fit.value + " px"; processActive(); draw(); updatePanes(); writeHash(); };

  // Pressure sim
  document.querySelectorAll('input[name="psim"]').forEach((el) => {
    el.onchange = () => {
      if (el.checked) { state.psim = el.value; processActive(); draw(); updatePanes(); writeHash(); }
    };
  });

  // Buttons
  ui.btnClear.onclick = () => {
    committed.length = 0;
    active = null;
    ui.logDebug.value = "";
    ui.logExport.value = "";
    if (ui.logDBSC) ui.logDBSC.value = "";
    ui.svgPreview.innerHTML = "";
    ui.cuspBadge.classList.add("hidden");
    ui.dCp.textContent = "-";
    draw(); writeHash();
  };
  ui.btnDeleteLast.onclick = () => {
    if (active) { active = null; }
    else if (committed.length) committed.pop();
    draw(); updatePanes(); writeHash();
  };
  ui.btnDownload.onclick = downloadSvg;
  ui.btnLoad.onclick = loadFromExport;

  // Presets
  ui.presetSelect.onchange = () => {
    applyPreset(ui.presetSelect.value);
    ui.presetSelect.value = "";
  };

  // Color picker
  ui.cpApply.onclick = applyColorPicker;
  ui.cpReset.onclick = resetColorPicker;
  ui.cpClose.onclick = () => ui.cpPop.classList.remove("visible");

  // Copy buttons
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.onclick = () => {
      const target = btn.getAttribute("data-copy-target");
      const el = document.getElementById(target);
      if (el) copyText(el.value || el.textContent || "");
    };
  });

  // Initial readouts + state reflection
  reflectStateToUI();
  resize();
  readHash();
})();
