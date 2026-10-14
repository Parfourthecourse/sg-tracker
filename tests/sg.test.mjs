import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedStrokes, scoreHole, scoreRound, categoryOf } from '../docs/sg.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('published points are returned exactly', () => {
  close(expectedStrokes('tee', 400), 3.99);
  close(expectedStrokes('fairway', 140), 2.91);
  close(expectedStrokes('rough', 150), 3.19);   // midway 140 (3.15) and 160 (3.23)
  close(expectedStrokes('green', 10), 1.61);
  close(expectedStrokes('green', 3), 1.04);
});

test('interpolation and clamping', () => {
  close(expectedStrokes('fairway', 150), 2.945);
  close(expectedStrokes('green', 12.5), 1.695); // between 10 (1.61) and 15 (1.78)
  close(expectedStrokes('fairway', 5), 2.18);   // below first point clamps
  assert.ok(expectedStrokes('tee', 650) > 4.82); // extrapolates
  close(expectedStrokes('anything', 0), 0);     // holed
});

test('Broadie worked example: 400-yd par 4, drive to 140 fairway, approach to 10 ft, one putt', () => {
  const r = scoreHole([
    { shot_no: 1, lie: 'tee', distance: 400 },
    { shot_no: 2, lie: 'fairway', distance: 140 },
    { shot_no: 3, lie: 'green', distance: 10 },
  ], 4);
  close(r.shots[0].sg, 3.99 - 2.91 - 1);  // +0.08
  close(r.shots[1].sg, 2.91 - 1.61 - 1);  // +0.30
  close(r.shots[2].sg, 1.61 - 0 - 1);     // +0.61
  close(r.totals.total, 3.99 - 3);        // birdie: +0.99
  assert.equal(r.strokes, 3);
  assert.ok(r.identity_ok);
  assert.deepEqual(r.shots.map(s => s.category), ['ott', 'app', 'putt']);
});

test('penalty is charged to the shot that incurred it; stroke-and-distance scores exactly -2', () => {
  const r = scoreHole([
    { shot_no: 1, lie: 'tee', distance: 400, penalty_strokes: 1 },
    { shot_no: 2, lie: 'tee', distance: 400 },
    { shot_no: 3, lie: 'fairway', distance: 140 },
    { shot_no: 4, lie: 'green', distance: 10 },
  ], 4);
  close(r.shots[0].sg, -2);
  assert.equal(r.strokes, 5);
  assert.ok(r.identity_ok);
  close(r.totals.total, 3.99 - 5);
});

test('categories: par-3 tee is approach, within 30 is around the green, three-putt', () => {
  assert.equal(categoryOf({ shot_no: 1, lie: 'tee', distance: 170 }, 3), 'app');
  assert.equal(categoryOf({ shot_no: 2, lie: 'rough', distance: 25 }, 4), 'arg');
  assert.equal(categoryOf({ shot_no: 2, lie: 'rough', distance: 25, within_30: false }, 4), 'app');
  assert.equal(categoryOf({ shot_no: 2, lie: 'fairway', distance: 80 }, 4), 'app');
  const r = scoreHole([
    { shot_no: 1, lie: 'tee', distance: 170 },
    { shot_no: 2, lie: 'green', distance: 40 },
    { shot_no: 3, lie: 'green', distance: 6 },
    { shot_no: 4, lie: 'green', distance: 2 },
  ], 3);
  assert.ok(r.identity_ok);
  assert.ok(r.totals.putt < 0, 'three-putt from 40 ft loses strokes');
  close(r.totals.total, r.totals.app + r.totals.putt);
});

test('round totals sum holes and identity holds', () => {
  const r = scoreRound({
    1: { par: 4, shots: [
      { shot_no: 1, lie: 'tee', distance: 400 }, { shot_no: 2, lie: 'fairway', distance: 140 }, { shot_no: 3, lie: 'green', distance: 10 }] },
    2: { par: 3, shots: [
      { shot_no: 1, lie: 'tee', distance: 170 }, { shot_no: 2, lie: 'sand', distance: 20 }, { shot_no: 3, lie: 'green', distance: 8 }, { shot_no: 4, lie: 'green', distance: 2 }] },
  });
  assert.equal(r.strokes, 7);
  assert.equal(r.par, 7);
  assert.equal(r.holes_played, 2);
  const sumCats = r.totals.ott + r.totals.app + r.totals.arg + r.totals.putt;
  close(sumCats, r.totals.total);
  close(r.totals.total, r.holes[1].baseline_start + r.holes[2].baseline_start - 7);
});
