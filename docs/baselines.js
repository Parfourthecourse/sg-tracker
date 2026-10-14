// Expected strokes to hole out, by lie and distance.
// Long game: Broadie (2012), "Assessing Golfer Performance on the PGA TOUR",
// Interfaces, Table 9 (ShotLink 2003–2010). Distances in yards.
// Putting: Broadie, Every Shot Counts (PGA Tour and 90-golfer tables). Distances in feet.
// Format: lie -> array of [distance, expectedStrokes], ascending by distance.

export const PGA_TOUR = {
  id: 'pga_tour',
  name: 'PGA Tour',
  source: 'https://business.columbia.edu/sites/default/files-efs/pubfiles/4996/assessing_golfer_performance.full.pdf',
  lies: {
    tee: [
      [100, 2.92], [120, 2.99], [140, 2.97], [160, 2.99], [180, 3.05], [200, 3.12],
      [220, 3.17], [240, 3.25], [260, 3.45], [280, 3.65], [300, 3.71], [320, 3.79],
      [340, 3.86], [360, 3.92], [380, 3.96], [400, 3.99], [420, 4.02], [440, 4.08],
      [460, 4.17], [480, 4.28], [500, 4.41], [520, 4.54], [540, 4.65], [560, 4.74],
      [580, 4.79], [600, 4.82],
    ],
    fairway: [
      [10, 2.18], [20, 2.40], [30, 2.52], [40, 2.60], [50, 2.66], [60, 2.70], [70, 2.72],
      [80, 2.75], [90, 2.77], [100, 2.80], [120, 2.85], [140, 2.91], [160, 2.98],
      [180, 3.08], [200, 3.19], [220, 3.32], [240, 3.45], [260, 3.58], [280, 3.69],
      [300, 3.78], [320, 3.84], [340, 3.88], [360, 3.95], [380, 4.03], [400, 4.11],
      [420, 4.19], [440, 4.27], [460, 4.34], [480, 4.42], [500, 4.50], [520, 4.58],
      [540, 4.66], [560, 4.74], [580, 4.82], [600, 4.89],
    ],
    rough: [
      [10, 2.34], [20, 2.59], [30, 2.70], [40, 2.78], [50, 2.87], [60, 2.91], [70, 2.93],
      [80, 2.96], [90, 2.99], [100, 3.02], [120, 3.08], [140, 3.15], [160, 3.23],
      [180, 3.31], [200, 3.42], [220, 3.53], [240, 3.64], [260, 3.74], [280, 3.83],
      [300, 3.90], [320, 3.95], [340, 4.02], [360, 4.11], [380, 4.21], [400, 4.30],
      [420, 4.40], [440, 4.49], [460, 4.58], [480, 4.68], [500, 4.77], [520, 4.87],
      [540, 4.96], [560, 5.06], [580, 5.15], [600, 5.25],
    ],
    sand: [
      [10, 2.43], [20, 2.53], [30, 2.66], [40, 2.82], [50, 2.92], [60, 3.15], [70, 3.21],
      [80, 3.24], [90, 3.24], [100, 3.23], [120, 3.21], [140, 3.22], [160, 3.28],
      [180, 3.40], [200, 3.55], [220, 3.70], [240, 3.84], [260, 3.93], [280, 4.00],
      [300, 4.04], [320, 4.12], [340, 4.26], [360, 4.41], [380, 4.55], [400, 4.69],
      [420, 4.83], [440, 4.97], [460, 5.11], [480, 5.25], [500, 5.40], [520, 5.54],
      [540, 5.68], [560, 5.82], [580, 5.96], [600, 6.10],
    ],
    recovery: [
      [10, 3.45], [20, 3.51], [30, 3.57], [40, 3.71], [50, 3.79], [60, 3.83], [70, 3.84],
      [80, 3.84], [90, 3.82], [100, 3.80], [120, 3.78], [140, 3.80], [160, 3.81],
      [180, 3.82], [200, 3.87], [220, 3.92], [240, 3.97], [260, 4.03], [280, 4.10],
      [300, 4.20], [320, 4.31], [340, 4.44], [360, 4.56], [380, 4.66], [400, 4.75],
      [420, 4.84], [440, 4.94], [460, 5.03], [480, 5.13], [500, 5.22], [520, 5.32],
      [540, 5.41], [560, 5.51], [580, 5.60], [600, 5.70],
    ],
    // feet
    green: [
      [1, 1.001], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42],
      [8, 1.50], [9, 1.56], [10, 1.61], [15, 1.78], [20, 1.87], [30, 1.98], [40, 2.06],
      [50, 2.14], [60, 2.21], [90, 2.40],
    ],
  },
};

