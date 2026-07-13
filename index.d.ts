/**
 * Point interface representing x,y coordinates
 */
interface Point {
  x: number;
  y: number;
}

/**
 * Normalized RGBA color (all channels 0..1)
 */
interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Control disk: a center point, radius, and optional color
 */
interface ControlDisk {
  center: Point;
  radius: number;
  /** Optional normalized color; defaults to opaque black */
  color?: RGBA;
}

/**
 * A disk sampled along the curve. `t` is the curve parameter; `deriv` and
 * `env` are cached by the render pipeline after annotateSamples().
 */
interface SampledCircle {
  t: number;
  center: Point;
  radius: number;
  color: RGBA;
  deriv?: Derivative;
  env?: EnvelopePoints;
}

/**
 * First derivative of the curve: center velocity and radius rate of change
 */
interface Derivative {
  x: number;
  y: number;
  radiusRate: number;
}

/**
 * Envelope contact points on either side of the curve
 */
interface EnvelopePoints {
  left: Point;
  right: Point;
}

/**
 * Options for creating a DiskBSpline instance
 */
interface DiskBSplineOptions {
  /** Degree of the B-spline (default: 3) */
  degree?: number;
  /** Whether to enable debug logging (default: false) */
  debug?: boolean;
  /** Whether the shape is closed with periodic continuity (default: false) */
  closed?: boolean;
}

/**
 * Options for the render method
 */
interface RenderOptions {
  /** Outline construction method (default: "analytical") */
  method?: "simple" | "analytical" | "skinning";
  /** Whether to also generate the colored polygon mesh (default: false) */
  tessellate?: boolean;
  /** Sampling tolerance in curve units (default: 0.5) */
  tolerance?: number;
}

/**
 * Result of the render method
 */
interface RenderResult {
  /** SVG path data ("d" attribute) for the filled outline */
  outlinePath: string;
  /** SVG <polygon> strings for the color-interpolated mesh (empty unless tessellate) */
  mesh: string[];
  /** SVG path data for the skeleton (centerline) */
  skeletonPath: string;
  /** The sampled circles used to build the outline */
  circles: SampledCircle[];
}

/**
 * SVG path data returned by the legacy toSVGPath method
 */
interface SVGPathData {
  /** SVG path data for the filled curve */
  fillPath: string;
  /** SVG path data for the skeleton path */
  skeletonPath: string;
  /** Array of disks sampled along the curve */
  disks: SampledCircle[];
  /** Array of unit normal vectors at each disk */
  normals: Point[];
}

/**
 * Visual options for control disk rendering
 */
interface ControlDiskOptions {
  lineColor?: string;
  centerColor?: string;
  textColor?: string;
  lineWidth?: number;
  dotSize?: number;
}

/**
 * DiskBSpline - A class for generating variable-width curves
 * using B-spline interpolation of disks.
 */
declare class DiskBSpline {
  degree: number;
  closed: boolean;
  /** Control disks (for closed shapes, includes the wrapped duplicates) */
  controlDisks: ControlDisk[];
  knots: number[];

  constructor(controlDisks?: ControlDisk[], options?: DiskBSplineOptions);

  /**
   * Append a control disk and regenerate the knot vector.
   * Note: not supported on closed instances (the wrap is built at construction).
   */
  addDisk(disk: ControlDisk): void;

  /** Evaluate the curve at parameter u */
  evaluateAt(u: number): { center: Point; radius: number; color: RGBA };

  /** Evaluate the first derivative at parameter u */
  evaluateDerivativeAt(u: number): Derivative;

  /** Evaluate the envelope contact points (and disk) at parameter u */
  evaluateEnvelopeAt(u: number): EnvelopePoints & { disk: ControlDisk };

  /** Whether the envelope exists at t (no cusp): |r'(t)| < |C'(t)| */
  isAdmissibleAt(t: number, logDetails?: boolean): boolean;

  /** Render the curve to SVG path data (and optionally a colored mesh) */
  render(options?: RenderOptions): RenderResult;

  /** Adaptive curvature-based sampling of the curve */
  sampleCurveAdaptive(baseNumSamples?: number): SampledCircle[];

  /** Colored mesh rendering as a single SVG group string */
  getColoredSVG(options?: {
    method?: RenderOptions["method"];
    tolerance?: number;
    drawOutline?: boolean;
  }): string;

  /** Legacy adapter over render({method:"simple"}) */
  toSVGPath(numSamples?: number | null): SVGPathData;

  /** SVG elements visualizing the control disks */
  controlDisksToSVG(options?: ControlDiskOptions): string;
}

export {
  DiskBSpline,
  ControlDisk,
  Point,
  RGBA,
  SampledCircle,
  Derivative,
  EnvelopePoints,
  DiskBSplineOptions,
  RenderOptions,
  RenderResult,
  SVGPathData,
  ControlDiskOptions,
};
