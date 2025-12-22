/** 1. Corrected B-Spline Logic **/
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

/**
 * BUG FIX: CORRECT BASIS FUNCTION
 * Handles u=1 using the last control point index (n)
 */
function bSplineBasis(i, p, u, U, n) {
  if (p === 0) {
    // Correct check for the interval [U_i, U_{i+1})
    // The last interval is [U_n, U_{n+1}]
    if ((u >= U[i] && u < U[i + 1]) || (u === 1 && i === n)) return 1;
    return 0;
  }
  let l = 0,
    r = 0;
  const d1 = U[i + p] - U[i],
    d2 = U[i + p + 1] - U[i + 1];
  if (d1 !== 0) l = ((u - U[i]) / d1) * bSplineBasis(i, p - 1, u, U, n);
  if (d2 !== 0) r = ((U[i + p + 1] - u) / d2) * bSplineBasis(i + 1, p - 1, u, U, n);
  return l + r;
}

function evalS(u, s) {
  let x = 0,
    y = 0,
    p = 0;
  const n = s.controlPoints.length - 1;
  for (let i = 0; i < s.controlPoints.length; i++) {
    const b = bSplineBasis(i, s.degree, u, s.knots, n);
    x += b * s.controlPoints[i].x;
    y += b * s.controlPoints[i].y;
    p += b * s.controlPoints[i].p;
  }
  return { x, y, p };
}

function fitBSpline(dataPoints, numCPs, degree = 3) {
  let m = dataPoints.length;
  if (m < degree + 1) return null;

  const n = Math.min(numCPs, m) - 1;
  m = m - 1;

  let totalLen = 0;
  const chordLens = [0];
  for (let i = 1; i <= m; i++) {
    totalLen += Vec3.dist(dataPoints[i], dataPoints[i - 1]);
    chordLens.push(totalLen);
  }
  if (totalLen === 0) return null;

  const uBar = chordLens.map((l) => l / totalLen);

  const U = new Array(n + degree + 2).fill(0);
  for (let j = 1; j <= n - degree; j++) U[j + degree] = j / (n - degree + 1);
  for (let j = n + 1; j < U.length; j++) U[j] = 1;

  const startCP = dataPoints[0],
    endCP = dataPoints[m],
    N_mat = [],
    D_mat = [];

  for (let i = 1; i < m; i++) {
    const u = uBar[i],
      b0 = bSplineBasis(0, degree, u, U, n),
      bN = bSplineBasis(n, degree, u, U, n);
    const known = Vec3.add(Vec3.mul(startCP, b0), Vec3.mul(endCP, bN));
    D_mat.push([dataPoints[i].x - known.x, dataPoints[i].y - known.y, dataPoints[i].p - known.p]);
    const row = [];
    for (let j = 1; j < n; j++) row.push(bSplineBasis(j, degree, u, U, n));
    N_mat.push(row);
  }

  const transpose = (mat) => mat[0].map((_, c) => mat.map((r) => r[c]));
  const matMul = (A, B) => {
    const res = Array(A.length)
      .fill(0)
      .map(() => Array(B[0].length).fill(0));
    for (let r = 0; r < A.length; r++)
      for (let c = 0; c < B[0].length; c++)
        for (let k = 0; k < B.length; k++) res[r][c] += A[r][k] * B[k][c];
    return res;
  };

  const NT = transpose(N_mat),
    NTN = matMul(NT, N_mat),
    NTD = matMul(NT, D_mat);

  for (let i = 0; i < NTN.length; i++) NTN[i][i] += 0.1; // Stabilizing Ridge Damping

  const solved = solveLinearSystem(NTN, NTD);
  if (!solved) return null;

  const cps = [startCP];
  solved.forEach((r) => cps.push({ x: r[0], y: r[1], p: Math.max(0, Math.min(1, r[2])) }));
  cps.push(endCP);
  return { degree, knots: U, controlPoints: cps };
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

(function attachToWindow(global) {
  global.PenInputUtils = {
    Vec3,
    simplifyRDP3D,
    solveLinearSystem,
    bSplineBasis,
    evalS,
    fitBSpline,
    getSVGPath,
    getDBSCArray,
  };
})(typeof window !== "undefined" ? window : globalThis);


