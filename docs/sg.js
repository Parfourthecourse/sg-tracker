// Strokes gained engine. Pure functions, no DOM, no network — runs offline on the phone
// and in node for tests. Mirrors the SQL implementation in supabase/migrations.
//
// SG_i = J(start_i) - J(start_{i+1}) - (1 + penalty_i)      (Broadie 2012)
// where J is expected strokes to hole out and J = 0 once holed.

import { PGA_TOUR, BASELINES } from './baselines.js';

export const LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green'];
export const CATEGORIES = ['ott', 'app', 'arg', 'putt'];
export const CATEGORY_LABELS = { ott: 'Off the tee', app: 'Approach', arg: 'Around the green', putt: 'Putting' };

/** Linear interpolation within one lie column; clamps below the first point,
 *  extrapolates the last segment above the final point, floors off-green at 1. */
export function expectedStrokes(lie, distance, baseline = PGA_TOUR) {
  if (distance <= 0) return 0;
  const col = baseline.lies[lie] ?? (lie === 'tee' ? baseline.lies.fairway : null);
  if (!col) throw new Error(`No baseline column for lie "${lie}"`);
  const n = col.length;
  if (distance <= col[0][0]) return col[0][1];
  for (let i = 1; i < n; i++) {
    const [d1, v1] = col[i];
    if (distance <= d1) {
      const [d0, v0] = col[i - 1];
      return v0 + ((distance - d0) / (d1 - d0)) * (v1 - v0);
    }
  }
  const [d0, v0] = col[n - 2];
  const [d1, v1] = col[n - 1];
  const v = v1 + ((distance - d1) / (d1 - d0)) * (v1 - v0);
  return Math.max(v, lie === 'green' ? 1 : 1);
}

/** Tee shots on par 3s use the Tee column but are an approach; short par 4s/5s below
 *  the first tee point (100 yds) fall back to the fairway column. */
function startExpected(shot, par, baseline) {
  if (shot.lie === 'tee' && shot.distance < baseline.lies.tee[0][0]) {
    return expectedStrokes('fairway', shot.distance, baseline);
  }
  return expectedStrokes(shot.lie, shot.distance, baseline);
}

export function categoryOf(shot, par) {
  if (shot.lie === 'green') return 'putt';
  if (shot.lie === 'tee' && shot.shot_no === 1) return par === 3 ? 'app' : 'ott';
  if (shot.within_30 ?? shot.distance <= 30) return 'arg';
  return 'app';
}

/**
 * Score one hole. `shots` is the ordered list of shots on the hole, each
 * { shot_no, lie, distance (yards; feet when lie === 'green'), within_30?, penalty_strokes? }.
 * The last shot is assumed holed. Returns per-shot SG and category totals.
 */
export function scoreHole(shots, par, baseline = PGA_TOUR) {
  const ordered = [...shots].sort((a, b) => a.shot_no - b.shot_no);
  const out = [];
  let strokes = 0;
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const next = ordered[i + 1];
    const penalty = s.penalty_strokes ?? 0;
    const start = startExpected(s, par, baseline);
    const end = next ? startExpected(next, par, baseline) : 0;
    const sg = start - end - (1 + penalty);
    strokes += 1 + penalty;
    out.push({ ...s, start_expected: start, end_expected: end, sg, category: categoryOf(s, par) });
  }
  const totals = { ott: 0, app: 0, arg: 0, putt: 0, total: 0 };
  for (const s of out) { totals[s.category] += s.sg; totals.total += s.sg; }
  const baselineStart = out.length ? out[0].start_expected : 0;
  // Telescoping identity: sum of SG == first-shot baseline - strokes taken.
  const identity_ok = Math.abs(totals.total - (baselineStart - strokes)) < 1e-9;
  return { shots: out, totals, strokes, par, baseline_start: baselineStart, identity_ok };
}

/** Score a whole round: holes is { [hole_no]: { par, shots } }. */
export function scoreRound(holes, baseline = PGA_TOUR) {
  const perHole = {};
  const totals = { ott: 0, app: 0, arg: 0, putt: 0, total: 0 };
  let strokes = 0, par = 0, holesPlayed = 0;
  for (const [hole_no, h] of Object.entries(holes)) {
    if (!h.shots?.length) continue;
    const r = scoreHole(h.shots, h.par, baseline);
    perHole[hole_no] = r;
    for (const k of Object.keys(totals)) totals[k] += r.totals[k];
    strokes += r.strokes; par += h.par; holesPlayed++;
  }
  return { holes: perHole, totals, strokes, par, holes_played: holesPlayed, baseline: baseline.id };
}

export function getBaseline(id) { return BASELINES[id] ?? PGA_TOUR; }

export const round2 = (x) => Math.round(x * 100) / 100;
