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
   */
  constructor(controlDisks = [], options = {}) {
    this.controlDisks = controlDisks;
    this.degree = options.degree ?? 3;
    this.debug = options.debug ?? false;
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

  /**
   * B-spline basis function
   * @param {number} i - Index of the basis function
   * @param {number} k - Degree of the basis function
   * @param {number} u - Parameter value
   * @returns {number} - Value of the basis function
   */
  basisFunction(i, k, u) {
    // Handle the endpoint case
    if (
      i === this.knots.length - k - 2 &&
      u === this.knots[this.knots.length - 1]
    ) {
      // At the last point, return 1 for the last basis function
      return 1;
    }

    // Base case for recursion
    if (k === 0) {
      // Handle the case where u is exactly at the right endpoint of its interval
      if (u === this.knots[i + 1] && u === this.knots[this.knots.length - 1]) {
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

    // Clamp u to valid range
    const originalU = u;
    u = Math.max(this.knots[this.degree], Math.min(u, this.knots[n + 1]));

    if (originalU !== u) {
      this.logMessage(`Parameter u=${originalU} clamped to u=${u}`);
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
   * Generate a sequence of disks along the B-spline
   * @param {number} numSamples - Number of sample points
   * @returns {Array} - Array of disks along the curve
   */
  sampleCurve(numSamples) {
    if (this.controlDisks.length < this.degree + 1) {
      this.logMessage(
        `ERROR: Not enough control points for the specified degree. Need at least ${
          this.degree + 1
        } points for degree ${this.degree}.`
      );
      // Return some default disks with zero radius to avoid errors
      const defaultDisks = [];
      for (let i = 0; i < 2; i++) {
        defaultDisks.push({
          center: { x: 100 + i * 100, y: 100 },
          radius: 0,
        });
      }
      return defaultDisks;
    }

    const result = [];
    const n = this.controlDisks.length - 1;
    const startU = this.knots[this.degree];
    const endU = this.knots[n + 1];

    this.logMessage(
      `Sampling curve from u=${startU} to u=${endU} with ${numSamples} samples`
    );

    for (let i = 0; i < numSamples; i++) {
      const u = startU + (i / (numSamples - 1)) * (endU - startU);
      result.push(this.evaluateAt(u));
    }

    return result;
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
   * Convert the B-spline to SVG path elements
   * @param {number} numSamples - Number of sample points
   * @param {Object} options - Additional options (unused currently)
   * @returns {Object} - SVG path data including fill path, skeleton path, disks, and normals
   */
  toSVGPath(numSamples = 100, options = {}) {
    const disks = this.sampleCurve(numSamples);

    if (disks.length < 2) {
      this.logMessage(`ERROR: Not enough sample points to create a path`);
      return {
        fillPath: "",
        skeletonPath: "",
        disks: [],
        normals: [],
      };
    }

    // Calculate the centerline of the curve (skeleton path)
    const centerPoints = disks.map((disk) => disk.center);
    const skeletonPath = this.createSmoothPath(centerPoints);

    // We need to calculate the normals to the curve at each point
    const normals = [];

    // First, calculate tangent vectors (finite differences)
    for (let i = 0; i < disks.length; i++) {
      let tangentX, tangentY;

      if (i === 0) {
        // Forward difference for first point
        tangentX = disks[1].center.x - disks[0].center.x;
        tangentY = disks[1].center.y - disks[0].center.y;
      } else if (i === disks.length - 1) {
        // Backward difference for last point
        tangentX = disks[i].center.x - disks[i - 1].center.x;
        tangentY = disks[i].center.y - disks[i - 1].center.y;
      } else {
        // Central difference for interior points
        tangentX = disks[i + 1].center.x - disks[i - 1].center.x;
        tangentY = disks[i + 1].center.y - disks[i - 1].center.y;
      }

      // Normalize the tangent vector
      const length = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
      if (length > 0) {
        tangentX /= length;
        tangentY /= length;
      } else {
        // Default to horizontal if we can't compute
        tangentX = 1;
        tangentY = 0;
        this.logMessage(`WARNING: Zero-length tangent at point ${i}`);
      }

      // Normal is perpendicular to tangent (rotated 90 degrees)
      normals.push({
        x: -tangentY,
        y: tangentX,
      });
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
      // We'll draw a 180-degree arc from the upper point to the lower point
      const lowerFirstPoint = lowerPoints[0];

      // Flip the sweep flag for the start cap to ensure correct orientation
      // For the start cap, we need to consider the direction of the path
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

    // End point - add rounded cap if radius > 0
    if (lastDisk.radius > 0) {
      // Add semicircle for end cap
      // We'll draw a 180-degree arc from the lower point to the upper point
      const lowerLastPoint = lowerPoints[lowerPoints.length - 1];
      const upperLastPoint = upperPoints[upperPoints.length - 1];

      // Determine the arc direction - we want the arc to curve away from the path
      // Use the tangent direction to determine sweep flag
      // We need to ensure we're drawing the outer arc, not the inner arc
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

    // Draw the upper edge from end to start
    for (let i = upperPoints.length - 2; i >= 1; i--) {
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
    this.controlDisks.forEach((disk) => {
      // Disk outline
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${disk.radius}" fill="none" stroke="${opts.lineColor}" stroke-dasharray="2,2" />`;
      // Center point
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${opts.dotSize}" fill="${opts.centerColor}" />`;
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
