/** PenInputUtils
 *
 * This file implements:
 * - RDP simplification in (x,y,p) space
 * - B-spline least-squares approximation for pen strokes
 *
 * The B-spline fitting logic is aligned with the reference implementation from
 * `mirsaeedi/spline-curve-fitting` (BasisFunction + DeBoorAverageApproximationStrategy),
 * adapted to our 3D points (x,y,p) and with no external math dependencies.
 */

/** 1) Vector helpers **/
const Vec3 = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, p: a.p - b.p }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, p: a.p + b.p }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s, p: a.p * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.p * b.p,
  magSq: (a) => a.x * a.x + a.y * a.y + a.p * a.p,
  dist: (a, b) => Math.sqrt(Vec3.magSq(Vec3.sub(a, b))),
};

function simplifyRDP3D(points, epsilon, pWeight) {
  if (points.length < 3) return points;
  const weighted = points.map((pt) => ({ x: pt.x, y: pt.y, p: pt.p * pWeight }));
  const mask = new Array(points.length).fill(true);

  function recurse(start, end) {
    const first = weighted[start],
      last = weighted[end];
    let maxDist = 0,
      index = 0;
    const segment = Vec3.sub(last, first),
      segLenSq = Vec3.magSq(segment);

    for (let i = start + 1; i < end; i++) {
      const current = weighted[i];
      const dist =
        segLenSq === 0
          ? Vec3.dist(current, first)
          : Vec3.dist(
              current,
              Vec3.add(
                first,
                Vec3.mul(
                  segment,
                  Math.max(
                    0,
                    Math.min(1, Vec3.dot(Vec3.sub(current, first), segment) / segLenSq),
                  ),
                ),
              ),
            );
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      recurse(start, index);
      recurse(index, end);
    } else {
      for (let i = start + 1; i < end; i++) mask[i] = false;
    }
  }

  recurse(0, weighted.length - 1);
  return points.filter((_, i) => mask[i]);
}

/** 2) Linear solver **/
function solveLinearSystem(A, B) {
  const n = A.length,
    M = A.map((row, i) => [...row, ...B[i]]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    if (Math.abs(M[maxRow][i]) < 1e-15) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j < M[0].length; j++) M[k][j] -= factor * M[i][j];
    }
  }

  const x = Array(n)
    .fill(0)
    .map(() => Array(B[0].length).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let col = 0; col < B[0].length; col++) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += M[i][j] * x[j][col];
      x[i][col] = (M[i][n + col] - sum) / M[i][i];
    }
  }
  return x;
}

/** 3) Parameterization + knots + basis (ported style from spline-curve-fitting) **/

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getParametersCentripetal(dataPoints, alpha = 0.5) {
  // Equivalent to vendor's ParameterSelectionStrategies.CentripetalStrategy
  // parameters[0]=0, parameters[n]=1
  const n = dataPoints.length - 1;
  if (n <= 0) return [0];

  const params = new Array(n + 1);
  params[0] = 0;

  let total = 0;
  const acc = new Array(n);
  for (let k = 1; k <= n; k++) {
    const len = distance2D(dataPoints[k], dataPoints[k - 1]);
    const dk = Math.pow(len, alpha);
    total += dk;
    acc[k - 1] = total;
  }
  if (total <= 0) {
    for (let i = 0; i <= n; i++) params[i] = i / n;
    params[n] = 1;
    return params;
  }
  for (let k = 1; k < n; k++) params[k] = acc[k - 1] / total;
  params[n] = 1;
  return params;
}

