/**
 * Ink editor — multi-stroke DBSC test harness.
 *
 * Demonstrates the DBSCInk pipeline end to end:
 *   pointer events → DBSCInk.fitStroke() → stroke data (stored per entry)
 *   stroke data    → DBSCInk.renderStroke() → cached Path2D, redrawn cheaply
 *   stroke data    → DBSCInk.serialize()/strokesToSVG() → JSON + SVG panes
 *
 * All model coordinates are CSS pixels; the canvas context is scaled by
 * devicePixelRatio at draw time, so stroke data round-trips 1:1 to SVG.
 */
(() => {
  "use strict";
  const Ink = window.DBSCInk;
  if (!Ink) throw new Error("Missing window.DBSCInk. Load dbsc-ink.js before ink-editor.js");

  /* ============================================================
   * DOM
   * ============================================================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const ui = {
    inkColor: $("ink-color"), chkClosed: $("chk-closed"),
    btnUndo: $("btn-undo"), btnRedo: $("btn-redo"), btnDelete: $("btn-delete"), btnClear: $("btn-clear"),
    btnDownload: $("btn-download"), btnCopySvg: $("btn-copy-svg"),
    togFill: $("tog-fill"), togRaw: $("tog-raw"), togReduced: $("tog-reduced"),
    togSkel: $("tog-skel"), togOutline: $("tog-outline"), togNorm: $("tog-norm"),
    togCusps: $("tog-cusps"), cuspBadge: $("cusp-badge"),
    dispRdp: $("disp-rdp"), dispPw: $("disp-pw"), dispW: $("disp-w"),
    dispFit: $("disp-fit"), dispTol: $("disp-tol"),
    paramRdp: $("param-rdp"), paramPw: $("param-pw"), paramMinW: $("param-minw"),
    paramMaxW: $("param-maxw"), paramFit: $("param-fit"), paramTol: $("param-tol"),
    btnRefit: $("btn-refit"), btnRefitAll: $("btn-refit-all"),
    chkPressure: $("chk-pressure"), chkJson: $("chk-json"), chkSvg: $("chk-svg"),
    panePressure: $("pane-pressure"), paneJson: $("pane-json"), paneSvg: $("pane-svg"),
    pressureGraph: $("pressure-graph"), jsonText: $("json-text"),
    btnJsonLoad: $("btn-json-load"), btnJsonCopy: $("btn-json-copy"),
    btnSvgCopy: $("btn-svg-copy"), svgPreview: $("svg-preview"),
    status: $("status"), toast: $("toast"),
  };

  /* ============================================================
   * State
   * ============================================================ */
  let dpr = window.devicePixelRatio || 1;
  let nextId = 1;

  // Each entry: { id, stroke, analysis|null, dirty, cache|null }
  // `stroke` is the storable DBSC data; `analysis` keeps raw/reduced points so
  // the stroke can be re-fit with different parameters; `cache` holds render output.
  const entries = [];
  let selectedId = null;

  let drawing = null; // { points: [{x,y,p}], downOn: entryId|null, moved: bool }
  let drag = null;    // { entry, index, type: "center"|"radius", moved: bool }
  let selDisk = null; // { entryId, index, type: "center"|"radius" } — keyboard-editable handle

  const view = {
    fill: true, raw: false, reduced: false, skeleton: false,
    outline: false, normals: false, cusps: false,
    handles: "selected", // selected | all | none
  };

  const fit = {
    rdpTolerance: 2.0, pressureWeight: 1000,
    minWidth: 0.1, maxWidth: 30, fitTolerance: 2.0, degree: 3,
  };

  const render = { method: "skinning", tolerance: 0.5 };

  /* ============================================================
   * Helpers
   * ============================================================ */
  const selected = () => entries.find((e) => e.id === selectedId) || null;

  function toast(msg, ms = 1400) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => ui.toast.classList.remove("visible"), ms);
  }

  function copyText(txt) {
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
      () => toast("Copied"),
      () => toast("Copy failed")
    );
  }

  function markAllDirty() { for (const e of entries) e.dirty = true; }

  /* ============================================================
   * Undo / redo
   *
   * Snapshot-based: each history state is a deep copy of the document
   * (strokes + fit analysis, not render caches). Interactive edits (handle
   * drags, arrow-key nudges, color scrubbing) open a "transaction" that
   * captures the pre-edit state once and commits a single undo step when the
   * gesture ends, so a drag or a burst of nudges undoes in one keystroke.
   * ============================================================ */
  const history = { undo: [], redo: [], limit: 100 };
  let txnSnap = null;       // pre-edit snapshot of an open transaction
  let nudgeTimer = null;    // commits an arrow-key burst after a pause

  function snapshot() {
    return entries.map((e) => ({
      id: e.id,
      stroke: structuredClone(e.stroke),
      analysis: e.analysis ? structuredClone(e.analysis) : null,
    }));
  }

  function beginTxn() {
    if (!txnSnap) txnSnap = snapshot();
  }

  function commitTxn() {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    if (!txnSnap) return;
    // Skip no-op transactions so undo never appears to "do nothing"
    if (JSON.stringify(txnSnap) === JSON.stringify(snapshot())) {
      txnSnap = null;
      updateHistoryUI();
      return;
    }
    history.undo.push(txnSnap);
    if (history.undo.length > history.limit) history.undo.shift();
    history.redo.length = 0;
    txnSnap = null;
    updateHistoryUI();
  }

  function abortTxn() {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    txnSnap = null;
  }

  function restore(snap) {
    entries.length = 0;
    for (const s of snap) {
      entries.push({
        id: s.id,
        stroke: structuredClone(s.stroke),
        analysis: s.analysis ? structuredClone(s.analysis) : null,
        dirty: true,
        cache: null,
      });
    }
    nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    if (!entries.some((e) => e.id === selectedId)) {
      selectedId = entries.length ? entries[entries.length - 1].id : null;
    }
    if (selDisk && !entries.some((e) => e.id === selDisk.entryId && e.stroke.disks.length > selDisk.index)) {
      selDisk = null;
    }
    draw();
    updatePanes();
    updateHistoryUI();
  }

  function undo() {
    commitTxn();
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    restore(history.undo.pop());
  }

  function redo() {
    commitTxn();
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    restore(history.redo.pop());
  }

  function updateHistoryUI() {
    ui.btnUndo.disabled = !history.undo.length && !txnSnap;
    ui.btnRedo.disabled = !history.redo.length;
  }

  function currentFitOptions() {
    return { ...fit, closed: ui.chkClosed.checked, color: ui.inkColor.value };
  }

  /* ============================================================
   * Canvas sizing / coordinates (model space = CSS px)
   * ============================================================ */
  let appliedSize = { w: 0, h: 0, dpr: 0 };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) { requestAnimationFrame(resize); return; } // not laid out yet
    appliedSize = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    draw();
  }
  window.addEventListener("resize", resize);

  /**
   * Re-sync if a window resize or zoom/devicePixelRatio change slipped past
   * the resize event (embedded webviews and browser zoom can do this).
   */
  function syncCanvasSize() {
    const d = window.devicePixelRatio || 1;
    if (appliedSize.w !== window.innerWidth || appliedSize.h !== window.innerHeight || appliedSize.dpr !== d) {
      resize();
    }
  }

  /**
   * Backing-store pixels per CSS pixel, measured from reality rather than a
   * cached devicePixelRatio. Model space is CSS px, so using this as the draw
   * transform keeps ink aligned with the cursor even if a resize/zoom event
   * was missed (worst case is temporary blur, never an offset).
   */
  function canvasScale() {
    const r = canvas.getBoundingClientRect();
    return r.width > 0 ? canvas.width / r.width : (window.devicePixelRatio || 1);
  }

  function eventPoint(e) {
    // Client coords and the element rect are both CSS px, so this mapping is
    // exact regardless of zoom or display scaling. Model space = CSS px.
    const r = canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      p: e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  /* ============================================================
   * Render cache
   * ============================================================ */
  function ensureCache(entry) {
    if (entry.cache && !entry.dirty) return entry.cache;
    const t0 = performance.now();
    const r = Ink.renderStroke(entry.stroke, render);
    entry.cache = r
      ? {
          d: r.d,
          skeletonD: r.skeletonD,
          circles: r.circles,
          bs: r.bs,
          path2d: new Path2D(r.d),
          skeleton2d: r.skeletonD ? new Path2D(r.skeletonD) : null,
          envelope: null, // lazy
          cusps: null,    // lazy
          renderMs: performance.now() - t0,
        }
      : null;
    entry.dirty = false;
    return entry.cache;
  }

  function envelopePoints(cache) {
    if (!cache || !cache.bs) return [];
    if (!cache.envelope) {
      cache.envelope = [];
      for (const c of cache.circles) {
        const env = cache.bs.evaluateEnvelopeAt(c.t ?? 0);
        cache.envelope.push(env.left, env.right);
      }
    }
    return cache.envelope;
  }

  function cuspRanges(cache, numSamples = 160) {
    if (!cache || !cache.bs) return [];
    if (cache.cusps) return cache.cusps;
    const bs = cache.bs;
    const startU = bs.knots[bs.degree];
    const endU = bs.knots[bs.controlDisks.length];
    const ranges = [];
    if (Number.isFinite(startU) && Number.isFinite(endU) && endU > startU) {
      let inCusp = false, startT = 0;
      for (let i = 0; i < numSamples; i++) {
        const t = startU + (i / (numSamples - 1)) * (endU - startU);
        const admissible = bs.isAdmissibleAt(t, false);
        if (!admissible && !inCusp) { inCusp = true; startT = t; }
        else if (admissible && inCusp) { ranges.push({ start: startT, end: t }); inCusp = false; }
      }
      if (inCusp) ranges.push({ start: startT, end: endU });
    }
    cache.cusps = ranges;
    return ranges;
  }

  /* ============================================================
   * Drawing
   * ============================================================ */
  function drawRawPoints(points, color = "rgba(0,0,0,0.15)") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, Ink.pressureToWidth(p.p, fit) / 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawReducedPoints(points) {
    ctx.strokeStyle = "rgba(51,195,30,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = "rgba(51,195,30,0.7)";
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHandles(entry) {
    const disks = entry.stroke.disks;
    ctx.font = "10px Menlo, monospace";
    ctx.textBaseline = "middle";
    disks.forEach((d, i) => {
      const r = Math.max(0.25, d.r);
      const sel = selDisk && selDisk.entryId === entry.id && selDisk.index === i ? selDisk.type : null;
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,59,48,0.3)"; ctx.lineWidth = 1; ctx.stroke();

      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + r, d.y);
      ctx.strokeStyle = "rgba(255,59,48,0.35)"; ctx.stroke();

      // Selection ring around the keyboard-editable handle
      if (sel) {
        const hx = sel === "center" ? d.x : d.x + r;
        ctx.beginPath(); ctx.arc(hx, d.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#ff9500"; ctx.lineWidth = 2; ctx.stroke();
        ctx.lineWidth = 1;
      }

      ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3b30"; ctx.fill();

      ctx.beginPath(); ctx.arc(d.x + r, d.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#007AFF"; ctx.fill();

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(`r=${r.toFixed(1)}`, d.x + r + 6, d.y);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillText(String(i), d.x + 5, d.y - 10);
    });
  }

  function drawNormals(cache) {
    const bs = cache.bs;
    if (!bs) return;
    const startU = bs.knots[bs.degree];
    const endU = bs.knots[bs.controlDisks.length];
    if (!Number.isFinite(startU) || !Number.isFinite(endU)) return;
    ctx.strokeStyle = "rgba(0,122,255,0.6)";
    ctx.lineWidth = 1;
    const samples = 28;
    for (let i = 0; i < samples; i++) {
      const t = startU + (i / (samples - 1)) * (endU - startU);
      const disk = bs.evaluateAt(t);
      const d = bs.evaluateDerivativeAt(t);
      const len = Math.hypot(d.x, d.y);
      if (len < 1e-6) continue;
      const nx = -d.y / len, ny = d.x / len;
      const L = Math.max(8, disk.radius);
      ctx.beginPath();
      ctx.moveTo(disk.center.x - nx * L, disk.center.y - ny * L);
      ctx.lineTo(disk.center.x + nx * L, disk.center.y + ny * L);
      ctx.stroke();
    }
  }

  function drawCusps(cache) {
    const ranges = cuspRanges(cache);
    if (!ranges.length || !cache.bs) return;
    ctx.strokeStyle = "rgba(255,59,48,0.85)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const range of ranges) {
      const steps = 12;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = range.start + (i / steps) * (range.end - range.start);
        const pt = cache.bs.evaluateAt(t).center;
        i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }

  function drawLivePreview() {
    if (!drawing || drawing.points.length < 1) return;
    const color = ui.inkColor.value;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = color;
    for (const p of drawing.points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, Ink.pressureToWidth(p.p, fit) / 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const s = canvasScale();
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, canvas.width / s, canvas.height / s);

    let selectedCusps = 0;
    for (const entry of entries) {
      const cache = ensureCache(entry);
      const isSel = entry.id === selectedId;

      if (view.fill && cache) {
        ctx.fillStyle = entry.stroke.color || "#000";
        ctx.fill(cache.path2d);
        if (isSel && entries.length > 1) {
          ctx.strokeStyle = "rgba(0,122,255,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke(cache.path2d);
        }
      }
      if (view.raw && entry.analysis) drawRawPoints(entry.analysis.rawPoints);
      if (view.reduced && entry.analysis) drawReducedPoints(entry.analysis.reducedPoints);
      if (view.skeleton && cache?.skeleton2d) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,0,0,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.stroke(cache.skeleton2d);
        ctx.restore();
      }
      if (view.outline && cache) {
        ctx.fillStyle = "rgba(0,102,204,0.75)";
        for (const pt of envelopePoints(cache)) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (view.normals && cache) drawNormals(cache);
      if (view.cusps && cache) {
        drawCusps(cache);
        if (isSel) selectedCusps = cuspRanges(cache).length;
      }
      if (handlesVisibleFor(entry)) drawHandles(entry);
    }

    drawLivePreview();

    if (view.cusps && selected()) {
      ui.cuspBadge.textContent = String(selectedCusps);
      ui.cuspBadge.classList.toggle("hidden", selectedCusps === 0);
    } else {
      ui.cuspBadge.classList.add("hidden");
    }
  }

  function handlesVisibleFor(entry) {
    if (view.handles === "none") return false;
    if (view.handles === "all") return true;
    return entry.id === selectedId;
  }

  /* ============================================================
   * Hit testing
   * ============================================================ */
  function hitTestHandles(pos) {
    const hitR = 8;
    let best = null, bestDist = Infinity;
    for (const entry of entries) {
      if (!handlesVisibleFor(entry)) continue;
      entry.stroke.disks.forEach((d, i) => {
        const dC = Math.hypot(pos.x - d.x, pos.y - d.y);
        if (dC <= hitR && dC < bestDist) { best = { entry, index: i, type: "center" }; bestDist = dC; }
        const dH = Math.hypot(pos.x - (d.x + Math.max(0.25, d.r)), pos.y - d.y);
        if (dH <= hitR && dH < bestDist) { best = { entry, index: i, type: "radius" }; bestDist = dH; }
      });
    }
    return best;
  }

  function hitTestBody(pos) {
    // isPointInPath: the point is in untransformed (backing px) space while
    // the path is mapped through the current transform, so scale the point.
    const s = canvasScale();
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (let i = entries.length - 1; i >= 0; i--) {
      const cache = ensureCache(entries[i]);
      if (cache && ctx.isPointInPath(cache.path2d, pos.x * s, pos.y * s)) return entries[i];
    }
    return null;
  }

  /* ============================================================
   * Pointer events
   * ============================================================ */
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    syncCanvasSize();
    const pos = eventPoint(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

    const handleHit = hitTestHandles(pos);
    if (handleHit) {
      selectedId = handleHit.entry.id;
      selDisk = { entryId: handleHit.entry.id, index: handleHit.index, type: handleHit.type };
      beginTxn(); // committed on pointerup only if the handle actually moved
      drag = { ...handleHit, moved: false, start: pos };
      canvas.style.cursor = handleHit.type === "center" ? "move" : "ew-resize";
      draw();
      return;
    }

    // Start a stroke. If the tap lands on an existing stroke and never moves,
    // pointerup treats it as a selection click instead of new ink.
    selDisk = null;
    const bodyHit = hitTestBody(pos);
    drawing = { points: [pos], downOn: bodyHit ? bodyHit.id : null, moved: false, start: pos };
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = eventPoint(e);

    if (drag) {
      const d = drag.entry.stroke.disks[drag.index];
      if (!d) return;
      if (drag.type === "center") { d.x = pos.x; d.y = pos.y; }
      else d.r = Math.max(0.05, Math.hypot(pos.x - d.x, pos.y - d.y));
      if (Math.hypot(pos.x - drag.start.x, pos.y - drag.start.y) > 2) drag.moved = true;
      drag.entry.dirty = true;
      draw();
      return;
    }

    if (drawing) {
      const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const pts = coalesced.length ? coalesced.map(eventPoint) : [pos];
      drawing.points.push(...pts);
      if (Math.hypot(pos.x - drawing.start.x, pos.y - drawing.start.y) > 3) drawing.moved = true;
      // Live input diagnostics: client → model mapping should track the cursor 1:1.
      ui.status.textContent =
        `input client(${Math.round(e.clientX)},${Math.round(e.clientY)}) → ` +
        `model(${Math.round(pos.x)},${Math.round(pos.y)})  ·  ` +
        `p=${pos.p.toFixed(2)}  ·  ${drawing.points.length} pts`;
      draw();
      return;
    }

    // Hover cursor feedback
    const hit = hitTestHandles(pos);
    canvas.style.cursor = hit ? (hit.type === "center" ? "move" : "ew-resize") : "crosshair";
  });

  function endPointer(e) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = "crosshair";

    if (drag) {
      // One undo step per completed drag; a click that never moved is only a
      // disk selection, not an edit.
      if (drag.moved) commitTxn();
      else abortTxn();
      drag = null;
      draw();
      updatePanes();
      return;
    }
    if (!drawing) return;

    const { points, downOn, moved } = drawing;
    drawing = null;

    // Tap on an existing stroke = select it.
    if (!moved && downOn != null) {
      selectedId = downOn;
      selDisk = null;
      draw();
      updatePanes();
      return;
    }

    const fitted = Ink.fitStroke(points, currentFitOptions());
    if (fitted) {
      // One undo step per committed stroke (snapshot taken before the push)
      withHistory(() => {
        const entry = { id: nextId++, ...fitted, dirty: true, cache: null };
        entries.push(entry);
        selectedId = entry.id;
      });
    }
    draw();
    updatePanes();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  /* ============================================================
   * Refit / stroke ops
   * ============================================================ */
  function refitEntry(entry) {
    if (!entry?.analysis?.rawPoints?.length) return false;
    const fitted = Ink.fitStroke(entry.analysis.rawPoints, {
      ...fit,
      closed: entry.stroke.closed,
      color: entry.stroke.color,
    });
    if (!fitted) return false;
    entry.stroke = fitted.stroke;
    entry.analysis = fitted.analysis;
    entry.dirty = true;
    // The disk list was rebuilt; drop a now-invalid disk selection
    if (selDisk?.entryId === entry.id && selDisk.index >= entry.stroke.disks.length) selDisk = null;
    return true;
  }

  function refitSelectedLive() {
    const e = selected();
    if (e && refitEntry(e)) { draw(); updatePanes(); return true; }
    return false;
  }

  /** Run an atomic edit as a single undo step (no-op edits leave no step). */
  function withHistory(fn) {
    commitTxn(); // close any open gesture first
    beginTxn();
    fn();
    commitTxn();
  }

  function deleteSelectedStroke() {
    const idx = entries.findIndex((e) => e.id === selectedId);
    if (idx < 0) return;
    withHistory(() => {
      entries.splice(idx, 1);
      selectedId = entries.length ? entries[entries.length - 1].id : null;
      selDisk = null;
    });
    draw();
    updatePanes();
  }

  function deleteSelectedDisk() {
    const e = selDisk ? entries.find((x) => x.id === selDisk.entryId) : null;
    if (!e || !e.stroke.disks[selDisk.index]) return;
    withHistory(() => {
      e.stroke.disks.splice(selDisk.index, 1);
      if (e.stroke.disks.length < 2) {
        // Not enough disks left to be a stroke
        entries.splice(entries.indexOf(e), 1);
        if (selectedId === e.id) selectedId = entries.length ? entries[entries.length - 1].id : null;
      } else {
        e.dirty = true;
      }
      selDisk = null;
    });
    draw();
    updatePanes();
  }

  /** Arrow-key nudge of the selected handle. A burst commits as one undo step. */
  function nudgeSelDisk(key, big) {
    const e = selDisk ? entries.find((x) => x.id === selDisk.entryId) : null;
    const d = e?.stroke.disks[selDisk?.index];
    if (!d) return false;
    const step = big ? 10 : 1;
    beginTxn();
    if (selDisk.type === "center") {
      if (key === "ArrowLeft") d.x -= step;
      else if (key === "ArrowRight") d.x += step;
      else if (key === "ArrowUp") d.y -= step;
      else if (key === "ArrowDown") d.y += step;
    } else {
      // Radius handle: right/up grows, left/down shrinks
      const delta = key === "ArrowRight" || key === "ArrowUp" ? step : -step;
      d.r = Math.max(0.05, d.r + delta);
    }
    e.dirty = true;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(commitTxn, 900);
    draw();
    updatePanes();
    return true;
  }

  /* ============================================================
   * Pressure / width analysis graph
   * ============================================================ */
  function drawPressureGraph() {
    const cv = ui.pressureGraph;
    if (!ui.panePressure.classList.contains("visible")) return;
    const rect = cv.getBoundingClientRect();
    if (rect.width === 0) return;
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width, H = rect.height;
    g.clearRect(0, 0, W, H);

    const entry = selected();
    g.font = "9px Menlo, monospace";
    if (!entry) {
      g.fillStyle = "#aaa";
      g.fillText("no stroke selected", 8, H / 2);
      return;
    }

    const padL = 6, padR = 6, padT = 10, padB = 12;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const yOf = (v01) => padT + (1 - Math.max(0, Math.min(1, v01))) * plotH;

    // frame + midline
    g.strokeStyle = "#eee";
    g.strokeRect(padL, padT, plotW, plotH);
    g.beginPath(); g.moveTo(padL, yOf(0.5)); g.lineTo(padL + plotW, yOf(0.5));
    g.strokeStyle = "#f3f3f3"; g.stroke();

    const maxWidth = Math.max(1, fit.maxWidth);

    // Raw pressure vs normalized arc length (gray dots)
    const raw = entry.analysis?.rawPoints;
    if (raw?.length > 1) {
      const cum = [0];
      for (let i = 1; i < raw.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
      }
      const total = cum[cum.length - 1] || 1;
      g.fillStyle = "rgba(120,120,120,0.45)";
      for (let i = 0; i < raw.length; i++) {
        g.beginPath();
        g.arc(padL + (cum[i] / total) * plotW, yOf(raw[i].p), 1.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Fitted width profile (blue line), normalized so maxWidth = 1.0
    const cache = ensureCache(entry);
    if (cache) {
      g.strokeStyle = "rgba(0,122,255,0.9)";
      g.lineWidth = 1.5;
      g.beginPath();
      const circles = cache.circles || [];
      circles.forEach((c, i) => {
        const x = padL + (i / Math.max(1, circles.length - 1)) * plotW;
        const y = yOf((c.radius * 2) / maxWidth);
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      });
      g.stroke();
    }

    // Legend
    g.fillStyle = "rgba(120,120,120,0.8)";
    g.fillText("· raw pressure (0–1)", padL + 2, H - 3);
    g.fillStyle = "rgba(0,122,255,0.9)";
    g.fillText(`— fitted width / ${maxWidth}px`, padL + 120, H - 3);
  }

  /* ============================================================
   * Panes / status
   * ============================================================ */
  function buildSvg() {
    return Ink.strokesToSVG(entries.map((e) => e.stroke), { ...render, padding: 10 });
  }

  function updatePanes() {
    drawPressureGraph();

    if (ui.paneJson.classList.contains("visible")) {
      ui.jsonText.value = Ink.serialize(entries.map((e) => e.stroke));
    }
    if (ui.paneSvg.classList.contains("visible")) {
      ui.svgPreview.innerHTML = buildSvg();
    }

    // Status line
    const e = selected();
    if (!e) {
      ui.status.textContent = entries.length
        ? `${entries.length} stroke(s) — click one to select`
        : "draw a stroke to begin";
      return;
    }
    const cache = ensureCache(e);
    const parts = [`${entries.length} stroke(s)`, `#${entries.indexOf(e) + 1} selected:`];
    if (e.analysis) {
      parts.push(`${e.analysis.rawPoints.length} raw → ${e.analysis.reducedPoints.length} rdp → ${e.stroke.disks.length} disks`);
      if (e.analysis.fitError) parts.push(`fit err ${e.analysis.fitError.toFixed(2)}px`);
    } else {
      parts.push(`${e.stroke.disks.length} disks (imported)`);
    }
    if (cache) {
      parts.push(`render ${cache.renderMs.toFixed(1)}ms`);
      parts.push(`path ${(cache.d.length / 1024).toFixed(1)}KB`);
    }
    ui.status.textContent = parts.join("  ·  ");
  }

  /* ============================================================
   * Wiring
   * ============================================================ */
  const wireToggle = (btn, key) => {
    btn.onclick = () => {
      view[key] = !view[key];
      btn.classList.toggle("active", view[key]);
      draw();
    };
  };
  wireToggle(ui.togFill, "fill");
  wireToggle(ui.togRaw, "raw");
  wireToggle(ui.togReduced, "reduced");
  wireToggle(ui.togSkel, "skeleton");
  wireToggle(ui.togOutline, "outline");
  wireToggle(ui.togNorm, "normals");
  wireToggle(ui.togCusps, "cusps");

  document.querySelectorAll('input[name="handles"]').forEach((el) => {
    el.onchange = () => { if (el.checked) { view.handles = el.value; draw(); } };
  });

  // Fit params — live refit of the selected stroke. A slider scrub is one
  // undo step: the transaction opens on the first input and commits on release.
  const wireSlider = (input, apply) => {
    input.oninput = () => { beginTxn(); apply(parseFloat(input.value)); refitSelectedLive(); };
    input.onchange = () => commitTxn();
  };
  wireSlider(ui.paramRdp, (v) => { fit.rdpTolerance = v; ui.dispRdp.textContent = `${v.toFixed(1)} px`; });
  wireSlider(ui.paramPw, (v) => { fit.pressureWeight = v; ui.dispPw.textContent = String(v); });
  wireSlider(ui.paramMinW, (v) => {
    fit.minWidth = v;
    if (fit.maxWidth < v) { fit.maxWidth = v; ui.paramMaxW.value = v; }
    ui.dispW.textContent = `${fit.minWidth} – ${fit.maxWidth} px`;
  });
  wireSlider(ui.paramMaxW, (v) => {
    fit.maxWidth = Math.max(v, fit.minWidth);
    ui.dispW.textContent = `${fit.minWidth} – ${fit.maxWidth} px`;
  });
  wireSlider(ui.paramFit, (v) => { fit.fitTolerance = v; ui.dispFit.textContent = `${v.toFixed(1)} px`; });

  document.querySelectorAll('input[name="degree"]').forEach((el) => {
    el.onchange = () => {
      if (!el.checked) return;
      fit.degree = parseInt(el.value, 10) || 3;
      const e = selected();
      if (e) {
        withHistory(() => {
          if (!refitEntry(e)) { e.stroke.degree = fit.degree; e.dirty = true; }
        });
        draw(); updatePanes();
      }
    };
  });

  // Render params — cheap re-render of everything (caches invalidated)
  document.querySelectorAll('input[name="method"]').forEach((el) => {
    el.onchange = () => {
      if (el.checked) { render.method = el.value; markAllDirty(); draw(); updatePanes(); }
    };
  });
  ui.paramTol.oninput = () => {
    render.tolerance = parseFloat(ui.paramTol.value) || 0.5;
    ui.dispTol.textContent = `${render.tolerance.toFixed(1)} px`;
    markAllDirty(); draw(); updatePanes();
  };

  // Ink options apply to the selected stroke too. Color-picker scrubbing is
  // one undo step (txn opens on first input, commits on picker close/change).
  ui.inkColor.oninput = () => {
    const e = selected();
    if (e) { beginTxn(); e.stroke.color = ui.inkColor.value; draw(); updatePanes(); }
  };
  ui.inkColor.onchange = () => commitTxn();
  ui.chkClosed.onchange = () => {
    const e = selected();
    if (e) {
      withHistory(() => { e.stroke.closed = ui.chkClosed.checked; e.dirty = true; });
      draw(); updatePanes();
    }
  };

  // Buttons
  ui.btnRefit.onclick = () => {
    let ok = false;
    withHistory(() => { ok = refitSelectedLive(); });
    if (!ok) toast("Selected stroke has no raw input");
  };
  ui.btnRefitAll.onclick = () => {
    let n = 0;
    withHistory(() => { for (const e of entries) if (refitEntry(e)) n++; });
    draw(); updatePanes();
    toast(n ? `Refit ${n} stroke(s)` : "No strokes with raw input");
  };
  ui.btnUndo.onclick = undo;
  ui.btnRedo.onclick = redo;
  ui.btnDelete.onclick = () => (selDisk ? deleteSelectedDisk() : deleteSelectedStroke());
  ui.btnClear.onclick = () => {
    if (!entries.length) return;
    withHistory(() => {
      entries.length = 0;
      selectedId = null;
      selDisk = null;
    });
    draw(); updatePanes();
  };
  ui.btnCopySvg.onclick = () => {
    const svg = buildSvg();
    svg ? copyText(svg) : toast("Nothing to copy");
  };
  ui.btnDownload.onclick = () => {
    const svg = buildSvg();
    if (!svg) { toast("Nothing to download"); return; }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dbsc-ink-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast("Downloaded");
  };

  // Panes
  ui.chkPressure.onchange = () => { ui.panePressure.classList.toggle("visible", ui.chkPressure.checked); updatePanes(); };
  ui.chkJson.onchange = () => { ui.paneJson.classList.toggle("visible", ui.chkJson.checked); updatePanes(); };
  ui.chkSvg.onchange = () => { ui.paneSvg.classList.toggle("visible", ui.chkSvg.checked); updatePanes(); };

  ui.btnJsonCopy.onclick = () => copyText(ui.jsonText.value || Ink.serialize(entries.map((e) => e.stroke)));
  ui.btnJsonLoad.onclick = () => {
    const strokes = Ink.deserialize(ui.jsonText.value);
    if (!strokes.length) { toast("No valid strokes in JSON"); return; }
    withHistory(() => {
      entries.length = 0;
      for (const s of strokes) {
        entries.push({ id: nextId++, stroke: s, analysis: null, dirty: true, cache: null });
      }
      selectedId = entries[entries.length - 1].id;
      selDisk = null;
    });
    draw(); updatePanes();
    toast(`Loaded ${strokes.length} stroke(s)`);
  };
  ui.btnSvgCopy.onclick = () => {
    const svg = buildSvg();
    svg ? copyText(svg) : toast("Nothing to copy");
  };

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      // Delete the selected disk if one is selected, otherwise the stroke
      selDisk ? deleteSelectedDisk() : deleteSelectedStroke();
      e.preventDefault();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      if (nudgeSelDisk(e.key, e.shiftKey)) e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      undo();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      redo();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      // First Escape drops the disk selection, second drops the stroke selection
      if (selDisk) selDisk = null;
      else selectedId = null;
      draw();
      updatePanes();
    }
  });

  // Init
  ui.panePressure.classList.toggle("visible", ui.chkPressure.checked);
  updateHistoryUI();
  resize();
  updatePanes();
})();
