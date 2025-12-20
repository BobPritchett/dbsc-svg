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

  basisFunction(i, k, u) {
    if (k === 0) {
      if (!this.closed && u === this.knots[this.knots.length - 1] && i === this.knots.length - k - 2) {
        return 1;
      }
      return u >= this.knots[i] && u < this.knots[i + 1] ? 1 : 0;
    }

    let coeff1 = 0;
    if (this.knots[i + k] - this.knots[i] !== 0) {
      coeff1 = (u - this.knots[i]) / (this.knots[i + k] - this.knots[i]);
    }

    let coeff2 = 0;
    if (this.knots[i + k + 1] - this.knots[i + 1] !== 0) {
      coeff2 = (this.knots[i + k + 1] - u) / (this.knots[i + k + 1] - this.knots[i + 1]);
    }

    return coeff1 * this.basisFunction(i, k - 1, u) + coeff2 * this.basisFunction(i + 1, k - 1, u);
  }

  basisFunctionDerivative(i, k, u) {
    if (k === 0) return 0;

    let coeff1 = 0;
    if (this.knots[i + k] - this.knots[i] !== 0) {
      coeff1 = k / (this.knots[i + k] - this.knots[i]);
    }

    let coeff2 = 0;
    if (this.knots[i + k + 1] - this.knots[i + 1] !== 0) {
      coeff2 = k / (this.knots[i + k + 1] - this.knots[i + 1]);
    }

    return coeff1 * this.basisFunction(i, k - 1, u) - coeff2 * this.basisFunction(i + 1, k - 1, u);
  }

  // Returns { center: {x,y}, radius, color: {r,g,b,a} }
  evaluateAt(u) {
    if (this.controlDisks.length < this.degree + 1) {
      return { center: { x: 0, y: 0 }, radius: 0, color: { r: 0, g: 0, b: 0, a: 1 } };
    }

    const n = this.controlDisks.length - 1;
    
    // For open shapes, handle endpoint exactly to avoid basis function drop-off
    if (!this.closed && u >= this.knots[n + 1] - 1e-9) {
       return this.controlDisks[n];
    }
    
    u = this.clampParameter(u);

    let centerX = 0, centerY = 0, radius = 0;
    let r = 0, g = 0, b = 0, a = 0;
    let totalBasis = 0;

    for (let i = 0; i <= n; i++) {
      const basis = this.basisFunction(i, this.degree, u);
      totalBasis += basis;
      // Optimization: skip if basis is 0 (mostly will be 0)
      if (Math.abs(basis) < 1e-6) continue;

      centerX += basis * this.controlDisks[i].center.x;
      centerY += basis * this.controlDisks[i].center.y;
      radius += basis * this.controlDisks[i].radius;
      
      const col = this.controlDisks[i].color;
      r += basis * col.r;
      g += basis * col.g;
      b += basis * col.b;
      a += basis * col.a;
    }

    // Log if basis functions don't sum to 1 (within floating point error)
    if (Math.abs(totalBasis - 1) > 0.0001) {
      this.logMessage(
        `WARNING: Basis functions sum to ${totalBasis} at u=${u}, should be 1`
      );
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

    const n = this.controlDisks.length - 1;
    // Boundary checks for exact derivatives at endpoints
    if (!this.closed) {
      if (u >= this.knots[n + 1] - 1e-6) {
         // Use finite difference or just fallback to previous small epsilon
         u = this.knots[n + 1] - 1e-4;
      } else if (u <= this.knots[this.degree] + 1e-6) {
         u = this.knots[this.degree] + 1e-4;
      }
    }
    
    u = this.clampParameter(u);

    let dx = 0, dy = 0, dr = 0;
    let totalDerivative = 0;

    for (let i = 0; i <= n; i++) {
      const derivative = this.basisFunctionDerivative(i, this.degree, u);
      totalDerivative += derivative;
      if (Math.abs(derivative) < 1e-6) continue;
      
      dx += derivative * this.controlDisks[i].center.x;
      dy += derivative * this.controlDisks[i].center.y;
      dr += derivative * this.controlDisks[i].radius;
    }

    // Log if derivatives don't sum to 0 (within floating point error)
    if (Math.abs(totalDerivative) > 0.0001) {
      this.logMessage(
        `WARNING: Basis function derivatives sum to ${totalDerivative} at u=${u}, should be 0`
      );
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

  // Calculate the correct analytic envelope points
  evaluateEnvelopeAt(u) {
    const disk = this.evaluateAt(u);
    const deriv = this.evaluateDerivativeAt(u);

    const cx = disk.center.x;
    const cy = disk.center.y;
    const r = disk.radius;
    const dx = deriv.x;
    const dy = deriv.y;
    const dr = deriv.radiusRate;

    const lenSq = dx * dx + dy * dy;
    const len = Math.sqrt(lenSq);

    // Singularity check: if velocity is 0 or r' > velocity (swallowed)
    // For now we just guard against div by zero
    if (len < 1e-6) {
      // Fallback to normal perpendicular to previous motion or default
      return { 
        left: { x: cx, y: cy }, 
        right: { x: cx, y: cy },
        disk 
      };
    }

    // Exact DBSC envelope formula
    // The offset vector has two components: one along tangent, one perpendicular
    // sin(alpha) = -dr / len  (Note: sign depends on definition of r growth)
    // Actually, let's use the property that (P-C).C' = -r*dr
    
    // Check if |dr| > |C'|, which means no real envelope (nested circles)
    // We clamp the ratio to [-1, 1] to avoid NaNs, though technically it means "no envelope"
    let sinAlpha = -dr / len;
    if (sinAlpha > 1) sinAlpha = 1;
    if (sinAlpha < -1) sinAlpha = -1;
    
    const cosAlpha = Math.sqrt(1 - sinAlpha * sinAlpha);

    // Normal vector (perpendicular to C')
    const nx = -dy / len;
    const ny = dx / len;

    // Tangent vector normalized
    const tx = dx / len;
    const ty = dy / len;

    // Envelope points
    // P = C + r * (sinAlpha * T + cosAlpha * N) (Check signs)
    // We want the two sides.
    // Side 1: Angle + alpha_offset
    // Side 2: Angle - alpha_offset
    
    // Correct derivation:
    // The vector from center to contact point is V.
    // V has length r.
    // V . T = -r * dr/|C'|  (Projected on tangent)
    // V . N = +/- r * sqrt(1 - (dr/|C'|)^2) (Projected on normal)
    
    const v_tangent_scale = -dr / len; // This is sinAlpha * r? No, just -dr/len is sinAlpha
    // So component along T is r * (-dr/len)
    
    const compTx = tx * (r * v_tangent_scale);
    const compTy = ty * (r * v_tangent_scale);
    
    const compNx = nx * (r * cosAlpha);
    const compNy = ny * (r * cosAlpha);

    return {
      left: { 
        x: cx + compTx + compNx, 
        y: cy + compTy + compNy 
      },
      right: { 
        x: cx + compTx - compNx, 
        y: cy + compTy - compNy 
      },
      disk
    };
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
    let loggedCusps = 0;
    const maxLoggedCusps = 5; // Only log first few cusp detections in detail
    
    for (let i = 0; i < allCircles.length; i++) {
      const curr = allCircles[i];
      
      // Check admissibility using the paper's derivative condition
      const shouldLogDetails = (currentCuspStart === null && loggedCusps < maxLoggedCusps);
      const admissible = this.isAdmissibleAt(curr.t, false);
      
      if (admissible) {
        circles.push(curr);
        if (currentCuspStart !== null) {
          // End of cusp range
          const rangeCircleCount = cuspCount - (cuspRanges.length > 0 ? cuspRanges.reduce((a, r) => a + r.skipped, 0) : 0);
          cuspRanges.push({ 
            start: currentCuspStart, 
            end: allCircles[i - 1].t, 
            skipped: rangeCircleCount
          });
          currentCuspStart = null;
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
      }
    }
    
    // Close any open cusp range
    if (currentCuspStart !== null) {
      const rangeCircleCount = cuspCount - (cuspRanges.length > 0 ? cuspRanges.reduce((a, r) => a + r.skipped, 0) : 0);
      cuspRanges.push({ 
        start: currentCuspStart, 
        end: allCircles[allCircles.length - 1].t, 
        skipped: rangeCircleCount
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

  refineSegment(c1, c2, tolerance, depth) {
    const maxDepth = 8;
    if (depth > maxDepth) return [];

    const midT = (c1.t + c2.t) / 2;
    const midCircle = { t: midT, ...this.evaluateAt(midT) };

    // 1. Admissibility Check (Cusp Detection)
    // Using the paper's condition: cusp when |r'(t)| >= |C'(t)|
    if (!this.isAdmissibleAt(midT)) {
      // If not admissible (cusp), we DO NOT insert it. 
      // This effectively bridges the cusp.
      return [];
    }

    // 2. Error Check
    // Measure distance from Analytic Envelope at midT to the Skin Segment (tangent line)
    const error = this.measureSkinError(c1, c2, midT);

    if (error > tolerance) {
      // Recurse
      const left = this.refineSegment(c1, midCircle, tolerance, depth + 1);
      const right = this.refineSegment(midCircle, c2, tolerance, depth + 1);
      return [...left, midCircle, ...right];
    }

    return [];
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

  measureSkinError(c1, c2, midT) {
    // 1. Get true envelope point at midT
    const env = this.evaluateEnvelopeAt(midT);
    
    // 2. Get skin line segment at approx location
    // We approximate the skin as the external tangents between c1 and c2.
    // There are two tangents: left and right.
    const tangents = this.getCircleTangents(c1, c2);
    if (!tangents) return 0; // One circle inside another
    
    // Check distances to both left and right tangents
    // Distance from Point P to Line defined by A, B: |(By-Ay)(Ax-Px) - (Bx-Ax)(Ay-Py)| / Length
    
    function distToLine(px, py, x1, y1, x2, y2) {
       const A = px - x1;
       const B = py - y1;
       const C = x2 - x1;
       const D = y2 - y1;
       const dot = A * C + B * D;
       const lenSq = C * C + D * D;
       if (lenSq === 0) return Math.sqrt(A*A + B*B);
       const param = Math.max(0, Math.min(1, dot / lenSq));
       const xx = x1 + param * C;
       const yy = y1 + param * D;
       const dx = px - xx;
       const dy = py - yy;
       return Math.sqrt(dx * dx + dy * dy);
    }
    
    const dLeft = distToLine(env.left.x, env.left.y, 
                             tangents.left1.x, tangents.left1.y, 
                             tangents.left2.x, tangents.left2.y);
                             
    const dRight = distToLine(env.right.x, env.right.y, 
                              tangents.right1.x, tangents.right1.y, 
                              tangents.right2.x, tangents.right2.y);
                              
    return Math.max(dLeft, dRight);
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
      const derivative = this.evaluateDerivativeAt(u);
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
    
    // Analytical envelope sampling points
    let leftPoints = [];
    let rightPoints = [];
    
    for (const c of circles) {
      const env = this.evaluateEnvelopeAt(c.t || 0);
      leftPoints.push(env.left);
      rightPoints.push(env.right);
    }
    
    // Construct Path
    let d = "";
    
    // Start Cap
    d += `M ${leftPoints[0].x} ${leftPoints[0].y}`;

    // Trace Left
    for (let i = 1; i < leftPoints.length; i++) {
      d += ` L ${leftPoints[i].x} ${leftPoints[i].y}`;
    }

    // End Cap
    if (!this.closed && circles[circles.length-1].radius > 0) {
        const last = circles[circles.length-1];
        const endR = rightPoints[rightPoints.length-1];
        d += ` A ${last.radius} ${last.radius} 0 1 0 ${endR.x} ${endR.y}`; 
    } else {
        const endR = rightPoints[rightPoints.length-1];
        d += ` L ${endR.x} ${endR.y}`;
    }

    // Trace Right Backward
    for (let i = rightPoints.length - 2; i >= 0; i--) {
      d += ` L ${rightPoints[i].x} ${rightPoints[i].y}`;
    }

    // Start Cap
    if (!this.closed && circles[0].radius > 0) {
       d += ` A ${circles[0].radius} ${circles[0].radius} 0 1 0 ${leftPoints[0].x} ${leftPoints[0].y}`;
    }
    
    d += " Z";
    return d;
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
      const lastDeriv = this.evaluateDerivativeAt(lastCircle.t || 0);
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
      const firstDeriv = this.evaluateDerivativeAt(firstCircle.t || 0);
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

  /**
   * Calculate the sweep angle for an arc, ensuring we go the shorter way
   * for the left side (CCW generally) and right side (CW generally).
   */
  calculateArcSweep(fromAngle, toAngle, preferCCW) {
    let diff = toAngle - fromAngle;
    
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    
    // For skinning, we usually want the smaller arc on the outside of the curve
    // The sign indicates direction: positive = CCW, negative = CW
    return diff;
  }

  generateMesh(circles) {
    const mesh = [];
    
    // Build quads between consecutive circles (using their envelope/tangent points)
    // For skinning, we should ideally use the tangent points evaluated during the process
    // But evaluating envelope at the circle's 't' is a good approximation if dense.
    
    for (let i = 0; i < circles.length - 1; i++) {
       const c1 = circles[i];
       const c2 = circles[i+1];
       
       // For coloring, we'll interpolate the color at the midpoint of the segment
       const midColor = {
         r: Math.round((c1.color.r + c2.color.r) / 2 * 255),
         g: Math.round((c1.color.g + c2.color.g) / 2 * 255),
         b: Math.round((c1.color.b + c2.color.b) / 2 * 255),
         a: (c1.color.a + c2.color.a) / 2
       };
       
       // Get boundary points
       // Use evaluateEnvelopeAt. 
       // Note: For skinning, we should strictly use the tangent points we found, 
       // but recalculating here keeps code simpler and is consistent with 'Analytical' mode.
       const e1 = this.evaluateEnvelopeAt(c1.t || 0);
       const e2 = this.evaluateEnvelopeAt(c2.t || 0);
       
       // 2 Triangles or 1 Quad
       const points = [
         `${e1.left.x},${e1.left.y}`,
         `${e2.left.x},${e2.left.y}`,
         `${e2.right.x},${e2.right.y}`,
         `${e1.right.x},${e1.right.y}`
       ].join(" ");
       
       const colorStr = `rgba(${midColor.r},${midColor.g},${midColor.b},${midColor.a})`;
       mesh.push(`<polygon points="${points}" fill="${colorStr}" stroke="none" />`);
    }
    
    return mesh;
  }

  // Legacy support for sampleCurveAdaptive
  sampleCurveAdaptive(baseNumSamples = 50, maxNumSamples = 200) {
     // Re-implement or reuse logic but ensure we return objects with 't'
     // The original implementation returned just 'disk' (center, radius).
     // We need 't' for consistency.
     
     // Reuse the logic from original code but add 't'
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
      
      // Re-calculate normals for visualization
      const disks = res.circles;
      const normals = disks.map(d => {
          const deriv = this.evaluateDerivativeAt(d.t);
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
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${disk.radius}" fill="none" stroke="${opts.lineColor}" stroke-dasharray="1,1" stroke-width="1" stroke-linecap="rounded" />`;
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