function getKnotsDeBoorAverageApproximation(order, h, parameters, fittingMode = "approximation") {
  // Equivalent to vendor's KnotSelectionStrategies.DeboorAverageApproximationStrategy
  // order here is "p" in vendor code (degree)
  const p = order;
  const n = parameters.length - 1; // data points count - 1
  const knots = [];

  for (let i = 0; i < p + 1; i++) knots.push(0);

  if (fittingMode === "interpolation") {
    for (let j = 1; j <= h - p; j++) {
      let sum = 0;
      for (let i = j; i <= j + p - 1; i++) sum += parameters[i];
      knots.push(sum / p);
    }
  } else {
    // approximation
    const d = (n + 1) / (h - p + 1);
    for (let i = 1; i <= h - p; i++) {
      const jd = i * d;
      const j = Math.floor(jd);
      const alpha = jd - j;
      // guard: j-1 and j must be valid indices
      const j0 = Math.max(1, Math.min(n, j)); // ensure >=1 so j-1 exists (vendor assumes)
      const prev = parameters[j0 - 1];
      const next = parameters[j0];
      knots.push(prev + alpha * (next - prev));
    }
  }

  for (let i = 0; i < p + 1; i++) knots.push(1);
  return knots;
}

function BasisFunction(knots) {
  // Equivalent to vendor's BasisFunction.compute(t,i,p), iterative (no recursion).
  this.compute = function (t, i, p) {
    const m = knots.length - 1;
    const N = [];

    if (i === 0 && t === knots[0]) return 1;
    if (i === m - p - 1 && t === knots[m]) return 1;

    if (t < knots[i] || t >= knots[i + p + 1]) return 0;

    for (let j = 0; j <= p; j++) {
      if (t >= knots[i + j] && t < knots[i + j + 1]) N.push(1.0);
      else N.push(0.0);
    }

    let saved = 0.0;
    for (let k = 1; k <= p; k++) {
      if (N[0] === 0.0) saved = 0.0;
      else {
        const denom0 = knots[i + k] - knots[i];
        saved = denom0 === 0 ? 0.0 : ((t - knots[i]) * N[0]) / denom0;
      }

      for (let j = 0; j < p - k + 1; j++) {
        const left = knots[i + j + 1];
        const right = knots[i + j + k + 1];

        if (N[j + 1] === 0.0) {
          N[j] = saved;
          saved = 0.0;
        } else {
          const denom = right - left;
          const temp = denom === 0 ? 0.0 : N[j + 1] / denom;
          N[j] = saved + (right - t) * temp;
          saved = (t - left) * temp;
        }
      }
    }

    return N[0];
  };
}

/** 4) De Boor evaluation (adapted to x,y,p) **/
function findRangeIndex(t, knots) {
  for (let i = 0; i < knots.length; i++) {
    if (knots[i] > t) return i - 1;
    if (t === 1 && knots[i + 1] === 1) return i;
  }
  return knots.length - 2;
}