// Broadie's 90-golfer putting table (Every Shot Counts), used to shape the putting gap below.
const GOLFER_90_GREEN = [
  [1, 1.01], [2, 1.06], [3, 1.17], [4, 1.36], [5, 1.51], [6, 1.62], [7, 1.69],
  [8, 1.75], [9, 1.79], [10, 1.82], [15, 1.94], [20, 2.02], [30, 2.16], [40, 2.30],
  [50, 2.41], [60, 2.51], [90, 2.75],
];

// ---- Estimated handicap baselines ----------------------------------------------------
// No complete amateur expected-strokes tables are published, so these are PROJECTIONS:
// expected_h(lie, d) = tour(lie, d) + (h / 18) * gap18(lie, d)
// where gap18 is the extra strokes an ~18-handicap (Broadie's "90-golfer") needs from each
// position. Anchors: Broadie's 90-golfer tee fit 2.79 + 0.0066d vs pro 2.38 + 0.0041d
// (gap 0.41 + 0.0025d), his 90-golfer putting table, and Pinpoint's 15-handicap spot values
// (fairway 160 yd 3.92, sand 20 yd 3.05). Sanity check: a 15-handicap on a 400-yd par 4
// projects to 5.17 strokes, i.e. about +21 per round versus Tour, matching Shot Scope's
// measured gap. Treat the category split as approximate; the totals are what is anchored.
function lerp(col, d) {
  if (d <= col[0][0]) return col[0][1];
  for (let i = 1; i < col.length; i++) if (d <= col[i][0]) {
    const [d0, v0] = col[i - 1], [d1, v1] = col[i];
    return v0 + ((d - d0) / (d1 - d0)) * (v1 - v0);
  }
  return col[col.length - 1][1];
}
const GAP18 = {
  tee: (d) => 0.41 + 0.0025 * d,
  fairway: (d) => 0.19 + 0.00587 * Math.min(d, 220) + 0.002 * Math.max(0, d - 220),
  rough: (d) => (0.19 + 0.00587 * Math.min(d, 220) + 0.002 * Math.max(0, d - 220)) * 1.15,
  sand: (d) => 0.5 + 0.004 * d,
  recovery: (d) => (0.19 + 0.00587 * Math.min(d, 220) + 0.002 * Math.max(0, d - 220)) * 1.1,
  green: (ft) => lerp(GOLFER_90_GREEN, ft) - lerp(PGA_TOUR.lies.green, ft),
};
function projectBaseline(h) {
  const lies = {};
  for (const [lie, col] of Object.entries(PGA_TOUR.lies)) {
    lies[lie] = col.map(([d, v]) => [d, Math.round((v + (h / 18) * GAP18[lie](d)) * 1000) / 1000]);
  }
  return {
    id: `hcp_${h}`, name: `Est. ${h} handicap`, estimated: true,
    source: 'Projected from the PGA Tour table using Broadie 90-golfer gaps scaled by handicap',
    lies,
  };
}

export const HANDICAP_BASELINES = Object.fromEntries([5, 10, 15, 20, 25].map((h) => [`hcp_${h}`, projectBaseline(h)]));

export const BASELINES = { pga_tour: PGA_TOUR, ...HANDICAP_BASELINES };
