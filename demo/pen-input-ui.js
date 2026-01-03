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
  let draggingCenterIndex = -1;
  let draggingRadiusIndex = -1;
  let draggingPointerId = null;

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
    chkPathPoints: document.getElementById("chk-path-points"),
    chkSkinning: document.getElementById("chk-skinning"),
    chkColor: document.getElementById("chk-color"),
    paneDebug: document.getElementById("pane-debug"),
    paneExport: document.getElementById("pane-export"),
  };

  const state = { raw: true, reduced: true, curve: true };
  const renderOpts = {
    pathPoints: true,
    skinning: false,
    color: false,
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function strokeWidthCssPx(pressure01) {
    const maxW = Math.max(1, parseFloat(ui.maxW?.value ?? "30"));
    return 1 + clamp01(pressure01) * (maxW - 1);
  }

  function getEffectiveWidthCssPxForCP(cp) {
    // Radius-handle edits are explicit overrides in CSS pixels (not constrained by Max Stroke Width).
    if (cp && Number.isFinite(cp.widthOverrideCssPx)) {
      return Math.max(0.5, cp.widthOverrideCssPx);
    }
    // Otherwise width is derived from input pressure scaled by Max Stroke Width.
    return Math.max(0.5, strokeWidthCssPx(cp?.p ?? 0));
  }

  function diskRadiusCssPxForCP(cp) {
    return Math.max(0.25, getEffectiveWidthCssPxForCP(cp) / 2);
  }

  function isCurveEditable() {
    return !!(state.curve && spline && Array.isArray(spline.controlPoints) && spline.controlPoints.length);
  }

  function evalEffectiveWidthCssPxAt(t01) {
    // Evaluate a "width spline" using the same degree/knots, but with scalar widths stored in .p.
    // This makes radius overrides affect the rendered stroke width smoothly along the curve.
    if (!spline?.controlPoints?.length || !spline?.knots?.length) return 1;
    const cps = spline.controlPoints.map((cp) => ({ x: 0, y: 0, p: getEffectiveWidthCssPxForCP(cp) }));
    const pt = u.deboorEval(Math.max(0, Math.min(1, t01)), spline.degree, cps, spline.knots);
    return Math.max(0.5, pt?.p ?? 1);
  }

  function getDBSCArrayFromSpline(s) {
    if (!s?.controlPoints?.length) return "";
    const cps = s.controlPoints;

    // Bounding box
    let minX = Infinity,
      minY = Infinity;
    for (const cp of cps) {
      if (cp.x < minX) minX = cp.x;
      if (cp.y < minY) minY = cp.y;
    }
    const offsetX = 10 - minX;
    const offsetY = 10 - minY;

    return cps
      .map((cp) => {
        const w = getEffectiveWidthCssPxForCP(cp);
        const x = cp.x + offsetX;
        const y = cp.y + offsetY;
        return `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(2)}`;
      })
      .join("\n");
  }

  function isDiskBSplineAvailable() {
    return typeof window.DiskBSpline === "function";
  }

  const colorPalette = [
    { r: 1, g: 0, b: 0, a: 1 }, // red
    { r: 0, g: 1, b: 0, a: 1 }, // green
    { r: 0, g: 0, b: 1, a: 1 }, // blue
    { r: 1, g: 1, b: 0, a: 1 }, // yellow
    { r: 0, g: 1, b: 1, a: 1 }, // cyan
    { r: 1, g: 0, b: 1, a: 1 }, // magenta
  ];

  function paletteColorForIndex(i) {
    return colorPalette[i % colorPalette.length];
  }

  function buildControlDisksPx() {
    // DiskBSpline expects { center:{x,y}, radius, color } in the same units.
    if (!spline?.controlPoints?.length) return [];
    return spline.controlPoints.map((cp, i) => {
      const widthCss = getEffectiveWidthCssPxForCP(cp);
      const radiusPx = (widthCss / 2) * dpr;
      return {
        center: { x: cp.x, y: cp.y },
        radius: Math.max(0, radiusPx),
        color: renderOpts.color ? paletteColorForIndex(i) : { r: 0, g: 0, b: 0, a: 1 },
      };
    });
  }

  function parseSvgPolygon(polyStr) {
    // Expected: <polygon points="x,y x,y ..." fill="rgba(...)" stroke="rgba(...)" ... />
    const pointsMatch = polyStr.match(/points="([^"]+)"/);
    if (!pointsMatch) return null;
    const fillMatch = polyStr.match(/fill="([^"]+)"/);
    const fill = fillMatch ? fillMatch[1] : "rgba(0,0,0,1)";
    const pts = pointsMatch[1]
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [xStr, yStr] = pair.split(",");
        const x = parseFloat(xStr);
        const y = parseFloat(yStr);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      })
      .filter(Boolean);
    if (pts.length < 3) return null;
    return { points: pts, fill };
  }

  function hitTestControlDiskHandle(pos) {
    // Returns { type: "center"|"radius", index } or null.
    if (!isCurveEditable()) return null;

    // Hit radiuses in CSS px, convert to device px for consistent hit radius.
    const centerHitRadius = 8 * dpr;
    const handleHitRadius = 8 * dpr;

    let closest = null;
    let closestDist = Infinity;

    for (let i = 0; i < spline.controlPoints.length; i++) {
      const cp = spline.controlPoints[i];
      const cx = cp.x;
      const cy = cp.y;

      // center
      {
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist <= centerHitRadius && dist < closestDist) {
          closest = { type: "center", index: i };
          closestDist = dist;
        }
      }

      // radius handle (to the right)
      {
        const rCss = diskRadiusCssPxForCP(cp);
        const rPx = rCss * dpr;
        const hx = cx + rPx;
        const hy = cy;
        const dx = pos.x - hx;
        const dy = pos.y - hy;
        const dist = Math.hypot(dx, dy);
        if (dist <= handleHitRadius && dist < closestDist) {
          closest = { type: "radius", index: i };
          closestDist = dist;
        }
      }
    }

    return closest;
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
    // If we have a computed spline and Curve visibility is on, allow editing control disks
    // (center drag and radius-handle drag), like demo/index.html.
    const pos = getC(e);
    const hit = hitTestControlDiskHandle(pos);
    if (hit) {
      draggingPointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      if (hit.type === "center") {
        draggingCenterIndex = hit.index;
        draggingRadiusIndex = -1;
        canvas.style.cursor = "move";
      } else {
        draggingRadiusIndex = hit.index;
        draggingCenterIndex = -1;
        canvas.style.cursor = "ew-resize";
      }
      // Don’t start a new stroke when editing handles.
      return;
    }

    isDrawing = true;
    hasP = false;
    rawPoints = [];
    rdpPoints = [];
    spline = null;
    canvas.setPointerCapture(e.pointerId);
    rawPoints.push(pos);
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = getC(e);

    // Dragging center point
    if (draggingCenterIndex >= 0 && spline?.controlPoints?.[draggingCenterIndex]) {
      const cp = spline.controlPoints[draggingCenterIndex];
      cp.x = pos.x;
      cp.y = pos.y;
      updateExport();
      draw();
      return;
    }

    // Dragging radius handle
    if (draggingRadiusIndex >= 0 && spline?.controlPoints?.[draggingRadiusIndex]) {
      const cp = spline.controlPoints[draggingRadiusIndex];
      const dx = pos.x - cp.x;
      const dy = pos.y - cp.y;
      const radiusPx = Math.max(0.5 * dpr, Math.hypot(dx, dy));
      const radiusCss = radiusPx / dpr;
      // Override: do NOT constrain by Max Stroke Width.
      cp.widthOverrideCssPx = Math.max(0.5, radiusCss * 2);
      updateExport();
      draw();
      return;
    }

    // Hover cursor when curve is editable (but not drawing)
    if (!isDrawing && isCurveEditable()) {
      const hit = hitTestControlDiskHandle(pos);
      if (hit?.type === "center") canvas.style.cursor = "move";
      else if (hit?.type === "radius") canvas.style.cursor = "ew-resize";
      else canvas.style.cursor = "crosshair";
    }

    if (!isDrawing) return;
    if (e.getCoalescedEvents) e.getCoalescedEvents().forEach((ev) => rawPoints.push(getC(ev)));
    else rawPoints.push(pos);
    draw();
  });

  canvas.addEventListener("pointerup", (e) => {
    // Finish handle drag (if any)
    if (e.pointerId === draggingPointerId && (draggingCenterIndex >= 0 || draggingRadiusIndex >= 0)) {
      draggingCenterIndex = -1;
      draggingRadiusIndex = -1;
      draggingPointerId = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      canvas.style.cursor = "crosshair";
      draw();
      return;
    }

    isDrawing = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    process();
  });

  function updateExport() {
    if (!spline) return;
    // Export in CSS pixels (web-standard), not device pixels.
    const exportSpline = scaleSplineXY(spline, 1 / dpr);
    ui.logExport.value =
      `--- SVG PATH ---\n<path d="${getSVGPath(exportSpline)}" fill="none" stroke="rgba(255,0,0,0.25)" stroke-width="2" />\n\n` +
      `--- DBSC ARRAY ---\n${getDBSCArrayFromSpline(exportSpline)}`;

    // Optional: include DBSC outline / mesh preview, driven by Skinning/Color stroke.
    if (isDiskBSplineAvailable() && (renderOpts.skinning || renderOpts.color)) {
      try {
        const controlDisksCss = exportSpline.controlPoints.map((cp, i) => {
          const widthCss = getEffectiveWidthCssPxForCP(cp);
          const radiusCss = widthCss / 2;
          return {
            center: { x: cp.x, y: cp.y },
            radius: Math.max(0, radiusCss),
            color: renderOpts.color ? paletteColorForIndex(i) : { r: 0, g: 0, b: 0, a: 1 },
          };
        });
        const bs = new window.DiskBSpline(controlDisksCss, { degree: 3, debug: false, closed: false });
        const method = renderOpts.skinning ? "skinning" : renderOpts.color ? "analytical" : "simple";
        const res = bs.render({ method, tessellate: renderOpts.color, tolerance: 0.5 });
        const svgInner = renderOpts.color
          ? `<g>${res.mesh.join("")}</g><path d="${res.outlinePath}" fill="none" />`
          : `<path d="${res.outlinePath}" fill="black" opacity="0.15" stroke="none" />`;
        ui.logExport.value +=
          `\n\n--- DBSC SVG (${method}${renderOpts.color ? ", colored" : ""}) ---\n` +
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${window.innerWidth} ${window.innerHeight}">\n${svgInner}\n</svg>`;
      } catch (_) {
        // ignore export extras if something goes wrong
      }
    }
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
      // Keep a subtle centerline reference (was previously shown under Curve).
      ctx.save();
      ctx.strokeStyle = "rgba(255, 0, 0, 0.35)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke(new Path2D(getSVGPath(spline)));
      ctx.restore();

      // If Skinning or Color stroke are enabled, render the DBSC outline/mesh using DiskBSpline.
      // Otherwise fall back to the lightweight variable-width stroke preview.
      const canDbsc = isDiskBSplineAvailable();
      let dbscCircles = null;
      if (canDbsc && (renderOpts.skinning || renderOpts.color)) {
        const disksPx = buildControlDisksPx();
        if (disksPx.length >= 4) {
          try {
            const bs = new window.DiskBSpline(disksPx, { degree: 3, debug: false, closed: false });
            const method = renderOpts.skinning ? "skinning" : renderOpts.color ? "analytical" : "simple";
            const res = bs.render({ method, tessellate: renderOpts.color, tolerance: 0.5 });
            dbscCircles = Array.isArray(res.circles) ? res.circles : null;

            if (renderOpts.color && Array.isArray(res.mesh) && res.mesh.length) {
              ctx.save();
              for (const poly of res.mesh) {
                const parsed = parseSvgPolygon(poly);
                if (!parsed) continue;
                const pts = parsed.points;
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.closePath();
                ctx.fillStyle = parsed.fill;
                ctx.strokeStyle = parsed.fill;
                ctx.lineWidth = 0.5 * dpr;
                ctx.fill();
                ctx.stroke();
              }
              ctx.restore();
            } else {
              // Outline fill preview
              ctx.save();
              ctx.fillStyle = "rgba(0,0,0,0.15)";
              ctx.fill(new Path2D(res.outlinePath));
              ctx.restore();
            }
          } catch (_) {
            // If DBSC rendering fails, fall back to stroke preview
          }
        }
      } else {
        const res = 400;
        ctx.lineCap = "round";
        for (let i = 0; i < res; i++) {
          const t1 = i / res;
          const t2 = (i + 1) / res;
          const p1 = evalS(t1, spline),
            p2 = evalS(t2, spline);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = evalEffectiveWidthCssPxAt(t1) * dpr;
          ctx.strokeStyle = "rgba(0,122,255,0.1)";
          ctx.stroke();
        }
      }

      // Path points: show sampled points (like demo/index.html's "Path Points", but on canvas).
      if (renderOpts.pathPoints) {
        ctx.save();
        ctx.fillStyle = "rgba(0,102,204,0.75)";
        const r = 1.5 * dpr;
        if (dbscCircles && dbscCircles.length) {
          const step = Math.max(1, Math.floor(dbscCircles.length / 80));
          for (let i = 0; i < dbscCircles.length; i += step) {
            const c = dbscCircles[i];
            if (!c?.center) continue;
            ctx.beginPath();
            ctx.arc(c.center.x, c.center.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const samples = 120;
          for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const p = evalS(t, spline);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      ctx.save();
      // Control "disks": show radius, center dot, radius handle dot, and radius label.
      const centerDotR = 3.5 * dpr;
      const handleDotR = 3.5 * dpr;
      const labelPad = 6 * dpr;

      ctx.font = `${Math.max(10, Math.round(10 * dpr))}px Menlo, monospace`;
      ctx.textBaseline = "middle";

      spline.controlPoints.forEach((cp, i) => {
        const diskRpx = diskRadiusCssPxForCP(cp) * dpr;
        const cx = cp.x;
        const cy = cp.y;
        const hx = cx + diskRpx;
        const hy = cy;

        // Disk outline
        ctx.beginPath();
        ctx.arc(cx, cy, diskRpx, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 59, 48, 0.25)";
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([]);
        ctx.stroke();

        // Radius line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = "rgba(255, 59, 48, 0.35)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // Center dot (draggable)
        ctx.beginPath();
        ctx.arc(cx, cy, centerDotR, 0, Math.PI * 2);
        ctx.fillStyle = "#ff3b30";
        ctx.fill();

        // Radius handle dot (draggable)
        ctx.beginPath();
        ctx.arc(hx, hy, handleDotR, 0, Math.PI * 2);
        ctx.fillStyle = "#007AFF";
        ctx.fill();

        // Radius label (CSS px)
        const radiusCss = diskRpx / dpr;
        const label = `r=${radiusCss.toFixed(1)}`;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(label, hx + labelPad, hy);

        // Optional index label near center (helps when dragging)
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillText(String(i), cx + labelPad, cy - (10 * dpr));
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
  ui.chkPathPoints.onchange = () => {
    renderOpts.pathPoints = !!ui.chkPathPoints.checked;
    draw();
  };
  ui.chkSkinning.onchange = () => {
    renderOpts.skinning = !!ui.chkSkinning.checked;
    draw();
    updateExport();
  };
  ui.chkColor.onchange = () => {
    renderOpts.color = !!ui.chkColor.checked;
    draw();
    updateExport();
  };

  // Initialize parameter readouts
  ui.dFit.textContent = ui.fit.value + " px";
  ui.dMaxW.textContent = ui.maxW.value + " px";
  // Initialize checkbox state
  renderOpts.pathPoints = !!ui.chkPathPoints?.checked;
  renderOpts.skinning = !!ui.chkSkinning?.checked;
  renderOpts.color = !!ui.chkColor?.checked;
})();


