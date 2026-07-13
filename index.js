/**
 * DiskBSpline - A class for generating variable-width curves
 * using B-spline interpolation of disks.
 */
class DiskBSpline {
  /**
   * Creates a new DiskBSpline instance
   * @param {Array} controlDisks - Array of control disks, each with center (x,y), radius, and optional color
   * @param {Object} options - Options object
   * @param {number} options.degree - Degree of the B-spline (default: 3)
   * @param {boolean} options.debug - Whether to enable debug logging (default: false)
   * @param {boolean} options.closed - Whether the shape should be closed (default: false)
   */
  constructor(controlDisks = [], options = {}) {
    this.degree = options.degree ?? 3;
    this.debug = options.debug ?? false;
    this.closed = options.closed ?? false;

    // Normalize control disks (ensure color exists)
    const normalizedDisks = controlDisks.map(d => ({
      ...d,
      color: d.color || { r: 0, g: 0, b: 0, a: 1 } // Default black
    }));

    // For closed shapes, wrap the first degree control points at the end
    if (this.closed && normalizedDisks.length > this.degree) {
      this.controlDisks = [...normalizedDisks];
      for (let i = 0; i < this.degree; i++) {
        this.controlDisks.push(normalizedDisks[i]);
      }
    } else {
      this.controlDisks = normalizedDisks;
    }

    this.knots = [];
    this.generateUniformKnots();
    
    // Debug logging
    if (this.debug) {
      this.logMessage(
        `Created B-spline with ${controlDisks.length} control disks and degree ${this.degree}`
      );
      if (controlDisks.length > 0) {
        this.logMessage(
          `First control disk: (${controlDisks[0].center.x}, ${controlDisks[0].center.y}), r=${controlDisks[0].radius}`
        );
        this.logMessage(
          `Last control disk: (${controlDisks[controlDisks.length - 1].center.x}, ${controlDisks[controlDisks.length - 1].center.y}), r=${controlDisks[controlDisks.length - 1].radius}`
        );
        this.logMessage(`Shape is ${this.closed ? "closed" : "open"}`);
        if (this.closed) {
          this.logMessage(`Wrapped ${this.degree} control points for closed shape`);
        }
      }
    }
  }

