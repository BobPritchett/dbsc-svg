/**
 * DBSCInk — a small, reusable API surface for pen input → Disk B-Spline strokes → SVG.
 *
 * Pipeline:
 *
 *   raw pointer samples             finished DBSC data              rendered output
 *   [{x, y, p}]          ──fit──►   { degree, closed, color,  ──►  SVG path "d" /
 *   (pressure 0..1)                   disks: [{x, y, r}] }          <svg> markup
 *
 * The middle representation ("stroke") is a plain JSON-serializable object meant
 * for storage in an editor document. It is self-contained: pressure has already
 * been resolved to disk radii, so rendering never needs the original fit params.
 *
 * API:
 *   DBSCInk.fitStroke(rawPoints, options)  -> { stroke, analysis } | null
 *   DBSCInk.renderStroke(stroke, ropts)    -> { d, skeletonD, circles, bs } | null
 *   DBSCInk.toDiskBSpline(stroke)          -> DiskBSpline | null
 *   DBSCInk.strokeBounds(stroke)           -> { minX, minY, maxX, maxY } | null
 *   DBSCInk.strokesToSVG(strokes, opts)    -> "<svg …>…</svg>"
 *   DBSCInk.serialize(strokes)             -> JSON string ({ type:"dbsc-ink", … })
 *   DBSCInk.deserialize(text)              -> stroke[]
 *
 * Depends on ../index.js (DiskBSpline) and ./pen-input-utils.js (PenInputUtils).
 */
