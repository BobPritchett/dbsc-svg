/**
 * DiskBSpline - A class for generating variable-width curves
 * using B-spline interpolation of disks.
 */
class DiskBSpline {
  /**
   * Creates a new DiskBSpline instance
   * @param {Array} controlDisks - Array of control disks, each with center (x,y) and radius
   * @param {number} degree - Degree of the B-spline (default: 3)
   */
  constructor(controlDisks = [], degree = 3) {
    this.controlDisks = controlDisks;
    this.degree = degree;
    this.knots = [];
    this.generateUniformKnots();

    // Debug logging
    this.logMessage(
      `Created B-spline with ${controlDisks.length} control disks and degree ${degree}`
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

  /**
   * Log messages to the debug console
   * @param {string} message - Message to log
   */
  logMessage(message) {
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

    // Generate the variable-width path using straight lines between points
    // Create the upper edge
    let pathData = `M ${upperPoints[0].x} ${upperPoints[0].y}`;
    for (let i = 1; i < upperPoints.length; i++) {
      pathData += ` L ${upperPoints[i].x} ${upperPoints[i].y}`;
    }

    // Add the lower edge in reverse order
    for (let i = lowerPoints.length - 1; i >= 0; i--) {
      pathData += ` L ${lowerPoints[i].x} ${lowerPoints[i].y}`;
    }

    // Close the path
    pathData += " Z";

    this.logMessage(
      `Generated SVG path with ${disks.length} points using normals`
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
   * @returns {string} - SVG elements for control disks
   */
  controlDisksToSVG() {
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

      centerline += `" stroke="gray" stroke-width="1" stroke-dasharray="5,5" fill="none" />`;
      circles += centerline;
    }

    // Then draw the control disks
    this.controlDisks.forEach((disk, index) => {
      // Disk outline
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="${disk.radius}" fill="none" stroke="gray" stroke-dasharray="5,5" />`;
      // Center point
      circles += `<circle cx="${disk.center.x}" cy="${disk.center.y}" r="3" fill="red" />`;
      // Index label
      circles += `<text x="${disk.center.x + 5}" y="${
        disk.center.y - 5
      }" font-size="10">${index}</text>`;
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