function deboorEval(t, order, controlPoints, knots) {
  const k = findRangeIndex(t, knots);
  const p = order;

  // Copy control points into local d[0..p]
  const d = [];
  for (let i = 0; i <= p; i++) {
    const idx = k - p + i;
    if (idx >= 0 && idx < controlPoints.length) d.push({ ...controlPoints[idx] });
    else d.push({ x: 0, y: 0, p: 0 });
  }

  // Vendor-style loops, adapted to Vec3
  for (let r = 1; r <= p; r++) {
    for (let i = k - p + r; i <= k; i++) {
      const denom = knots[i + p - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;

      const di = i - (k - p + r);
      d[di] = Vec3.add(Vec3.mul(d[di], 1 - alpha), Vec3.mul(d[di + 1], alpha));
    }
  }
  return d[0];
}

function evalS(u, s) {
  if (!s) return { x: 0, y: 0, p: 0 };
  const t = Math.max(0, Math.min(1, u));
  const pt = deboorEval(t, s.degree, s.controlPoints, s.knots);
  // Clamp pressure into [0..1] for downstream stroke-width mapping
  return { x: pt.x, y: pt.y, p: Math.max(0, Math.min(1, pt.p)) };
}

function fitBSpline(dataPoints, numCPs, degree = 3) {
  const n = dataPoints.length - 1; // data points count - 1 (vendor uses n)
  if (n < degree) return null;

  const h = Math.min(Math.max(numCPs, degree + 1), dataPoints.length) - 1; // control points count - 1
  if (h < degree) return null;
  if (h >= n) {
    // If we're not reducing points, do a safer interpolation-ish fallback by using the points as CPs.
    // (Still build a reasonable knot vector for evaluation.)
    const params = getParametersCentripetal(dataPoints, 0.5);
    const knots = getKnotsDeBoorAverageApproximation(degree, n, params, "interpolation");
    return { degree, knots, controlPoints: dataPoints.map((p) => ({ ...p })) };
  }

  const parameters = getParametersCentripetal(dataPoints, 0.5);
  const knots = getKnotsDeBoorAverageApproximation(degree, h, parameters, "approximation");
  const basisFunction = new BasisFunction(knots);

  // N matrix: (n-1) x (h-1), i=1..n-1, j=1..h-1
  const rows = n - 1;
  const cols = h - 1;
  if (rows <= 0 || cols <= 0) return null;

  const N = Array(rows)
    .fill(0)
    .map(() => Array(cols).fill(0));

  // qk vectors (per data point k=1..n-1), subtract endpoint contributions
  const q = Array(rows)
    .fill(0)
    .map(() => ({ x: 0, y: 0, p: 0 }));

  for (let i = 1; i < n; i++) {
    const t = parameters[i];
    const b0 = basisFunction.compute(t, 0, degree);
    const bH = basisFunction.compute(t, h, degree);
    q[i - 1] = {
      x: dataPoints[i].x - b0 * dataPoints[0].x - bH * dataPoints[n].x,
      y: dataPoints[i].y - b0 * dataPoints[0].y - bH * dataPoints[n].y,
      p: dataPoints[i].p - b0 * dataPoints[0].p - bH * dataPoints[n].p,
    };
  }

  for (let i = 1; i < n; i++) {
    const t = parameters[i];
    for (let j = 1; j < h; j++) {
      N[i - 1][j - 1] = basisFunction.compute(t, j, degree);
    }
  }

  // Build NTN and Q = N^T * q
  const NTN = Array(cols)
    .fill(0)
    .map(() => Array(cols).fill(0));
  const Q = Array(cols)
    .fill(0)
    .map(() => [0, 0, 0]); // [x,y,p]

  for (let r = 0; r < rows; r++) {
    const Nr = N[r];
    const qr = q[r];

    for (let c1 = 0; c1 < cols; c1++) {
      const v1 = Nr[c1];
      Q[c1][0] += v1 * qr.x;
      Q[c1][1] += v1 * qr.y;
      Q[c1][2] += v1 * qr.p;

      for (let c2 = 0; c2 < cols; c2++) {
        NTN[c1][c2] += v1 * Nr[c2];
      }
    }
  }

  // Ridge regularization + sanity checks:
  // The normal equations (N^T N) can get ill-conditioned, which may produce
  // extremely large (nonsensical) control points even if the curve still mostly fits.
  // We retry with progressively stronger diagonal regularization until control points
  // are within a reasonable bounding box of the input.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of dataPoints) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const rangeX = Number.isFinite(maxX - minX) ? maxX - minX : 0;
  const rangeY = Number.isFinite(maxY - minY) ? maxY - minY : 0;
  // Margin was previously too permissive and allowed unstable outliers to slip through.
  // Keep this generous enough for smoothing overshoot, but not "multiple screens".
  const margin = Math.max(30, 1.5 * Math.max(rangeX, rangeY));
  const boundMinX = minX - margin,
    boundMaxX = maxX + margin;
  const boundMinY = minY - margin,
    boundMaxY = maxY + margin;

  const isReasonableCP = (cp) =>
    Number.isFinite(cp?.x) &&
    Number.isFinite(cp?.y) &&
    cp.x >= boundMinX &&
    cp.x <= boundMaxX &&
    cp.y >= boundMinY &&
    cp.y <= boundMaxY;

  let diagScale = 0;
  for (let i = 0; i < cols; i++) diagScale = Math.max(diagScale, Math.abs(NTN[i][i]));
  // Use a materially stronger base lambda; the normal equations can be quite ill-conditioned.
  const baseLambda = Math.max(1e-6, diagScale * 1e-4);
  const multipliers = [1, 10, 100, 1000, 10000, 100000, 1000000];

  let best = null;
  let bestScore = Infinity;

  const boundsScore = (cp) => {
    // 0 means inside bounds; positive is distance outside (in px) along the worst axis
    const dx = cp.x < boundMinX ? boundMinX - cp.x : cp.x > boundMaxX ? cp.x - boundMaxX : 0;
    const dy = cp.y < boundMinY ? boundMinY - cp.y : cp.y > boundMaxY ? cp.y - boundMaxY : 0;
    return Math.max(dx, dy);
  };

  for (const mult of multipliers) {
    const lambda = baseLambda * mult;
    const NTNreg = NTN.map((row, r) => row.map((v, c) => (r === c ? v + lambda : v)));
    const solved = solveLinearSystem(NTNreg, Q);
    if (!solved) continue;

    const controlPoints = [{ ...dataPoints[0] }];
    let ok = true;
    let score = 0;
    for (let j = 0; j < cols; j++) {
      const cp = { x: solved[j][0], y: solved[j][1], p: Math.max(0, Math.min(1, solved[j][2])) };
      if (!isReasonableCP(cp)) ok = false;
      score = Math.max(score, boundsScore(cp));
      controlPoints.push(cp);
    }
    controlPoints.push({ ...dataPoints[n] });

    if (score < bestScore) {
      bestScore = score;
      best = { degree, knots, controlPoints, params: parameters };
    }
    if (ok) return { degree, knots, controlPoints, params: parameters };
  }

  return best;
}

/** 2. Clean Export Helpers **/
function getSVGPath(spline) {
  if (!spline) return "";
  const samples = 150;
  // Evaluate starting exactly at u=0
  const start = evalS(0, spline);
  let path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  for (let i = 1; i <= samples; i++) {
    const pt = evalS(i / samples, spline);
    path += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }
  return path;
}

function getDBSCArray(spline, maxStrokeWidthPx = 30) {
  if (!spline) return "";
  const maxW = Math.max(1, maxStrokeWidthPx);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  return spline.controlPoints
    .map((cp) => {
      const w = 1 + clamp01(cp.p) * (maxW - 1);
      return `${cp.x.toFixed(1)},${cp.y.toFixed(1)},${w.toFixed(2)}`;
    })
    .join("\n");
}

function computeMaxDistanceErrorXY(spline, dataPoints, parameters) {
  if (!spline || !Array.isArray(dataPoints) || dataPoints.length < 2) return 0;
  const params = parameters || spline.params || getParametersCentripetal(dataPoints, 0.5);
  let max = 0;
  // Ignore endpoints (they're constrained)
  for (let i = 1; i < Math.min(dataPoints.length - 1, params.length - 1); i++) {
    const t = params[i];
    const pt = deboorEval(t, spline.degree, spline.controlPoints, spline.knots);
    const d = Math.hypot(pt.x - dataPoints[i].x, pt.y - dataPoints[i].y);
    if (d > max) max = d;
  }
  return max;
}

/** Debug formatting helper **/
function formatPointList(points, opts = {}) {
  const { xyDecimals = 1, pDecimals = 2 } = opts || {};
  if (!Array.isArray(points) || points.length === 0) return "";
  return points
    .map((pt, i) => {
      const x = Number.isFinite(pt?.x) ? pt.x.toFixed(xyDecimals) : "NaN";
      const y = Number.isFinite(pt?.y) ? pt.y.toFixed(xyDecimals) : "NaN";
      const p = Number.isFinite(pt?.p) ? pt.p.toFixed(pDecimals) : "NaN";
      return `${i}: {x:${x}, y:${y}, p:${p}}`;
    })
    .join("\n");
}

(function attachToWindow(global) {
  global.PenInputUtils = {
    Vec3,
    simplifyRDP3D,
    solveLinearSystem,
    BasisFunction,
    getParametersCentripetal,
    getKnotsDeBoorAverageApproximation,
    deboorEval,
    evalS,
    fitBSpline,
    getSVGPath,
    getDBSCArray,
    computeMaxDistanceErrorXY,
    formatPointList,
  };
})(typeof window !== "undefined" ? window : globalThis);