(function (global) {
  "use strict";

  const utils = global.PenInputUtils;
  if (!utils) {
    throw new Error("DBSCInk requires pen-input-utils.js to be loaded first");
  }

  const DEFAULTS = Object.freeze({
    degree: 3,          // B-spline degree
    closed: false,      // closed (looped) stroke
    rdpTolerance: 2.0,  // px — RDP simplification threshold in (x, y, p·weight) space
    pressureWeight: 1000, // scale applied to pressure in the RDP metric
    minWidth: 0.1,      // px — stroke width at pressure 0
    maxWidth: 30,       // px — stroke width at pressure 1
    fitTolerance: 2.0,  // px — max allowed centerline deviation of the spline fit
    maxControlDisks: 50,
    color: "#1d4ed8",   // solid tint used when rendering the stroke
  });

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function pressureToWidth(p, opts = DEFAULTS) {
    const minW = Math.max(0, opts.minWidth ?? DEFAULTS.minWidth);
    const maxW = Math.max(minW, opts.maxWidth ?? DEFAULTS.maxWidth);
    return minW + clamp01(p) * (maxW - minW);
  }

  function hexToRGBA01(hex, a = 1) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return { r: 0, g: 0, b: 0, a };
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a,
    };
  }

  /** Drop invalid/duplicate samples; default missing pressure to 0.5 (mouse). */
  function normalizePoints(rawPoints) {
    const out = [];
    for (const pt of rawPoints || []) {
      if (!Number.isFinite(pt?.x) || !Number.isFinite(pt?.y)) continue;
      const p = Number.isFinite(pt.p) ? clamp01(pt.p) : 0.5;
      const prev = out[out.length - 1];
      if (prev && prev.x === pt.x && prev.y === pt.y) continue;
      out.push({ x: pt.x, y: pt.y, p });
    }
    return out;
  }

  /** Resample a short (x,y,p) polyline to exactly `count` points by arc length. */
  function resamplePolyline(points, count) {
    if (points.length >= count) return points.slice();
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    const total = cum[cum.length - 1];
    if (total <= 0) {
      return Array.from({ length: count }, () => ({ ...points[0] }));
    }
    const out = [];
    let seg = 0;
    for (let i = 0; i < count; i++) {
      const target = (i / (count - 1)) * total;
      while (seg < points.length - 2 && cum[seg + 1] < target) seg++;
      const span = cum[seg + 1] - cum[seg];
      const f = span > 0 ? (target - cum[seg]) / span : 0;
      const a = points[seg], b = points[seg + 1];
      out.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        p: a.p + (b.p - a.p) * f,
      });
    }
    return out;
  }

  /**
   * Find the smallest control-point count whose fit error is within tolerance.
   * Grows the candidate count geometrically, then binary-refines between the
   * last failing and first passing counts — far fewer fits than a linear sweep.
   */
  function fitSplineAdaptive(points, opts) {
    const degree = opts.degree;
    const minCP = degree + 1;
    const maxCP = Math.max(minCP, Math.min(opts.maxControlDisks, points.length));
    const tol = Math.max(0.1, opts.fitTolerance);

    const tryFit = (cpCount) => {
      const s = utils.fitBSpline(points, cpCount, degree);
      if (s) s._err = utils.computeMaxDistanceErrorXY(s, points, s.params);
      return s;
    };

    let best = null;      // lowest-error fit seen (fallback if nothing passes)
    let lastFail = minCP - 1;
    let pass = null;
    let passCP = 0;

    let cp = minCP;
    for (;;) {
      const s = tryFit(cp);
      if (s && (!best || s._err < best._err)) best = s;
      if (s && s._err <= tol) { pass = s; passCP = cp; break; }
      lastFail = cp;
      if (cp >= maxCP) break;
      cp = Math.min(maxCP, Math.max(cp + 1, Math.round(cp * 1.5)));
    }

    if (pass) {
      let lo = lastFail + 1, hi = passCP;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const s = tryFit(mid);
        if (s && s._err <= tol) { pass = s; hi = mid; }
        else lo = mid + 1;
      }
      return pass;
    }
    return best;
  }

  function makeStroke(disks, opts) {
    return {
      version: 1,
      degree: opts.degree ?? DEFAULTS.degree,
      closed: !!opts.closed,
      color: opts.color || DEFAULTS.color,
      disks,
    };
  }

  /**
   * Turn raw pointer samples into finished DBSC stroke data.
   *
   * Returns { stroke, analysis } where `stroke` is the storable document object
   * and `analysis` holds intermediate data useful for debugging/visualization
   * (raw points, RDP-reduced points, achieved fit error). Returns null when the
   * input contains no usable points.
   */
  function fitStroke(rawPoints, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const pts = normalizePoints(rawPoints);
    if (!pts.length) return null;

    // A tap produces a single dot stroke.
    if (pts.length === 1) {
      const r = pressureToWidth(pts[0].p, opts) / 2;
      return {
        stroke: makeStroke([{ x: pts[0].x, y: pts[0].y, r }], opts),
        analysis: { rawPoints: pts, reducedPoints: pts.slice(), fitError: 0 },
      };
    }

    const reduced = utils.simplifyRDP3D(pts, opts.rdpTolerance, opts.pressureWeight);

    let disks;
    let fitError = 0;
    const spline = reduced.length > opts.degree + 1 ? fitSplineAdaptive(reduced, opts) : null;
    if (spline) {
      disks = spline.controlPoints.map((cp) => ({
        x: cp.x,
        y: cp.y,
        r: pressureToWidth(cp.p, opts) / 2,
      }));
      fitError = spline._err ?? 0;
    } else {
      // Too short for a degree-N least-squares fit: use the reduced points
      // directly, resampled up to degree+1 so DiskBSpline can evaluate them.
      const padded = resamplePolyline(reduced, opts.degree + 1);
      disks = padded.map((p) => ({ x: p.x, y: p.y, r: pressureToWidth(p.p, opts) / 2 }));
    }

    return {
      stroke: makeStroke(disks, opts),
      analysis: {
        rawPoints: pts,
        reducedPoints: reduced,
        fitError,
        usedLeastSquares: !!spline,
      },
    };
  }

  /** Build a DiskBSpline instance from stroke data (or null if not possible). */
  function toDiskBSpline(stroke, extra = {}) {
    const DiskBSpline = global.DiskBSpline;
    if (typeof DiskBSpline !== "function") return null;
    if (!stroke || !Array.isArray(stroke.disks) || stroke.disks.length < 2) return null;

    // Clamp degree so short strokes still render (a 3-disk stroke renders as degree 2).
    const wanted = stroke.degree ?? 3;
    const degree = Math.max(1, Math.min(wanted, stroke.disks.length - 1));
    const color = hexToRGBA01(stroke.color || "#000000");
    const controlDisks = stroke.disks.map((d) => ({
      center: { x: d.x, y: d.y },
      radius: Math.max(0, d.r),
      color,
    }));
    return new DiskBSpline(controlDisks, {
      degree,
      closed: !!stroke.closed && stroke.disks.length > degree,
      debug: !!extra.debug,
    });
  }

  function circlePathD(x, y, r) {
    return `M ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} Z`;
  }

  /**
   * Render stroke data to SVG path data.
   * ropts: { method: "simple"|"analytical"|"skinning", tolerance: px }
   * Returns { d, skeletonD, circles, bs } — `bs` is the DiskBSpline instance so
   * callers can derive extra debug data (normals, envelope, cusps) without
   * rebuilding the spline. Coordinates are in the same space as the disks.
   */
  function renderStroke(stroke, ropts = {}) {
    if (!stroke || !Array.isArray(stroke.disks) || !stroke.disks.length) return null;

    if (stroke.disks.length === 1) {
      const d0 = stroke.disks[0];
      const r = Math.max(0.25, d0.r);
      return {
        d: circlePathD(d0.x, d0.y, r),
        skeletonD: "",
        circles: [{ t: 0, center: { x: d0.x, y: d0.y }, radius: r }],
        bs: null,
      };
    }

    const bs = toDiskBSpline(stroke);
    if (!bs) return null;
    const res = bs.render({
      method: ropts.method || "analytical",
      tessellate: false,
      tolerance: ropts.tolerance ?? 0.5,
    });
    return { d: res.outlinePath, skeletonD: res.skeletonPath, circles: res.circles, bs };
  }

  /** Conservative bounds from the control disks (centers ± radius). */
  function strokeBounds(stroke) {
    if (!stroke?.disks?.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of stroke.disks) {
      minX = Math.min(minX, d.x - d.r);
      minY = Math.min(minY, d.y - d.r);
      maxX = Math.max(maxX, d.x + d.r);
      maxY = Math.max(maxY, d.y + d.r);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Round path-data numbers so exported SVG stays compact. */
  function roundPathD(d, decimals = 2) {
    return String(d || "").replace(/-?\d+\.\d+(?:e-?\d+)?/gi, (m) => {
      const v = parseFloat(m);
      return Number.isFinite(v) ? String(+v.toFixed(decimals)) : m;
    });
  }

  /**
   * Render one or more strokes as a standalone SVG document (solid tint fills).
   * opts: { method, tolerance, padding=10, background=null, decimals=2 }
   */
  function strokesToSVG(strokes, opts = {}) {
    const list = (Array.isArray(strokes) ? strokes : [strokes]).filter(Boolean);
    if (!list.length) return "";

    const pad = opts.padding ?? 10;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of list) {
      const b = strokeBounds(s);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return "";

    const vbX = Math.floor(minX - pad);
    const vbY = Math.floor(minY - pad);
    const vbW = Math.ceil(maxX - minX + pad * 2);
    const vbH = Math.ceil(maxY - minY + pad * 2);

    let body = "";
    if (opts.background) {
      body += `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${opts.background}"/>`;
    }
    for (const s of list) {
      const r = renderStroke(s, opts);
      if (!r) continue;
      body += `<path d="${roundPathD(r.d, opts.decimals ?? 2)}" fill="${s.color || "#000"}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">${body}</svg>`;
  }

  /** Serialize strokes to a JSON document string. */
  function serialize(strokes) {
    const round = (v) => Math.round(v * 100) / 100;
    const doc = {
      type: "dbsc-ink",
      version: 1,
      strokes: (Array.isArray(strokes) ? strokes : [strokes]).filter(Boolean).map((s) => ({
        degree: s.degree ?? 3,
        closed: !!s.closed,
        color: s.color || "#000000",
        disks: (s.disks || []).map((d) => [round(d.x), round(d.y), round(d.r)]),
      })),
    };
    return JSON.stringify(doc, null, 1);
  }

  /** Parse a serialized document (or bare stroke array) back into stroke objects. */
  function deserialize(text) {
    let obj;
    try { obj = typeof text === "string" ? JSON.parse(text) : text; }
    catch (_) { return []; }
    const rawStrokes = Array.isArray(obj) ? obj : obj?.strokes;
    if (!Array.isArray(rawStrokes)) return [];
    const out = [];
    for (const s of rawStrokes) {
      const disksIn = s?.disks;
      if (!Array.isArray(disksIn)) continue;
      const disks = [];
      for (const d of disksIn) {
        const [x, y, r] = Array.isArray(d) ? d : [d?.x, d?.y, d?.r];
        if (![x, y, r].every(Number.isFinite) || r < 0) continue;
        disks.push({ x, y, r });
      }
      if (!disks.length) continue;
      out.push({
        version: 1,
        degree: Number.isFinite(s.degree) ? s.degree : 3,
        closed: !!s.closed,
        color: typeof s.color === "string" ? s.color : "#000000",
        disks,
      });
    }
    return out;
  }

  global.DBSCInk = {
    DEFAULTS,
    pressureToWidth,
    fitStroke,
    toDiskBSpline,
    renderStroke,
    strokeBounds,
    strokesToSVG,
    roundPathD,
    serialize,
    deserialize,
  };
})(typeof window !== "undefined" ? window : globalThis);