  logMessage(message) {
    if (!this.debug) return;
    const logElement = typeof document !== 'undefined' ? document.getElementById("log") : null;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: true }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    if (logElement) {
      const logEntry = document.createElement("div");
      logEntry.textContent = `[${timeStr}] ${message}`;
      logElement.appendChild(logEntry);
      logElement.scrollTop = logElement.scrollHeight;
    }
    console.log(`[${timeStr}] ${message}`);
  }

  addDisk(disk) {
    if (this.closed) {
      // The wrapped duplicate disks are built at construction; appending after
      // them would corrupt the periodic wrap. Rebuild the instance instead.
      throw new Error("addDisk is not supported on closed DiskBSpline instances");
    }
    const newDisk = {
      ...disk,
      color: disk.color || { r: 0, g: 0, b: 0, a: 1 }
    };
    this.controlDisks.push(newDisk);
    this.generateUniformKnots();
    this.logMessage(
      `Added disk at (${disk.center.x}, ${disk.center.y}) with radius ${disk.radius}`
    );
    this.logMessage(`New knot vector: [${this.knots.join(", ")}]`);
  }

  generateUniformKnots() {
    const n = this.controlDisks.length - 1;
    const k = this.degree;

    if (n < k) {
      this.logMessage(
        `WARNING: Not enough control points (${n + 1}) for the specified degree (${k})`
      );
      this.knots = [];
      return;
    }

    this.knots = [];
    if (this.closed) {
      const numKnots = this.controlDisks.length + k + 1;
      for (let i = 0; i < numKnots; i++) {
        this.knots.push(i - k);
      }
    } else {
      for (let i = 0; i <= n + k + 1; i++) {
        if (i < k + 1) this.knots.push(0);
        else if (i > n) this.knots.push(n - k + 1);
        else this.knots.push(i - k);
      }
    }
    
    if (this.debug) {
      this.logMessage(`Generated knot vector: [${this.knots.join(", ")}]`);
    }
  }

  // ==========================================
  // B-spline evaluation (span-based, iterative)
  //
  // B-splines have local support: at any parameter u only degree+1 basis
  // functions are non-zero. We locate the knot span with a binary search and
  // evaluate just those functions with the iterative Cox–de Boor triangle
  // (Piegl & Tiller A2.1/A2.2) — O(degree²) per evaluation instead of the
  // previous O(n · 2^degree) recursive sweep over every control disk.
  // ==========================================

  /** Knot span index s with knots[s] <= u < knots[s+1], clamped to the curve domain. */
  findSpan(u) {
    const n = this.controlDisks.length - 1;
    const k = this.degree;
    if (u >= this.knots[n + 1]) return n;
    if (u <= this.knots[k]) return k;
    let low = k, high = n + 1;
    let mid = (low + high) >> 1;
    while (u < this.knots[mid] || u >= this.knots[mid + 1]) {
      if (u < this.knots[mid]) high = mid;
      else low = mid;
      mid = (low + high) >> 1;
    }
    return mid;
  }

  /**
   * The p+1 non-vanishing basis functions of degree p at u.
   * Returns N where N[j] = N_{span-p+j, p}(u).
   */
  basisFunctionsAt(span, u, p = this.degree) {
    const N = new Array(p + 1).fill(0);
    const left = new Array(p + 1).fill(0);
    const right = new Array(p + 1).fill(0);
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
      left[j] = u - this.knots[span + 1 - j];
      right[j] = this.knots[span + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        const denom = right[r + 1] + left[j - r];
        const temp = denom !== 0 ? N[r] / denom : 0;
        N[r] = saved + right[r + 1] * temp;
        saved = left[j - r] * temp;
      }
      N[j] = saved;
    }
    return N;
  }

  /**
   * First derivatives of the k+1 non-vanishing degree-k basis functions at u,
   * from the degree-(k-1) basis: N'_{i,k} = k/(t_{i+k}-t_i)·N_{i,k-1}
   *                                       - k/(t_{i+k+1}-t_{i+1})·N_{i+1,k-1}.
   * Returns dN where dN[j] = N'_{span-k+j, k}(u).
   */
  basisDerivativesAt(span, u) {
    const k = this.degree;
    const dN = new Array(k + 1).fill(0);
    if (k === 0) return dN;
    const Nlow = this.basisFunctionsAt(span, u, k - 1); // Nlow[j] = N_{span-k+1+j, k-1}
    for (let j = 0; j <= k; j++) {
      const i = span - k + j;
      let v = 0;
      const d1 = this.knots[i + k] - this.knots[i];
      if (d1 !== 0 && j >= 1) v += (k / d1) * Nlow[j - 1];
      const d2 = this.knots[i + k + 1] - this.knots[i + 1];
      if (d2 !== 0 && j <= k - 1) v -= (k / d2) * Nlow[j];
      dN[j] = v;
    }
    return dN;
  }

  // Returns { center: {x,y}, radius, color: {r,g,b,a} }
  evaluateAt(u) {
    if (this.controlDisks.length < this.degree + 1) {
      return { center: { x: 0, y: 0 }, radius: 0, color: { r: 0, g: 0, b: 0, a: 1 } };
    }

    const n = this.controlDisks.length - 1;

    // For open shapes, the clamped endpoint is exactly the last control disk
    if (!this.closed && u >= this.knots[n + 1] - 1e-9) {
      return this.controlDisks[n];
    }

    u = this.clampParameter(u);
    const span = this.findSpan(u);
    const N = this.basisFunctionsAt(span, u);

    let centerX = 0, centerY = 0, radius = 0;
    let r = 0, g = 0, b = 0, a = 0;

    for (let j = 0; j <= this.degree; j++) {
      const basis = N[j];
      if (basis === 0) continue;
      const disk = this.controlDisks[span - this.degree + j];
      centerX += basis * disk.center.x;
      centerY += basis * disk.center.y;
      radius += basis * disk.radius;
      const col = disk.color;
      r += basis * col.r;
      g += basis * col.g;
      b += basis * col.b;
      a += basis * col.a;
    }

    return {
      center: { x: centerX, y: centerY },
      radius: radius,
      color: { r, g, b, a }
    };
  }

  evaluateDerivativeAt(u) {
    if (this.controlDisks.length < this.degree + 1) {
      return { x: 0, y: 0, radiusRate: 0 };
    }

    u = this.clampParameter(u);
    const span = this.findSpan(u);
    const dN = this.basisDerivativesAt(span, u);

    let dx = 0, dy = 0, dr = 0;
    for (let j = 0; j <= this.degree; j++) {
      const derivative = dN[j];
      if (derivative === 0) continue;
      const disk = this.controlDisks[span - this.degree + j];
      dx += derivative * disk.center.x;
      dy += derivative * disk.center.y;
      dr += derivative * disk.radius;
    }

    return { x: dx, y: dy, radiusRate: dr };
  }

  // Helper to keep u in valid range
  clampParameter(u) {
    const n = this.controlDisks.length - 1;
    if (this.closed) {
      const start = this.knots[this.degree];
      const end = this.knots[n + 1];
      const period = end - start;
      return start + ((u - start) % period + period) % period;
    } else {
      return Math.max(this.knots[this.degree], Math.min(u, this.knots[n + 1]));
    }
  }

  /**
   * Envelope contact points for a disk + derivative pair.
   * Pure math shared by evaluateEnvelopeAt and the render pipeline (which
   * caches disk/derivative per sample so the spline is evaluated only once).
   *
   * Contact-point condition for the envelope of moving circles:
   *   (P - C) · C' = -r·r'  →  tangential offset r·sinα with sinα = -r'/|C'|.
   * |sinα| is clamped to 1; beyond that the circle family has no real
   * envelope (nested circles / cusp).
   */
  envelopeFromDiskAndDerivative(disk, deriv) {
    const cx = disk.center.x;
    const cy = disk.center.y;
    const r = disk.radius;
    const dx = deriv.x;
    const dy = deriv.y;
    const dr = deriv.radiusRate;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) {
      // Degenerate tangent: collapse to the center
      return { left: { x: cx, y: cy }, right: { x: cx, y: cy } };
    }

    let sinAlpha = -dr / len;
    if (sinAlpha > 1) sinAlpha = 1;
    if (sinAlpha < -1) sinAlpha = -1;
    const cosAlpha = Math.sqrt(1 - sinAlpha * sinAlpha);

    const tx = dx / len, ty = dy / len; // unit tangent
    const nx = -ty, ny = tx;            // unit normal (left side)

    const ox = tx * r * sinAlpha, oy = ty * r * sinAlpha; // along tangent
    const ex = nx * r * cosAlpha, ey = ny * r * cosAlpha; // along normal

    return {
      left: { x: cx + ox + ex, y: cy + oy + ey },
      right: { x: cx + ox - ex, y: cy + oy - ey },
    };
  }

  // Calculate the correct analytic envelope points
  evaluateEnvelopeAt(u) {
    const disk = this.evaluateAt(u);
    const deriv = this.evaluateDerivativeAt(u);
    return { ...this.envelopeFromDiskAndDerivative(disk, deriv), disk };
  }

  /**
   * Attach derivative + envelope data to sampled circles (once per sample).
   * The outline, mesh, caps, and normals all reuse these instead of
   * re-evaluating the spline per consumer.
   */
  annotateSamples(circles) {
    for (const c of circles) {
      if (!c.deriv) c.deriv = this.evaluateDerivativeAt(c.t ?? 0);
      if (!c.env) c.env = this.envelopeFromDiskAndDerivative(c, c.deriv);
    }
    return circles;
  }

  // ==========================================
  // Rendering API
  // ==========================================

  render(options = {}) {
    const renderStartTime = performance.now();
    
    const method = options.method || 'analytical';
    const tessellate = options.tessellate || false;
    const tolerance = options.tolerance || 0.5;

    this.logMessage(`=== RENDER START: method=${method}, tessellate=${tessellate}, tolerance=${tolerance} ===`);
    this.logMessage(`Control disks: ${this.controlDisks.length}, degree: ${this.degree}, closed: ${this.closed}`);

    let circles = [];

    if (method === 'skinning') {
      circles = this.generateSkinningCircles(tolerance);
      this.logMessage(`Skinning generated ${circles.length} circles total`);
    } else {
      // Analytical or simple sampling
      circles = this.sampleCurveAdaptive();
      this.logMessage(`Adaptive sampling generated ${circles.length} points`);
    }

    // Evaluate derivative + envelope once per sample; every consumer below
    // (outline, mesh, caps, normals) reuses the cached values.
    this.annotateSamples(circles);

    const meshStartTime = performance.now();
    const mesh = tessellate ? this.generateMesh(circles) : [];
    if (tessellate) {
      this.logMessage(`Mesh generation: ${mesh.length} polygons in ${(performance.now() - meshStartTime).toFixed(2)}ms`);
    }
    
    // Choose outline generation method
    const outlineStartTime = performance.now();
    let outlinePath;
    if (method === 'simple') {
      // Original simple perpendicular-normal approach
      outlinePath = this.generateSimpleOutlinePath(circles);
      this.logMessage(`Simple outline path generated in ${(performance.now() - outlineStartTime).toFixed(2)}ms`);
    } else if (method === 'skinning') {
      // Skinning mode: tangent lines + arcs (Kruppa et al.)
      // Uses sparse circles from iterative refinement
      outlinePath = this.generateSkinningPath(circles);
    } else {
      // Analytical envelope
      outlinePath = this.generateOutlinePath(circles, false);
      this.logMessage(`Analytical outline path generated in ${(performance.now() - outlineStartTime).toFixed(2)}ms`);
    }

    // Also return skeleton path for debug
    const centerPoints = circles.map(c => c.center);
    const skeletonPath = this.createSmoothPath(centerPoints);

    // Log skeleton path points
    if (this.debug) {
      const pointsStr = centerPoints.map(pt => `(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`).join(' ');
      this.logMessage(`Skeleton path (${centerPoints.length} pts): ${pointsStr}`);
    }

    const renderEndTime = performance.now();
    const totalTime = renderEndTime - renderStartTime;
    this.logMessage(`=== RENDER COMPLETE: total time ${totalTime.toFixed(2)}ms ===`);

    return {
      outlinePath,
      mesh,
      skeletonPath,
      circles // Return sampled circles for debug viz
    };
  }

  /**
   * Skinning Algorithm (Kruppa et al. Section 4)
   * Returns a list of admissible circles that approximate the DBSC envelope.
   * 
   * Uses dense sampling with admissibility check for cusp bridging.
   * With dense circles, tangent lines alone approximate the skin well.
   */
  generateSkinningCircles(tolerance) {
    const skinningStartTime = performance.now();
    
    if (this.controlDisks.length < this.degree + 1) return [];

    const startU = this.knots[this.degree];
    const endU = this.knots[this.controlDisks.length];
    const paramRange = endU - startU;
    
    // Use dense uniform sampling (similar to sampleCurveAdaptive)
    const numSamples = Math.max(100, this.controlDisks.length * 25);
    const paramStep = paramRange / (numSamples - 1);
    
    this.logMessage(`Skinning: parameter range [${startU.toFixed(4)}, ${endU.toFixed(4)}], step=${paramStep.toFixed(6)}`);
    
    let allCircles = [];
    for (let i = 0; i < numSamples; i++) {
      const t = startU + (i / (numSamples - 1)) * paramRange;
      allCircles.push({ t, ...this.evaluateAt(t) });
    }
    
    this.logMessage(`Skinning: ${numSamples} initial uniform samples generated`);
    
    // Log sample distribution details
    const radii = allCircles.map(c => c.radius);
    const minRadius = Math.min(...radii);
    const maxRadius = Math.max(...radii);
    const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    this.logMessage(`Skinning: radius range [${minRadius.toFixed(2)}, ${maxRadius.toFixed(2)}], avg=${avgRadius.toFixed(2)}`);
    
    // Filter out inadmissible circles (cusp bridging)
    // Using the paper's condition: cusp when |r'(t)| >= |C'(t)|
    const circles = [];
    let cuspCount = 0;
    let cuspRanges = []; // Track ranges where cusps were detected
    let currentCuspStart = null;
    let currentRangeSkipped = 0;
    let loggedCusps = 0;
    const maxLoggedCusps = 5; // Only log first few cusp detections in detail

    for (let i = 0; i < allCircles.length; i++) {
      const curr = allCircles[i];

      // Check admissibility using the paper's derivative condition
      const admissible = this.isAdmissibleAt(curr.t, false);

      if (admissible) {
        circles.push(curr);
        if (currentCuspStart !== null) {
          // End of cusp range
          cuspRanges.push({
            start: currentCuspStart,
            end: allCircles[i - 1].t,
            skipped: currentRangeSkipped,
          });
          currentCuspStart = null;
          currentRangeSkipped = 0;
        }
      } else {
        if (currentCuspStart === null) {
          currentCuspStart = curr.t;
          // Log the first detection of this cusp range
          if (loggedCusps < maxLoggedCusps) {
            this.logMessage(`  Cusp detected at i=${i}, t=${curr.t.toFixed(4)}`);
            this.logMessage(`    circle: (${curr.center.x.toFixed(1)},${curr.center.y.toFixed(1)}) r=${curr.radius.toFixed(2)}`);
            // Run with logging to see derivative values
            this.isAdmissibleAt(curr.t, true);
            loggedCusps++;
          }
        }
        cuspCount++;
        currentRangeSkipped++;
      }
    }

    // Close any open cusp range
    if (currentCuspStart !== null) {
      cuspRanges.push({
        start: currentCuspStart,
        end: allCircles[allCircles.length - 1].t,
        skipped: currentRangeSkipped,
      });
    }
    
    // Log cusp details
    if (cuspCount > 0) {
      this.logMessage(`Skinning: bridged ${cuspCount} cusp circles total in ${cuspRanges.length} range(s)`);
      for (let ri = 0; ri < cuspRanges.length; ri++) {
        const range = cuspRanges[ri];
        const paramSpan = range.end - range.start;
        this.logMessage(`  Range ${ri + 1}: t=[${range.start.toFixed(4)}, ${range.end.toFixed(4)}] span=${paramSpan.toFixed(4)}, skipped=${range.skipped} circles`);
      }
    } else {
      this.logMessage(`Skinning: no cusps detected, all ${numSamples} circles admissible`);
    }
    
    // Ensure we have at least start and end circles
    if (circles.length === 0) {
      this.logMessage(`Skinning: WARNING - all circles filtered out! Adding endpoints.`);
      circles.push(allCircles[0]);
      circles.push(allCircles[allCircles.length - 1]);
    } else if (circles.length === 1) {
      // Make sure we have at least 2 circles
      if (circles[0].t < (startU + endU) / 2) {
        circles.push(allCircles[allCircles.length - 1]);
      } else {
        circles.unshift(allCircles[0]);
      }
    }
    
    // Log final circle distribution
    const finalRadii = circles.map(c => c.radius);
    const finalMinR = Math.min(...finalRadii);
    const finalMaxR = Math.max(...finalRadii);
    this.logMessage(`Skinning: ${circles.length} circles after filtering (kept ${(circles.length / numSamples * 100).toFixed(1)}%)`);
    this.logMessage(`Skinning: final radius range [${finalMinR.toFixed(2)}, ${finalMaxR.toFixed(2)}]`);
    
    // Log spacing between consecutive circles
    let minDist = Infinity, maxDist = 0, totalDist = 0;
    for (let i = 0; i < circles.length - 1; i++) {
      const dx = circles[i + 1].center.x - circles[i].center.x;
      const dy = circles[i + 1].center.y - circles[i].center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      minDist = Math.min(minDist, dist);
      maxDist = Math.max(maxDist, dist);
      totalDist += dist;
    }
    const avgDist = totalDist / (circles.length - 1);
    this.logMessage(`Skinning: circle spacing min=${minDist.toFixed(2)}, max=${maxDist.toFixed(2)}, avg=${avgDist.toFixed(2)}`);
    
    const skinningEndTime = performance.now();
    this.logMessage(`Skinning: circle generation completed in ${(skinningEndTime - skinningStartTime).toFixed(2)}ms`);
    
    return circles;
  }

  /**
   * Check if a circle at parameter t is admissible (no cusp).
   * From Kruppa et al.: A cusp occurs when |r'(t)| >= |C'(t)|
   * i.e., when the radius changes faster than the center moves.
   */
  isAdmissibleAt(t, logDetails = false) {
    const deriv = this.evaluateDerivativeAt(t);
    const velocity = Math.sqrt(deriv.x * deriv.x + deriv.y * deriv.y);
    const radiusRate = Math.abs(deriv.radiusRate);
    
    // Cusp occurs when radius changes faster than (or equal to) center velocity
    // We use a small margin to avoid numerical issues at exact equality
    const margin = 0.01; // Small tolerance
    const admissible = radiusRate < velocity * (1 - margin);
    
    if (logDetails) {
      const ratio = velocity > 0 ? radiusRate / velocity : Infinity;
      this.logMessage(`  Admissibility at t=${t.toFixed(4)}: |C'|=${velocity.toFixed(3)}, |r'|=${radiusRate.toFixed(3)}, ratio=${ratio.toFixed(3)}, result=${admissible ? 'ADMISSIBLE' : 'CUSP'}`);
    }
    
    return admissible;
  }

  getCircleTangents(c1, c2) {
    const dx = c2.center.x - c1.center.x;
    const dy = c2.center.y - c1.center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= Math.abs(c1.radius - c2.radius)) {
      // One circle contains the other, no external tangents
      // Or identical circles
      return null;
    }

    const angle = Math.atan2(dy, dx);
    // Angle offset for external tangents
    const offset = Math.acos((c1.radius - c2.radius) / dist);
    
    const t1 = angle + offset;
    const t2 = angle - offset;
    
    return {
      left1: { 
        x: c1.center.x + c1.radius * Math.cos(t1), 
        y: c1.center.y + c1.radius * Math.sin(t1) 
      },
      left2: { 
        x: c2.center.x + c2.radius * Math.cos(t1), 
        y: c2.center.y + c2.radius * Math.sin(t1) 
      },
      right1: { 
        x: c1.center.x + c1.radius * Math.cos(t2), 
        y: c1.center.y + c1.radius * Math.sin(t2) 
      },
      right2: { 
        x: c2.center.x + c2.radius * Math.cos(t2), 
        y: c2.center.y + c2.radius * Math.sin(t2) 
      }
    };
  }

  /**
   * Generate outline path using the original simple perpendicular-normal approach.
   * This matches the original toSVGPath behavior before the analytical envelope was added.
   */
  generateSimpleOutlinePath(circles) {
    if (circles.length < 2) return "";

    const disks = circles;
    const n = this.controlDisks.length - 1;
    const startU = this.knots[this.degree];
    const endU = this.knots[n + 1];
    const parameterStep = (endU - startU) / (disks.length - 1);

    // Calculate normals using simple perpendicular to derivative
    const normals = [];
    for (let i = 0; i < disks.length; i++) {
      const u = disks[i].t !== undefined ? disks[i].t : (startU + i * parameterStep);
      const derivative = disks[i].deriv || this.evaluateDerivativeAt(u);
      const length = Math.sqrt(derivative.x * derivative.x + derivative.y * derivative.y);

      if (length > 0.0001) {
        normals.push({
          x: -derivative.y / length,
          y: derivative.x / length,
        });
      } else {
        // Fall back to previous normal or default
        const prevNormal = i > 0 ? normals[i - 1] : { x: 1, y: 0 };
        normals.push(prevNormal);
      }
    }

    // Generate outline points using simple offset
    const upperPoints = [];
    const lowerPoints = [];

    for (let i = 0; i < disks.length; i++) {
      const disk = disks[i];
      const normal = normals[i];

      upperPoints.push({
        x: disk.center.x + normal.x * disk.radius,
        y: disk.center.y + normal.y * disk.radius,
      });

      lowerPoints.push({
        x: disk.center.x - normal.x * disk.radius,
        y: disk.center.y - normal.y * disk.radius,
      });
    }

    // Get first and last disks for end caps
    const firstDisk = disks[0];
    const lastDisk = disks[disks.length - 1];
    const firstNormal = normals[0];
    const lastNormal = normals[normals.length - 1];

    // Calculate tangent vectors (perpendicular to normals)
    const firstTangent = { x: firstNormal.y, y: -firstNormal.x };
    const lastTangent = { x: lastNormal.y, y: -lastNormal.x };

    // Generate the variable-width path with rounded end caps
    let pathData = "";

    // Start point - add rounded cap if radius > 0
    if (firstDisk.radius > 0 && !this.closed) {
      const upperFirstPoint = upperPoints[0];
      pathData = `M ${upperFirstPoint.x} ${upperFirstPoint.y}`;

      // Add semicircle for start cap
      const lowerFirstPoint = lowerPoints[0];

      // Determine sweep flag based on tangent direction
      const sweepFlag =
        firstTangent.x * (upperFirstPoint.y - lowerFirstPoint.y) -
          firstTangent.y * (upperFirstPoint.x - lowerFirstPoint.x) >
        0
          ? 1
          : 0;

      pathData += ` A ${firstDisk.radius} ${firstDisk.radius} 0 0 ${sweepFlag} ${lowerFirstPoint.x} ${lowerFirstPoint.y}`;
    } else {
      pathData = `M ${upperPoints[0].x} ${upperPoints[0].y} L ${lowerPoints[0].x} ${lowerPoints[0].y}`;
    }

    // Draw the lower edge from start to end
    for (let i = 1; i < lowerPoints.length; i++) {
      pathData += ` L ${lowerPoints[i].x} ${lowerPoints[i].y}`;
    }

    // End point - add rounded cap if radius > 0 and shape is not closed
    if (!this.closed) {
      if (lastDisk.radius > 0) {
        const lowerLastPoint = lowerPoints[lowerPoints.length - 1];
        const upperLastPoint = upperPoints[upperPoints.length - 1];

        // Determine sweep flag based on tangent direction
        const sweepFlag =
          lastTangent.x * (lowerLastPoint.y - upperLastPoint.y) -
            lastTangent.y * (lowerLastPoint.x - upperLastPoint.x) >
          0
            ? 0
            : 1;

        pathData += ` A ${lastDisk.radius} ${lastDisk.radius} 0 0 ${sweepFlag} ${upperLastPoint.x} ${upperLastPoint.y}`;
      } else {
        pathData += ` L ${upperPoints[upperPoints.length - 1].x} ${upperPoints[upperPoints.length - 1].y}`;
      }
    } else {
      // For closed shapes, just connect to last upper point
      pathData += ` L ${upperPoints[upperPoints.length - 1].x} ${upperPoints[upperPoints.length - 1].y}`;
    }

    // Draw the upper edge from end to start
    for (let i = upperPoints.length - 2; i >= 0; i--) {
      pathData += ` L ${upperPoints[i].x} ${upperPoints[i].y}`;
    }

    // Close the path
    pathData += " Z";

    return pathData;
  }

  generateOutlinePath(circles, useTangents = false) {
    if (circles.length < 2) return "";

    if (useTangents) {
      // Skinning path: tangent lines + circular arcs (Kruppa et al.)
      return this.generateSkinningPath(circles);
    }

    // Analytical envelope sampling points (cached by annotateSamples)
    this.annotateSamples(circles);
    const leftPoints = circles.map((c) => c.env.left);
    const rightPoints = circles.map((c) => c.env.right);

    // Construct Path
    let d = "";

    // Start Cap
    d += `M ${leftPoints[0].x} ${leftPoints[0].y}`;

    // Trace Left
    for (let i = 1; i < leftPoints.length; i++) {
      d += ` L ${leftPoints[i].x} ${leftPoints[i].y}`;
    }

    // End Cap
    const last = circles[circles.length - 1];
    if (!this.closed && last.radius > 0) {
      d += this.capArcs(last, leftPoints[leftPoints.length - 1], rightPoints[rightPoints.length - 1], +1);
    } else {
      const endR = rightPoints[rightPoints.length - 1];
      d += ` L ${endR.x} ${endR.y}`;
    }

    // Trace Right Backward
    for (let i = rightPoints.length - 2; i >= 0; i--) {
      d += ` L ${rightPoints[i].x} ${rightPoints[i].y}`;
    }

    // Start Cap
    if (!this.closed && circles[0].radius > 0) {
      d += this.capArcs(circles[0], rightPoints[0], leftPoints[0], -1);
    }

    d += " Z";
    return d;
  }

  /**
   * End-cap path data from `from` to `to` around the cap tip of `circle`.
   * dir=+1 routes through the forward tip (end cap), dir=-1 through the
   * backward tip (start cap).
   *
   * When r' ≠ 0 at an endpoint the two envelope contact points are NOT
   * diametrically opposite, so a single arc with fixed flags picks the wrong
   * side whenever the stroke is tapering (r' < 0). Splitting the cap into two
   * arcs through the tip, with sweep chosen per-arc from the cross product,
   * is correct for any radius rate.
   */
  capArcs(circle, from, to, dir) {
    const cx = circle.center.x;
    const cy = circle.center.y;
    const r = circle.radius;
    if (!(r > 0)) return ` L ${to.x} ${to.y}`;

    const deriv = circle.deriv || this.evaluateDerivativeAt(circle.t ?? 0);
    const len = Math.hypot(deriv.x, deriv.y);
    if (len < 1e-6) {
      // Degenerate tangent: a plain semicircle is the best we can do
      return ` A ${r} ${r} 0 0 1 ${to.x} ${to.y}`;
    }

    const tip = {
      x: cx + dir * (deriv.x / len) * r,
      y: cy + dir * (deriv.y / len) * r,
    };
    const seg = (p1, p2) => {
      // sweep=1 = positive-angle direction in SVG's y-down coordinates
      const cross = (p1.x - cx) * (p2.y - cy) - (p1.y - cy) * (p2.x - cx);
      return ` A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${p2.x} ${p2.y}`;
    };
    return seg(from, tip) + seg(tip, to);
  }

  /**
   * Generate skinning path using external tangent lines between circles.
   * With dense sampling, tangent lines alone approximate the skin well.
   * Only arcs are at the end caps.
   */
  generateSkinningPath(circles) {
    const pathStartTime = performance.now();
    
    if (circles.length < 2) return "";

    // Collect all tangent points
    let leftPoints = [];
    let rightPoints = [];
    let tangentFailures = 0;
    let tangentDetails = [];
    
    for (let i = 0; i < circles.length - 1; i++) {
      const c1 = circles[i];
      const c2 = circles[i+1];
      const tans = this.getCircleTangents(c1, c2);
      
      if (tans) {
        // Use the tangent touch point on circle i for the left/right sides
        if (i === 0) {
          leftPoints.push(tans.left1);
          rightPoints.push(tans.right1);
        }
        // Always add the tangent touch point on circle i+1
        leftPoints.push(tans.left2);
        rightPoints.push(tans.right2);
        
        // Log tangent angle for debugging
        if (this.debug && (i < 3 || i >= circles.length - 4)) {
          const dx = c2.center.x - c1.center.x;
          const dy = c2.center.y - c1.center.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          tangentDetails.push(`seg${i}: dist=${dist.toFixed(2)}, angle=${angle.toFixed(1)}°, r1=${c1.radius.toFixed(2)}, r2=${c2.radius.toFixed(2)}`);
        }
      } else {
        tangentFailures++;
        this.logMessage(`Skinning path: tangent failed at segment ${i} (circle contains other)`);
      }
    }
    
    this.logMessage(`Skinning path: ${leftPoints.length} tangent points from ${circles.length} circles (${tangentFailures} failures)`);
    
    if (tangentDetails.length > 0) {
      this.logMessage(`Skinning path tangent samples: ${tangentDetails.slice(0, 3).join('; ')}...${tangentDetails.slice(-3).join('; ')}`);
    }
    
    if (leftPoints.length < 2) return "";

    let d = "";
    let lineCount = 0;
    let arcCount = 0;
    
    // Start at first left point
    d = `M ${leftPoints[0].x} ${leftPoints[0].y}`;
    
    // Trace left side with lines
    for (let i = 1; i < leftPoints.length; i++) {
      d += ` L ${leftPoints[i].x} ${leftPoints[i].y}`;
      lineCount++;
    }
    
    // End cap (semicircle)
    // For a semicircle (180°), large-arc-flag should be 0
    // Sweep flag determines direction: we need to go from left to right side
    const lastCircle = circles[circles.length - 1];
    if (!this.closed && lastCircle.radius > 0) {
      const lastLeft = leftPoints[leftPoints.length - 1];
      const lastRight = rightPoints[rightPoints.length - 1];
      
      // Determine sweep direction based on the curve direction at the end
      // We want to go around the "outside" of the endpoint
      const lastDeriv = lastCircle.deriv || this.evaluateDerivativeAt(lastCircle.t || 0);
      const endSweep = (lastDeriv.x * (lastRight.y - lastLeft.y) - lastDeriv.y * (lastRight.x - lastLeft.x)) > 0 ? 1 : 0;
      
      d += ` A ${lastCircle.radius} ${lastCircle.radius} 0 0 ${endSweep} ${lastRight.x} ${lastRight.y}`;
      arcCount++;
    } else {
      d += ` L ${rightPoints[rightPoints.length - 1].x} ${rightPoints[rightPoints.length - 1].y}`;
      lineCount++;
    }
    
    // Trace right side backward with lines
    for (let i = rightPoints.length - 2; i >= 0; i--) {
      d += ` L ${rightPoints[i].x} ${rightPoints[i].y}`;
      lineCount++;
    }
    
    // Start cap (semicircle)
    // For a semicircle (180°), large-arc-flag should be 0
    // We're going from firstRight (right side) to firstLeft (left side)
    // This is the reverse direction of the end cap
    const firstCircle = circles[0];
    if (!this.closed && firstCircle.radius > 0) {
      const firstRight = rightPoints[0];
      const firstLeft = leftPoints[0];
      
      // Determine sweep direction - same formula as end cap but with reversed points
      // End cap: lastDeriv.x * (lastRight.y - lastLeft.y) - lastDeriv.y * (lastRight.x - lastLeft.x)
      // Start cap: firstDeriv.x * (firstLeft.y - firstRight.y) - firstDeriv.y * (firstLeft.x - firstRight.x)
      // But we need to flip the sign since we're going the opposite direction
      const firstDeriv = firstCircle.deriv || this.evaluateDerivativeAt(firstCircle.t || 0);
      const startSweep = (firstDeriv.x * (firstLeft.y - firstRight.y) - firstDeriv.y * (firstLeft.x - firstRight.x)) < 0 ? 1 : 0;
      
      d += ` A ${firstCircle.radius} ${firstCircle.radius} 0 0 ${startSweep} ${firstLeft.x} ${firstLeft.y}`;
      arcCount++;
    }
    
    d += " Z";
    
    const pathEndTime = performance.now();
    this.logMessage(`Skinning path: ${lineCount} L commands, ${arcCount} A commands, path length=${d.length} chars`);
    this.logMessage(`Skinning path: generation completed in ${(pathEndTime - pathStartTime).toFixed(2)}ms`);
    
    return d;
  }

  generateMesh(circles) {
    const mesh = [];
    
    // Build quads between consecutive circles (using their envelope/tangent points)
    // For skinning, we should ideally use the tangent points evaluated during the process
    // But evaluating envelope at the circle's 't' is a good approximation if dense.

    this.annotateSamples(circles);

    for (let i = 0; i < circles.length - 1; i++) {
       const c1 = circles[i];
       const c2 = circles[i+1];

       // Calculate interpolated color
       const r = Math.floor((c1.color.r + c2.color.r) / 2 * 255);
       const g = Math.floor((c1.color.g + c2.color.g) / 2 * 255);
       const b = Math.floor((c1.color.b + c2.color.b) / 2 * 255);
       const a = (c1.color.a + c2.color.a) / 2;

       // Boundary points from the cached envelope evaluation
       const e1 = c1.env;
       const e2 = c2.env;
       
       // Create points string with toFixed(2) to keep the SVG string size manageable
       const points = [
         `${e1.left.x.toFixed(2)},${e1.left.y.toFixed(2)}`,
         `${e2.left.x.toFixed(2)},${e2.left.y.toFixed(2)}`,
         `${e2.right.x.toFixed(2)},${e2.right.y.toFixed(2)}`,
         `${e1.right.x.toFixed(2)},${e1.right.y.toFixed(2)}`
       ].join(" ");
       
       const colorStr = `rgba(${r},${g},${b},${a.toFixed(3)})`;
       
       // Add stroke with matching color to prevent anti-aliasing hairlines between segments
       mesh.push(`<polygon points="${points}" fill="${colorStr}" stroke="${colorStr}" stroke-width="0.5" />`);
    }
    
    return mesh;
  }

  /**
   * Generate a colored SVG string using mesh rendering.
   * This method automatically enables tessellation to create variable-color polygons.
   * @param {Object} options - Rendering options
   * @param {string} options.method - Rendering method ('analytical', 'skinning', or 'simple')
   * @param {number} options.tolerance - Tolerance for adaptive sampling
   * @param {boolean} options.drawOutline - Whether to draw the outline path on top
   * @returns {string} SVG string containing the colored mesh
   */
  getColoredSVG(options = {}) {
    const res = this.render({ 
        method: options.method || 'analytical', 
        tessellate: true, 
        tolerance: options.tolerance || 0.5
    });
    
    // Combine all polygons into one group string
    const meshGroup = `<g class="variable-width-mesh">${res.mesh.join('')}</g>`;
    
    // Optional: Add the outline on top if requested
    let outlinePath = "";
    if (options.drawOutline) {
        outlinePath = `<path d="${res.outlinePath}" fill="none" stroke="black" stroke-width="1" />`;
    }

    return meshGroup + outlinePath;
  }

  // Adaptive curvature-based sampling; returns circles tagged with their parameter 't'
  sampleCurveAdaptive(baseNumSamples = 50) {
    const result = [];
    const n = this.controlDisks.length - 1;
    const startU = this.knots[this.degree];
    const endU = this.knots[n + 1];

    const effectiveBaseSamples = Math.max(
      baseNumSamples,
      Math.min(200, Math.round(this.controlDisks.length * 20))
    );

    const uniformSamples = [];
    const curvatures = [];
    let maxCurvature = 0;

    for (let i = 0; i < effectiveBaseSamples; i++) {
      const u = startU + (i / (effectiveBaseSamples - 1)) * (endU - startU);
      const disk = this.evaluateAt(u);
      const curvature = this.calculateCurvatureAt(u);

      uniformSamples.push({ t: u, ...disk });
      curvatures.push(curvature);
      maxCurvature = Math.max(maxCurvature, curvature);
    }

    const adaptiveSamples = [];
    const curvatureThreshold = 0.15;
    const maxExtraSamples = 4;
    
    for (let i = 0; i < uniformSamples.length - 1; i++) {
      adaptiveSamples.push(uniformSamples[i]);

      const normalizedCurvature = maxCurvature > 0 ? curvatures[i] / maxCurvature : 0;
      
      if (normalizedCurvature > curvatureThreshold) {
         const u1 = uniformSamples[i].t;
         const u2 = uniformSamples[i + 1].t;
         const numExtra = Math.floor(normalizedCurvature * maxExtraSamples);
         
         for (let k=1; k<=numExtra; k++) {
             const t = u1 + (k/(numExtra+1)) * (u2-u1);
             adaptiveSamples.push({ t, ...this.evaluateAt(t) });
         }
      }
    }
    adaptiveSamples.push(uniformSamples[uniformSamples.length - 1]);
    
    this.logMessage(
      `Adaptive sampling generated ${adaptiveSamples.length} points from base ${effectiveBaseSamples}`
    );
    
    return adaptiveSamples;
  }
  
  // Keep required legacy helpers
  calculateCurvatureAt(u) {
    const d1 = this.evaluateDerivativeAt(u);
    const epsilon = 0.0001;
    const d2 = this.evaluateDerivativeAt(u + epsilon);
    
    const dx = d1.x, dy = d1.y;
    const ddx = (d2.x - d1.x) / epsilon;
    const ddy = (d2.y - d1.y) / epsilon;
    
    const numerator = Math.abs(dx * ddy - dy * ddx);
    const denominator = Math.pow(dx * dx + dy * dy, 1.5);
    return denominator > 1e-6 ? numerator / denominator : 0;
  }
  
  createSmoothPath(points) {
    if (points.length < 2) return "";
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    return path;
  }
  
  // Legacy adapter - uses 'simple' method to match original behavior
  toSVGPath(numSamples = null) {
      const res = this.render({ method: 'simple' });
      // Map new format to old format expected by demo
      // The demo expects { fillPath, skeletonPath, disks, normals }
      // We need to regenerate normals for the demo viz
      
      // Re-calculate normals for visualization (derivatives cached by render)
      const disks = res.circles;
      const normals = disks.map(d => {
          const deriv = d.deriv || this.evaluateDerivativeAt(d.t);
          const len = Math.sqrt(deriv.x*deriv.x + deriv.y*deriv.y);
          return len > 0 ? { x: -deriv.y/len, y: deriv.x/len } : {x:0, y:0};
      });

      this.logMessage(
        `Generated SVG path with ${disks.length} points using normals and rounded end caps`
      );

      return {
          fillPath: res.outlinePath,
          skeletonPath: res.skeletonPath,
          disks: disks,
          normals: normals
      };
  }
  
  controlDisksToSVG(options = {}) {
     // Copied from original, preserved
    const defaults = {
      lineColor: "gray",
      centerColor: "red",
      textColor: "#333",
      lineWidth: 1,
      dotSize: 3,
    };

    const opts = { ...defaults, ...options };
    let circles = "";

    if (this.controlDisks.length >= 2) {
      let centerline = `<path d="M`;
      this.controlDisks.forEach((disk, index) => {
        if (index === 0) centerline += ` ${disk.center.x} ${disk.center.y}`;
        else centerline += ` L ${disk.center.x} ${disk.center.y}`;
      });
      centerline += `" stroke="${opts.lineColor}" stroke-width="${opts.lineWidth}" stroke-dasharray="2,2" fill="none" />`;
      circles += centerline;
    }

    this.controlDisks.forEach((disk, index) => {
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${disk.radius}" fill="none" stroke="${opts.lineColor}" stroke-dasharray="1,1" stroke-width="0.5" stroke-linecap="rounded" />`;
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${opts.dotSize}" fill="${opts.centerColor}" data-index="${index}" data-type="center" />`;
      circles += `<circle cx="${disk.center.x + disk.radius}" cy="${disk.center.y}" r="${opts.dotSize / 2}" fill="blue" data-index="${index}" data-type="radius" />`;
      circles += `<text x="${disk.center.x + 5}" y="${disk.center.y - 5}" font-size="10" fill="${opts.textColor}">${Math.round(disk.radius)}</text>`;
    });

    return circles;
  }
}

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = { DiskBSpline };
} else {
  window.DiskBSpline = DiskBSpline;
}
