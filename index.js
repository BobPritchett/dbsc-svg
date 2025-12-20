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
    if (logElement) {
      const logEntry = document.createElement("div");
      logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      logElement.appendChild(logEntry);
      logElement.scrollTop = logElement.scrollHeight;
    }
    console.log(message);
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
    const method = options.method || 'analytical';
    const tessellate = options.tessellate || false;
    const tolerance = options.tolerance || 0.5;

    this.logMessage(`Rendering with method: ${method}, tessellate: ${tessellate}`);

    let circles = [];

    if (method === 'skinning') {
      circles = this.generateSkinningCircles(tolerance);
      this.logMessage(`Skinning generated ${circles.length} circles`);
    } else {
      // Analytical or simple sampling
      circles = this.sampleCurveAdaptive();
      this.logMessage(`Adaptive sampling generated ${circles.length} points`);
    }

    const mesh = tessellate ? this.generateMesh(circles) : [];
    
    // Choose outline generation method
    let outlinePath;
    if (method === 'simple') {
      // Original simple perpendicular-normal approach
      outlinePath = this.generateSimpleOutlinePath(circles);
    } else if (method === 'skinning') {
      // Skinning mode: tangent lines + arcs (Kruppa et al.)
      // Uses sparse circles from iterative refinement
      outlinePath = this.generateSkinningPath(circles);
    } else {
      // Analytical envelope
      outlinePath = this.generateOutlinePath(circles, false);
    }

    // Also return skeleton path for debug
    const centerPoints = circles.map(c => c.center);
    const skeletonPath = this.createSmoothPath(centerPoints);

    // Log skeleton path points
    if (this.debug) {
      const pointsStr = centerPoints.map(pt => `(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`).join(' ');
      this.logMessage(`Skeleton path (${centerPoints.length} pts): ${pointsStr}`);
    }

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
   * Algorithm:
   * 1. Start with circles at knot positions + midpoints (for better initial coverage)
   * 2. Iteratively refine by inserting midpoints where error > tolerance
   * 3. Skip inadmissible circles to bridge cusps
   */
  generateSkinningCircles(tolerance) {
    if (this.controlDisks.length < this.degree + 1) return [];

    const startU = this.knots[this.degree];
    const endU = this.knots[this.controlDisks.length];
    
    // 1. Initial circles at knot positions AND midpoints between knots
    let knotParams = [];
    for (let i = this.degree; i <= this.controlDisks.length; i++) {
      knotParams.push(this.knots[i]);
    }
    // Remove duplicates and sort
    knotParams = [...new Set(knotParams)].sort((a, b) => a - b);
    
    // Add midpoints between knots for better initial coverage
    let initialParams = [];
    for (let i = 0; i < knotParams.length; i++) {
      initialParams.push(knotParams[i]);
      if (i < knotParams.length - 1) {
        initialParams.push((knotParams[i] + knotParams[i + 1]) / 2);
      }
    }
    
    let circles = initialParams.map(t => ({ t, ...this.evaluateAt(t) }));
    this.logMessage(`Skinning: starting with ${circles.length} initial circles`);
    
    // 2. Iterative refinement with tighter tolerance
    // Use smaller tolerance for smoother curves
    const effectiveTolerance = tolerance * 0.5; // Tighter tolerance
    let refined = true;
    let iterations = 0;
    const maxIterations = 10;
    
    while (refined && iterations < maxIterations) {
      refined = false;
      iterations++;
      const newCircles = [circles[0]];
      
      for (let i = 0; i < circles.length - 1; i++) {
        const c1 = circles[i];
        const c2 = circles[i + 1];
        
        // Check error at midpoint
        const midT = (c1.t + c2.t) / 2;
        const midCircle = { t: midT, ...this.evaluateAt(midT) };
        
        // Measure error: distance from true envelope to skin segment
        const error = this.measureSkinError(c1, c2, midT);
        
        // Also check geometric distance between circles
        const dx = c2.center.x - c1.center.x;
        const dy = c2.center.y - c1.center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const avgRadius = (c1.radius + c2.radius) / 2;
        
        // Refine if error too high OR circles too far apart relative to their size
        const needsRefinement = error > effectiveTolerance || dist > avgRadius * 3;
        
        if (needsRefinement) {
          // Check admissibility before inserting
          if (this.isAdmissible(c1, midCircle, c2)) {
            newCircles.push(midCircle);
            refined = true;
          } else {
            // Inadmissible - this is a cusp region, don't insert
            this.logMessage(`Cusp at t=${midT.toFixed(3)}, bridging`);
          }
        }
        
        newCircles.push(c2);
      }
      
      circles = newCircles;
    }
    
    this.logMessage(`Skinning: ${circles.length} circles after ${iterations} refinement iterations`);
    
    return circles;
  }

  refineSegment(c1, c2, tolerance, depth) {
    const maxDepth = 8;
    if (depth > maxDepth) return [];

    const midT = (c1.t + c2.t) / 2;
    const midCircle = { t: midT, ...this.evaluateAt(midT) };

    // 1. Admissibility Check (Cusp Detection)
    // If adding this circle creates a configuration that is "inside" the others,
    // it indicates a self-intersection loop.
    // Simplification: Check if midCircle is largely contained in the skin of c1-c2?
    // Proper check: Radical center.
    if (!this.isAdmissible(c1, midCircle, c2)) {
      // If not admissible, we DO NOT insert it. 
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

  isAdmissible(c1, c2, c3) {
    // Calculate Radical Center P of three circles
    // If P is inside any circle, then the sequence loops back on itself.
    // Power of P wrt circle = d^2 - r^2. If < 0, inside.
    
    // Simplification for stability:
    // Just check if the middle circle is "swallowed" by the others or vice versa?
    // No, standard admissibility is about the boundary order.
    
    // Let's implement the radical center check.
    // Line 1 (Radical axis of 1 & 2): 2x(x2-x1) + 2y(y2-y1) = r1^2 - r2^2 + x2^2 + y2^2 - x1^2 - y1^2
    // A1x + B1y = C1
    
    function getRadicalLine(ca, cb) {
       const A = 2 * (cb.center.x - ca.center.x);
       const B = 2 * (cb.center.y - ca.center.y);
       const C = (ca.radius*ca.radius - cb.radius*cb.radius) + 
                 (cb.center.x*cb.center.x + cb.center.y*cb.center.y) - 
                 (ca.center.x*ca.center.x + ca.center.y*ca.center.y);
       return { A, B, C };
    }
    
    const L1 = getRadicalLine(c1, c2);
    const L2 = getRadicalLine(c2, c3);
    
    // Intersection
    const det = L1.A * L2.B - L2.A * L1.B;
    if (Math.abs(det) < 1e-9) return true; // Parallel axes (concentric centers?) assume valid
    
    const px = (L2.B * L1.C - L1.B * L2.C) / det;
    const py = (L1.A * L2.C - L2.A * L1.C) / det;
    
    // Check power
    // We only need to check one circle as power is equal for all 3 at radical center
    const d2 = (px - c1.center.x)**2 + (py - c1.center.y)**2;
    const r2 = c1.radius * c1.radius;
    
    // If d2 < r2, the radical center is inside the circles -> Inadmissible (loop)
    // We add a small epsilon for stability
    return (d2 - r2) >= -1e-4; 
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
   * Generate proper skinning path with tangent lines AND circular arcs.
   * According to Kruppa et al., the skin consists of:
   * 1. External tangent line segments between consecutive circles
   * 2. Circular arcs on each circle connecting tangent touch points
   */
  generateSkinningPath(circles) {
    if (circles.length < 2) return "";

    // Compute all tangent segments first
    const segments = [];
    for (let i = 0; i < circles.length - 1; i++) {
      const tans = this.getCircleTangents(circles[i], circles[i+1]);
      if (tans) {
        segments.push({
          circle1: circles[i],
          circle2: circles[i+1],
          left1: tans.left1,
          left2: tans.left2,
          right1: tans.right1,
          right2: tans.right2,
          // Store angles for arc computation
          leftAngle1: Math.atan2(tans.left1.y - circles[i].center.y, tans.left1.x - circles[i].center.x),
          leftAngle2: Math.atan2(tans.left2.y - circles[i+1].center.y, tans.left2.x - circles[i+1].center.x),
          rightAngle1: Math.atan2(tans.right1.y - circles[i].center.y, tans.right1.x - circles[i].center.x),
          rightAngle2: Math.atan2(tans.right2.y - circles[i+1].center.y, tans.right2.x - circles[i+1].center.x),
        });
      } else {
        // Fallback: circles overlap, skip this segment
        segments.push(null);
      }
    }

    let d = "";
    
    // === LEFT SIDE (forward) ===
    // Start at first tangent point
    if (segments[0]) {
      d = `M ${segments[0].left1.x} ${segments[0].left1.y}`;
    } else {
      d = `M ${circles[0].center.x} ${circles[0].center.y}`;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;

      // Draw tangent line to circle i+1
      d += ` L ${seg.left2.x} ${seg.left2.y}`;

      // If there's a next segment, draw arc on circle i+1 to connect to next tangent
      if (i < segments.length - 1 && segments[i+1]) {
        const nextSeg = segments[i+1];
        const circle = circles[i+1];
        
        // Check distance between tangent points
        const dx = nextSeg.left1.x - seg.left2.x;
        const dy = nextSeg.left1.y - seg.left2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Only draw arc if points are far enough apart (> 5% of circle radius)
        if (dist > circle.radius * 0.05) {
          const arcSweep = this.calculateArcSweep(seg.leftAngle2, nextSeg.leftAngle1, true);
          const largeArc = Math.abs(arcSweep) > Math.PI ? 1 : 0;
          const sweepFlag = arcSweep > 0 ? 1 : 0;
          d += ` A ${circle.radius} ${circle.radius} 0 ${largeArc} ${sweepFlag} ${nextSeg.left1.x} ${nextSeg.left1.y}`;
        }
      }
    }

    // === END CAP ===
    const lastCircle = circles[circles.length - 1];
    const lastSeg = segments[segments.length - 1];
    
    if (!this.closed && lastCircle.radius > 0 && lastSeg) {
      // Semicircular end cap from left2 to right2
      d += ` A ${lastCircle.radius} ${lastCircle.radius} 0 1 0 ${lastSeg.right2.x} ${lastSeg.right2.y}`;
    } else if (lastSeg) {
      d += ` L ${lastSeg.right2.x} ${lastSeg.right2.y}`;
    }

    // === RIGHT SIDE (backward) ===
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (!seg) continue;

      // Draw tangent line back to circle i
      d += ` L ${seg.right1.x} ${seg.right1.y}`;

      // If there's a previous segment, draw arc on circle i to connect to previous tangent
      if (i > 0 && segments[i-1]) {
        const prevSeg = segments[i-1];
        const circle = circles[i];
        
        // Check distance between tangent points
        const dx = prevSeg.right2.x - seg.right1.x;
        const dy = prevSeg.right2.y - seg.right1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Only draw arc if points are far enough apart (> 5% of circle radius)
        if (dist > circle.radius * 0.05) {
          const arcSweep = this.calculateArcSweep(seg.rightAngle1, prevSeg.rightAngle2, false);
          const largeArc = Math.abs(arcSweep) > Math.PI ? 1 : 0;
          const sweepFlag = arcSweep > 0 ? 1 : 0;
          d += ` A ${circle.radius} ${circle.radius} 0 ${largeArc} ${sweepFlag} ${prevSeg.right2.x} ${prevSeg.right2.y}`;
        }
      }
    }

    // === START CAP ===
    const firstCircle = circles[0];
    const firstSeg = segments[0];
    
    if (!this.closed && firstCircle.radius > 0 && firstSeg) {
      // Semicircular start cap from right1 back to left1
      d += ` A ${firstCircle.radius} ${firstCircle.radius} 0 1 0 ${firstSeg.left1.x} ${firstSeg.left1.y}`;
    }

    d += " Z";
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
