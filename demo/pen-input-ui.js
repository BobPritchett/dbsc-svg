(() => {
  const u = window.PenInputUtils;
  if (!u) {
    // Fail loudly but helpfully if script order is wrong
    throw new Error("Missing window.PenInputUtils. Load pen-input-utils.js before pen-input-ui.js");
  }

  const {
    simplifyRDP3D,
    fitBSpline,
    evalS,
    getSVGPath,
    getDBSCArray,
    computeMaxDistanceErrorXY,
    formatPointList,
  } = u;

  /** App Logic **/
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  let rawPoints = [];
  let rdpPoints = [];
  let spline = null;
  let isDrawing = false;
  let dpr = window.devicePixelRatio || 1;
  let hasP = false;

  const ui = {
    eps: document.getElementById("param-eps"),
    p: document.getElementById("param-p"),
    maxW: document.getElementById("param-maxw"),
    fit: document.getElementById("param-fit"),
    dEps: document.getElementById("disp-eps"),
    dP: document.getElementById("disp-p"),
    dFit: document.getElementById("disp-fit"),
    dMaxW: document.getElementById("disp-maxw"),
    dCp: document.getElementById("disp-cp"),
    logDebug: document.getElementById("log-debug"),
    logExport: document.getElementById("log-export"),
    togRaw: document.getElementById("tog-raw"),
    togReduced: document.getElementById("tog-reduced"),
    togCurve: document.getElementById("tog-curve"),
    chkDebug: document.getElementById("chk-debug"),
    chkExport: document.getElementById("chk-export"),
    paneDebug: document.getElementById("pane-debug"),
    paneExport: document.getElementById("pane-export"),
  };

  const state = { raw: true, reduced: true, curve: true };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function strokeWidthCssPx(pressure01) {
    const maxW = Math.max(1, parseFloat(ui.maxW?.value ?? "30"));
    return 1 + clamp01(pressure01) * (maxW - 1);
  }

  function scaleSplineXY(s, scale) {
    if (!s) return s;
    if (!Number.isFinite(scale) || scale === 1) return s;
    return {
      ...s,
      controlPoints: s.controlPoints.map((cp) => ({ ...cp, x: cp.x * scale, y: cp.y * scale })),
    };
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    draw();
  }
  window.addEventListener("resize", resize);
  resize();

  function getC(e) {
    const r = canvas.getBoundingClientRect();
    const p = e.pressure || 0.5;
    if (p !== 0.5 && p !== 0 && p !== 1) hasP = true;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, p };
  }

  canvas.addEventListener("pointerdown", (e) => {
    isDrawing = true;
    hasP = false;
    rawPoints = [];
    rdpPoints = [];
    spline = null;
    canvas.setPointerCapture(e.pointerId);
    rawPoints.push(getC(e));
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    if (e.getCoalescedEvents) e.getCoalescedEvents().forEach((ev) => rawPoints.push(getC(ev)));
    else rawPoints.push(getC(e));
    draw();
  });

  canvas.addEventListener("pointerup", (e) => {
    isDrawing = false;
    canvas.releasePointerCapture(e.pointerId);
    process();
  });

  function updateExport() {
    if (!spline) return;
    // Export in CSS pixels (web-standard), not device pixels.
    const exportSpline = scaleSplineXY(spline, 1 / dpr);
    const maxW = Math.max(1, parseFloat(ui.maxW?.value ?? "30"));
    ui.logExport.value =
      `--- SVG PATH ---\n<path d="${getSVGPath(exportSpline)}" fill="none" stroke="rgba(255,0,0,0.25)" stroke-width="2" />\n\n` +
      `--- DBSC ARRAY ---\n${getDBSCArray(exportSpline, maxW)}`;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.raw && rawPoints.length) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1 * dpr;
      rawPoints.forEach((p) => {
        ctx.beginPath();
        // Render input pressure as radius, using the same 1..max mapping as stroke width.
        ctx.arc(p.x, p.y, (strokeWidthCssPx(p.p) / 2) * dpr, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (state.reduced && rdpPoints.length) {
      ctx.save();
      // Connect reduced (RDP) points with a 2px green line @ 0.15 opacity
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = "#33c31e";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([]);
      ctx.beginPath();
      rdpPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // Draw reduced points as unstroked green circles @ 0.15 opacity
      ctx.fillStyle = "#33c31e";
      rdpPoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (strokeWidthCssPx(p.p) / 2) * dpr, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    if (spline && state.curve) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke(new Path2D(getSVGPath(spline)));
      ctx.restore();

      const res = 400;
      ctx.lineCap = "round";
      for (let i = 0; i < res; i++) {
        const p1 = evalS(i / res, spline),
          p2 = evalS((i + 1) / res, spline);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = strokeWidthCssPx(p1.p) * dpr;
        ctx.strokeStyle = "rgba(0,122,255,0.1)";
        ctx.stroke();
      }

      ctx.save();
      // Control points as solid red circles
      ctx.fillStyle = "#ff3b30";
      const r = 4 * dpr;
      spline.controlPoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }

  function process() {
    if (rawPoints.length < 2) return;

    rdpPoints = simplifyRDP3D(rawPoints, parseFloat(ui.eps.value) * dpr, parseFloat(ui.p.value));
    // Choose control point count by iterating until the maximum point-to-curve deviation
    // drops below a target. This mirrors the "iterative approximation" approach in
    // spline-curve-fitting, but kept lightweight for this demo.
    const targetErr = Math.max(0.5 * dpr, parseFloat(ui.fit.value) * dpr);
    const minCPs = Math.max(4, Math.min(8, rdpPoints.length));
    const maxCPs = Math.max(minCPs, Math.min(50, rdpPoints.length));

    let bestSpline = null;
    let bestErr = Infinity;
    let chosenCPs = minCPs;

    for (let cpCount = minCPs; cpCount <= maxCPs; cpCount++) {
      const s = fitBSpline(rdpPoints, cpCount, 3);
      if (!s) continue;
      const err = computeMaxDistanceErrorXY(s, rdpPoints, s.params);
      if (err < bestErr) {
        bestErr = err;
        bestSpline = s;
        chosenCPs = cpCount;
      }
      if (err <= targetErr) break; // early-exit once we're good enough
    }

    spline = bestSpline;
    ui.dCp.textContent = chosenCPs;

    if (spline) {
      const fmt = typeof formatPointList === "function" ? formatPointList : null;
      let debug = "";
      debug += `--- RAW POINTS (${rawPoints.length}) ---\n`;
      debug += fmt ? fmt(rawPoints) : rawPoints.map((p, i) => `${i}: {x:${p.x.toFixed(1)}, y:${p.y.toFixed(1)}, p:${p.p.toFixed(2)}}`).join("\n");
      debug += `\n\n--- REDUCED POINTS (RDP) (${rdpPoints.length}) ---\n`;
      debug += fmt ? fmt(rdpPoints) : rdpPoints.map((p, i) => `${i}: {x:${p.x.toFixed(1)}, y:${p.y.toFixed(1)}, p:${p.p.toFixed(2)}}`).join("\n");
      debug += `\n\n--- CONTROL POINTS (${spline.controlPoints.length}) ---\n`;
      debug += fmt
        ? fmt(spline.controlPoints)
        : spline.controlPoints.map((p, i) => `${i}: {x:${p.x.toFixed(1)}, y:${p.y.toFixed(1)}, p:${p.p.toFixed(2)}}`).join("\n");
      ui.logDebug.value = debug + "\n";
      updateExport();
    }

    draw();
  }

  ui.togRaw.onclick = () => {
    state.raw = !state.raw;
    ui.togRaw.classList.toggle("active");
    draw();
  };
  ui.togReduced.onclick = () => {
    state.reduced = !state.reduced;
    ui.togReduced.classList.toggle("active");
    draw();
  };
  ui.togCurve.onclick = () => {
    state.curve = !state.curve;
    ui.togCurve.classList.toggle("active");
    draw();
  };
  ui.eps.oninput = () => {
    ui.dEps.textContent = ui.eps.value + " px";
    process();
  };
  ui.p.oninput = () => {
    ui.dP.textContent = ui.p.value;
    process();
  };
  ui.fit.oninput = () => {
    ui.dFit.textContent = ui.fit.value + " px";
    process();
  };
  ui.maxW.oninput = () => {
    ui.dMaxW.textContent = ui.maxW.value + " px";
    updateExport();
    draw();
  };
  document.getElementById("btn-clear").onclick = () => {
    rawPoints = [];
    rdpPoints = [];
    spline = null;
    draw();
  };
  ui.chkDebug.onchange = () => ui.paneDebug.classList.toggle("visible", ui.chkDebug.checked);
  ui.chkExport.onchange = () => ui.paneExport.classList.toggle("visible", ui.chkExport.checked);

  // Initialize parameter readouts
  ui.dFit.textContent = ui.fit.value + " px";
  ui.dMaxW.textContent = ui.maxW.value + " px";
})();


