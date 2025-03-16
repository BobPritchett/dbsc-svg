/**
 * Point interface representing x,y coordinates
 */
interface Point {
  x: number;
  y: number;
}

/**
 * Control disk interface representing a point with radius
 */
interface ControlDisk {
  center: Point;
  radius: number;
}

/**
 * Normal vector interface
 */
interface Normal {
  x: number;
  y: number;
}

/**
 * Options for creating a DiskBSpline instance
 */
interface DiskBSplineOptions {
  /** Degree of the B-spline (default: 3) */
  degree?: number;
  /** Whether to enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * SVG path data returned by toSVGPath method
 */
interface SVGPathData {
  /** SVG path data for the filled curve */
  fillPath: string;
  /** SVG path data for the skeleton path */
  skeletonPath: string;
  /** Array of disks along the curve */
  disks: ControlDisk[];
  /** Array of normal vectors at each disk */
  normals: Normal[];
}

/**
 * Visual options for control disk rendering
 */
interface ControlDiskOptions {
  /** Color of the control disk outline */
  lineColor?: string;
  /** Color of the control point center */
  centerColor?: string;
  /** Color of the radius label text */
  textColor?: string;
  /** Width of the outline lines */
  lineWidth?: number;
  /** Size of the center point dot */
  dotSize?: number;
}

/**
 * DiskBSpline - A class for generating variable-width curves
 * using B-spline interpolation of disks.
 */
declare class DiskBSpline {
  /**
   * Creates a new DiskBSpline instance
   * @param controlDisks - Array of control disks, each with center (x,y) and radius
   * @param options - Options object
   */
  constructor(controlDisks?: ControlDisk[], options?: DiskBSplineOptions);

  /**
   * Add a control disk to the B-spline
   * @param disk - Control disk with center (x,y) and radius
   */
  addDisk(disk: ControlDisk): void;

  /**
   * Evaluate the B-spline at parameter u
   * @param u - Parameter value
   * @returns Disk at parameter u with center (x,y) and radius
   */
  evaluateAt(u: number): ControlDisk;

  /**
   * Generate a sequence of disks along the B-spline
   * @param numSamples - Number of sample points
   * @returns Array of disks along the curve
   */
  sampleCurve(numSamples: number): ControlDisk[];

  /**
   * Convert the B-spline to SVG path elements
   * @param numSamples - Number of sample points
   * @param options - Additional options (unused currently)
   * @returns SVG path data including fill path, skeleton path, disks, and normals
   */
  toSVGPath(
    numSamples?: number,
    options?: Record<string, unknown>
  ): SVGPathData;

  /**
   * Generate circles for visualizing the control disks
   * @param options - Visual options for control disks
   * @returns SVG elements for control disks
   */
  controlDisksToSVG(options?: ControlDiskOptions): string;
}

export {
  DiskBSpline,
  ControlDisk,
  Point,
  Normal,
  DiskBSplineOptions,
  SVGPathData,
  ControlDiskOptions,
};
