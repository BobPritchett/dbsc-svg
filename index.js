/**
 * DiskBSpline - A class for generating variable-width curves
 * using B-spline interpolation of disks.
 */
class DiskBSpline {
  /**
   * Creates a new DiskBSpline instance
   * @param {Array} controlDisks - Array of control disks, each with center (x,y) and radius
   * @param {Object} options - Options object
   * @param {number} options.degree - Degree of the B-spline (default: 3)
   * @param {boolean} options.debug - Whether to enable debug logging (default: false)
   * @param {boolean} options.closed - Whether the shape should be closed (default: false)
   */
  constructor(controlDisks = [], options = {}) {
    this.degree = options.degree ?? 3;
    this.debug = options.debug ?? false;
    this.closed = options.closed ?? false;

    // For closed shapes, wrap the first degree control points at the end
    if (this.closed && controlDisks.length > this.degree) {
      this.controlDisks = [...controlDisks];
      for (let i = 0; i < this.degree; i++) {
        this.controlDisks.push(controlDisks[i]);
      }
    } else {
      this.controlDisks = controlDisks;
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
          `Last control disk: (${
            controlDisks[controlDisks.length - 1].center.x
          }, ${controlDisks[controlDisks.length - 1].center.y}), r=${
            controlDisks[controlDisks.length - 1].radius
          }`
        );
        this.logMessage(`Shape is ${this.closed ? "closed" : "open"}`);
        if (this.closed) {
          this.logMessage(
            `Wrapped ${this.degree} control points for closed shape`
          );
        }
      }
    }
  }

  /**
   * Log messages to the debug console
   * @param {string} message - Message to log
   */
  logMessage(message) {
    if (!this.debug) return;

    const logElement = document.getElementById("log");
    if (logElement) {
      const logEntry = document.createElement("div");
      logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      logElement.appendChild(logEntry);
      logElement.scrollTop = logElement.scrollHeight;
    }
    console.log(message);
  }

  /**
   * Add a control disk to the B-spline
   * @param {Object} disk - Control disk with center (x,y) and radius
   */
  addDisk(disk) {
    this.controlDisks.push(disk);
    this.generateUniformKnots();
    this.logMessage(
      `Added disk at (${disk.center.x}, ${disk.center.y}) with radius ${disk.radius}`
    );
    this.logMessage(`New knot vector: [${this.knots.join(", ")}]`);
  }

  /**
   * Generate uniform knot vector for the B-spline
   */
  generateUniformKnots() {
    const n = this.controlDisks.length - 1;
    const k = this.degree;

    if (n < k) {
      this.logMessage(
        `WARNING: Not enough control points (${
          n + 1
        }) for the specified degree (${k})`
      );
      return;
    }

    this.knots = [];

    if (this.closed) {
      // For closed shapes, create a periodic knot vector
      const numKnots = this.controlDisks.length + k + 1;
      for (let i = 0; i < numKnots; i++) {
        this.knots.push(i - k);
      }
    } else {
      // Original open shape logic
      for (let i = 0; i <= n + k + 1; i++) {
        if (i < k + 1) {
          this.knots.push(0);
        } else if (i > n) {
          this.knots.push(n - k + 1);
        } else {
          this.knots.push(i - k);
        }
      }
    }

    if (this.debug) {
      this.logMessage(`Generated knot vector: [${this.knots.join(", ")}]`);
    }
  }

  /**
   * B-spline basis function
   * @param {number} i - Index of the basis function
   * @param {number} k - Degree of the basis function
   * @param {number} u - Parameter value
   * @returns {number} - Value of the basis function
   */
  basisFunction(i, k, u) {
    // Base case for recursion
    if (k === 0) {
      // Special case for the endpoint in open shapes
      if (
        !this.closed &&
        u === this.knots[this.knots.length - 1] &&
        i === this.knots.length - k - 2
      ) {
        return 1;
      }
      return u >= this.knots[i] && u < this.knots[i + 1] ? 1 : 0;
    }

    // Calculate the coefficient for the first term
    let coeff1 = 0;
    if (this.knots[i + k] - this.knots[i] !== 0) {
      coeff1 = (u - this.knots[i]) / (this.knots[i + k] - this.knots[i]);
    }

    // Calculate the coefficient for the second term
    let coeff2 = 0;
    if (this.knots[i + k + 1] - this.knots[i + 1] !== 0) {
      coeff2 =
        (this.knots[i + k + 1] - u) /
        (this.knots[i + k + 1] - this.knots[i + 1]);
    }

    // Recursive formula for B-spline basis
    return (
      coeff1 * this.basisFunction(i, k - 1, u) +
      coeff2 * this.basisFunction(i + 1, k - 1, u)
    );
  }

  /**
   * Calculate the derivative of the B-spline basis function
   * @param {number} i - Index of the basis function
   * @param {number} k - Degree of the basis function
   * @param {number} u - Parameter value
   * @returns {number} - Value of the derivative of the basis function
   */
  basisFunctionDerivative(i, k, u) {
    if (k === 0) return 0;

    // Calculate the first term coefficient
    let coeff1 = 0;
    if (this.knots[i + k] - this.knots[i] !== 0) {
      coeff1 = k / (this.knots[i + k] - this.knots[i]);
    }

    // Calculate the second term coefficient
    let coeff2 = 0;
    if (this.knots[i + k + 1] - this.knots[i + 1] !== 0) {
      coeff2 = k / (this.knots[i + k + 1] - this.knots[i + 1]);
    }

    // Use the derivative formula for B-spline basis functions
    return (
      coeff1 * this.basisFunction(i, k - 1, u) -
      coeff2 * this.basisFunction(i + 1, k - 1, u)
    );
  }

  /**
   * Evaluate the B-spline at parameter u
   * @param {number} u - Parameter value
   * @returns {Object} - Disk at parameter u with center (x,y) and radius
   */
  evaluateAt(u) {
    if (this.controlDisks.length < this.degree + 1) {
      this.logMessage(
        `ERROR: Not enough control points (${this.controlDisks.length}) for the specified degree (${this.degree})`
      );
      return { center: { x: 0, y: 0 }, radius: 0 };
    }

    const n = this.controlDisks.length - 1;

    // Handle parameter wrapping for closed shapes or endpoint for open shapes
    if (this.closed) {
      const period = this.knots[n + 1] - this.knots[this.degree];
      u = this.knots[this.degree] + ((u - this.knots[this.degree]) % period);
    } else {
      // For open shapes, handle endpoint exactly
      const originalU = u;
      if (u >= this.knots[n + 1]) {
        // At the endpoint, return the last control point
        return this.controlDisks[n];
      }
      u = Math.max(this.knots[this.degree], Math.min(u, this.knots[n + 1]));

      if (originalU !== u) {
        this.logMessage(`Parameter u=${originalU} clamped to u=${u}`);
      }
    }

    let centerX = 0;
    let centerY = 0;
    let radius = 0;
    let totalBasis = 0;

    // Calculate the weighted sum of control disks
    for (let i = 0; i <= n; i++) {
      const basis = this.basisFunction(i, this.degree, u);
      totalBasis += basis;
      centerX += basis * this.controlDisks[i].center.x;
      centerY += basis * this.controlDisks[i].center.y;
      radius += basis * this.controlDisks[i].radius;
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
    };
  }

  /**
   * Evaluate the derivative of the B-spline at parameter u
   * @param {number} u - Parameter value
   * @returns {Object} - Derivative vector {x, y} and radius change rate
   */
  evaluateDerivativeAt(u) {
    if (this.controlDisks.length < this.degree + 1) {
      return { x: 0, y: 0, radiusRate: 0 };
    }

    const n = this.controlDisks.length - 1;

    // Handle parameter wrapping/clamping
    if (this.closed) {
      const period = this.knots[n + 1] - this.knots[this.degree];
      u = this.knots[this.degree] + ((u - this.knots[this.degree]) % period);
    } else {
      // For open curves, special handling of endpoints
      if (u >= this.knots[n + 1]) {
        // At the end point, use the direction from the second-to-last to last control point
        const last = this.controlDisks[n];
        const secondToLast = this.controlDisks[n - 1];
        const dx = last.center.x - secondToLast.center.x;
        const dy = last.center.y - secondToLast.center.y;
        const dr = last.radius - secondToLast.radius;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0.0001) {
          return {
            x: dx / length,
            y: dy / length,
            radiusRate: dr / length,
          };
        }
      } else if (u <= this.knots[this.degree]) {
        // At the start point, use the direction from first to second control point
        const first = this.controlDisks[0];
        const second = this.controlDisks[1];
        const dx = second.center.x - first.center.x;
        const dy = second.center.y - first.center.y;
        const dr = second.radius - first.radius;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0.0001) {
          return {
            x: dx / length,
            y: dy / length,
            radiusRate: dr / length,
          };
        }
      }
      // Clamp parameter to valid range
      u = Math.max(this.knots[this.degree], Math.min(u, this.knots[n + 1]));
    }

    let dx = 0,
      dy = 0,
      dr = 0;
    let totalDerivative = 0;

    // Calculate the derivative using the chain rule
    for (let i = 0; i <= n; i++) {
      const derivative = this.basisFunctionDerivative(i, this.degree, u);
      totalDerivative += derivative;
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

  /**
   * Calculate curvature at a point using derivatives
   * @param {number} u - Parameter value
   * @returns {number} - Curvature at the point
   */
  calculateCurvatureAt(u) {
    const d1 = this.evaluateDerivativeAt(u);

    // Calculate second derivative using finite differences
    const epsilon = 0.0001;
    const d2 = this.evaluateDerivativeAt(u + epsilon);

    const dx = d1.x;
    const dy = d1.y;
    const ddx = (d2.x - d1.x) / epsilon;
    const ddy = (d2.y - d1.y) / epsilon;

    // Curvature formula: |x'y'' - y'x''| / (x'^2 + y'^2)^(3/2)
    const numerator = Math.abs(dx * ddy - dy * ddx);
    const denominator = Math.pow(dx * dx + dy * dy, 1.5);

    return denominator > 0.0001 ? numerator / denominator : 0;
  }

  /**
   * Generate a sequence of disks along the B-spline with adaptive sampling
   * @param {number} baseNumSamples - Base number of sample points
   * @param {number} maxNumSamples - Maximum number of sample points
   * @returns {Array} - Array of disks along the curve
   */
  sampleCurveAdaptive(baseNumSamples = 50, maxNumSamples = 200) {
    if (this.controlDisks.length < this.degree + 1) {
      this.logMessage(
        `ERROR: Not enough control points for the specified degree. Need at least ${
          this.degree + 1
        } points for degree ${this.degree}.`
      );
      return [];
    }

    const result = [];
    const n = this.controlDisks.length - 1;
    const startU = this.knots[this.degree];
    const endU = this.closed ? this.knots[n + 1] : this.knots[n + 1];

    // First pass: sample uniformly and calculate curvatures
    const uniformSamples = [];
    const curvatures = [];
    let maxCurvature = 0;

    // Increase base sampling for complex curves
    const effectiveBaseSamples = Math.max(
      baseNumSamples,
      Math.min(200, Math.round(this.controlDisks.length * 20))
    );

    for (let i = 0; i < effectiveBaseSamples; i++) {
      const u = startU + (i / (effectiveBaseSamples - 1)) * (endU - startU);
      const disk = this.evaluateAt(u);
      const curvature = this.calculateCurvatureAt(u);

      uniformSamples.push({ u, disk });
      curvatures.push(curvature);
      maxCurvature = Math.max(maxCurvature, curvature);
    }

    // Second pass: add additional samples based on curvature
    const adaptiveSamples = [];
    const curvatureThreshold = 0.15; // Lower threshold to catch more turns
    const maxExtraSamples = 4; // Allow more samples between points
    const minSegmentLength = 0.5; // Minimum length between samples to prevent over-sampling

    for (let i = 0; i < uniformSamples.length - 1; i++) {
      adaptiveSamples.push(uniformSamples[i]);

      const normalizedCurvature =
        maxCurvature > 0 ? curvatures[i] / maxCurvature : 0;

      // Calculate segment length
      const dx =
        uniformSamples[i + 1].disk.center.x - uniformSamples[i].disk.center.x;
      const dy =
        uniformSamples[i + 1].disk.center.y - uniformSamples[i].disk.center.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (
        normalizedCurvature > curvatureThreshold &&
        adaptiveSamples.length < maxNumSamples &&
        segmentLength > minSegmentLength
      ) {
        // Calculate number of extra samples based on both curvature and segment length
        const numExtraSamples = Math.min(
          maxExtraSamples,
          Math.floor(
            normalizedCurvature * maxExtraSamples * (segmentLength / 10)
          )
        );

        const u1 = uniformSamples[i].u;
        const u2 = uniformSamples[i + 1].u;

        for (let j = 1; j <= numExtraSamples; j++) {
          const u = u1 + (j / (numExtraSamples + 1)) * (u2 - u1);
          adaptiveSamples.push({ u, disk: this.evaluateAt(u) });
        }
      }
    }
    adaptiveSamples.push(uniformSamples[uniformSamples.length - 1]);

    this.logMessage(
      `Adaptive sampling generated ${adaptiveSamples.length} points from base ${effectiveBaseSamples}`
    );

    return adaptiveSamples.map((sample) => sample.disk);
  }

  /**
   * Create a path from the sequence of disks
   * @param {Array} points - Array of points along the curve
   * @returns {string} - SVG path string
   */
  createSmoothPath(points) {
    if (points.length < 2) return "";

    // For just 2 points, use a simple line
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    // For more points, we'll create a smooth path
    let path = `M ${points[0].x} ${points[0].y}`;

    // For simplicity, we'll use a Catmull-Rom spline approximation with straight lines
    // This avoids overshooting and self-intersection issues
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }

    return path;
  }

  /**
   * Convert the B-spline to SVG path elements with adaptive sampling
   * @param {number} numSamples - Base number of sample points
   * @param {Object} options - Additional options
   * @returns {Object} - SVG path data including fill path, skeleton path, disks, and normals
   */
  toSVGPath(numSamples = null, options = {}) {
    // Calculate base number of samples if not provided
    if (numSamples === null) {
      let totalLength = 0;
      for (let i = 0; i < this.controlDisks.length - 1; i++) {
        const dx =
          this.controlDisks[i + 1].center.x - this.controlDisks[i].center.x;
        const dy =
          this.controlDisks[i + 1].center.y - this.controlDisks[i].center.y;
        totalLength += Math.sqrt(dx * dx + dy * dy);
      }
      numSamples = Math.min(100, Math.max(50, Math.round(totalLength)));
    }

    // Use adaptive sampling instead of uniform sampling
    const disks = this.sampleCurveAdaptive(numSamples, numSamples * 2);

    if (disks.length < 2) {
      this.logMessage(`ERROR: Not enough sample points to create a path`);
      return {
        fillPath: "",
        skeletonPath: "",
        disks: [],
        normals: [],
      };
    }

    // Calculate the centerline and normals using exact derivatives
    const centerPoints = disks.map((disk) => disk.center);
    const skeletonPath = this.createSmoothPath(centerPoints);
    const normals = [];

    // Calculate valid parameter range
    const n = this.controlDisks.length - 1;
    const startU = this.knots[this.degree];
    const endU = this.knots[n + 1];
    const parameterStep = (endU - startU) / (disks.length - 1);

    // Calculate normals using derivatives
    for (let i = 0; i < disks.length; i++) {
      const u = startU + i * parameterStep;
      const derivative = this.evaluateDerivativeAt(u);
      const length = Math.sqrt(
        derivative.x * derivative.x + derivative.y * derivative.y
      );

      if (length > 0.0001) {
        normals.push({
          x: -derivative.y / length,
          y: derivative.x / length,
        });
      } else {
        // Fall back to previous normal or default if no previous
        const prevNormal = i > 0 ? normals[i - 1] : { x: 1, y: 0 };
        normals.push(prevNormal);
        this.logMessage(
          `WARNING: Zero-length derivative at point ${i}, using fallback normal`
        );
      }
    }

    // Generate the outline points using the normals
    const upperPoints = [];
    const lowerPoints = [];

    for (let i = 0; i < disks.length; i++) {
      const disk = disks[i];
      const normal = normals[i];

      // Calculate upper and lower points
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
    if (firstDisk.radius > 0) {
      // Start at upper point of first disk
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
      // For zero radius, just connect the points directly
      pathData = `M ${upperPoints[0].x} ${upperPoints[0].y} L ${lowerPoints[0].x} ${lowerPoints[0].y}`;
    }

    // Draw the lower edge from start to end
    for (let i = 1; i < lowerPoints.length; i++) {
      pathData += ` L ${lowerPoints[i].x} ${lowerPoints[i].y}`;
    }

    // End point - add rounded cap if radius > 0 and shape is not closed
    if (!this.closed) {
      if (lastDisk.radius > 0) {
        // Add semicircle for end cap
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
        // For zero radius, just connect the points directly
        pathData += ` L ${upperPoints[upperPoints.length - 1].x} ${
          upperPoints[upperPoints.length - 1].y
        }`;
      }
    }

    // Draw the upper edge from end to start
    for (let i = upperPoints.length - 2; i >= 0; i--) {
      pathData += ` L ${upperPoints[i].x} ${upperPoints[i].y}`;
    }

    // Close the path
    pathData += " Z";

    this.logMessage(
      `Generated SVG path with ${disks.length} points using normals and rounded end caps`
    );

    return {
      fillPath: pathData,
      skeletonPath: skeletonPath,
      disks,
      normals,
    };
  }

  /**
   * Generate circles for visualizing the control disks
   * @param {Object} options - Visual options for control disks
   * @returns {string} - SVG elements for control disks
   */
  controlDisksToSVG(options = {}) {
    const defaults = {
      lineColor: "gray",
      centerColor: "red",
      textColor: "#333",
      lineWidth: 1,
      dotSize: 3,
    };

    const opts = { ...defaults, ...options };
    let circles = "";

    // First draw the centerline to better visualize the path
    if (this.controlDisks.length >= 2) {
      let centerline = `<path d="M`;

      this.controlDisks.forEach((disk, index) => {
        if (index === 0) {
          centerline += ` ${disk.center.x} ${disk.center.y}`;
        } else {
          centerline += ` L ${disk.center.x} ${disk.center.y}`;
        }
      });

      centerline += `" stroke="${opts.lineColor}" stroke-width="${opts.lineWidth}" stroke-dasharray="2,2" fill="none" />`;
      circles += centerline;
    }

    // Then draw the control disks
    this.controlDisks.forEach((disk, index) => {
      // Disk outline
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${disk.radius}" fill="none" stroke="${opts.lineColor}" stroke-dasharray="1,1" stroke-width="1" stroke-linecap="rounded" />`;
      // Center point with data attributes
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${opts.dotSize}" fill="${opts.centerColor}" data-index="${index}" data-type="center" />`;
      // Radius handle at 0 degrees with data attributes
      circles += `<circle cx="${disk.center.x + disk.radius}" cy="${
        disk.center.y
      }" r="${
        opts.dotSize / 2
      }" fill="blue" data-index="${index}" data-type="radius" />`;
      // Radius label
      circles += `<text x="${disk.center.x + 5}" y="${
        disk.center.y - 5
      }" font-size="10" fill="${opts.textColor}">${Math.round(
        disk.radius
      )}</text>`;
    });

    return circles;
  }
}

// Export the DiskBSpline class
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = { DiskBSpline };
} else {
  window.DiskBSpline = DiskBSpline;
}
