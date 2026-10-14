// App shell: hash router, screens, and the shot-entry flow.
import { store, uuid } from './store.js';
import * as api from './api.js';
import { scoreHole, scoreRound, getBaseline, CATEGORY_LABELS, round2 } from './sg.js';
import { BASELINES } from './baselines.js';
import { APP_VERSION } from './config.js';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view'), titleEl = $('#title'), backBtn = $('#back'), tabs = $('#tabs'), syncDot = $('#sync-dot');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 2) => (x > 0 ? '+' : '') + (+x).toFixed(d);
const cls = (x) => (x > 0.005 ? 'pos' : x < -0.005 ? 'neg' : '');
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

const LIE_LABELS = { tee: 'Tee', fairway: 'Fairway', rough: 'Rough', sand: 'Sand', recovery: 'Recovery', green: 'Green' };
const MISSES = [['long_left', '↖'], ['long', '↑'], ['long_right', '↗'], ['left', '←'], ['none', 'On'], ['right', '→'], ['short_left', '↙'], ['short', '↓'], ['short_right', '↘']];
const COND = {
  rain: ['none', 'light', 'steady', 'heavy'], wind_strength: ['calm', 'light', 'moderate', 'strong'],
  wind_direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], ground: ['soft', 'normal', 'firm'],
};

// ---------- sync indicator ----------
api.syncState.listeners.add((s) => {
  syncDot.className = s.lastError ? 'error' : s.running ? 'pending' : s.pending ? 'pending' : 'ok';
  syncDot.title = s.lastError ? `Sync error: ${s.lastError}` : s.pending ? `${s.pending} round(s) waiting to sync` : 'Synced';
});

// ---------- router ----------
const routes = [];
function route(pattern, handler) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler }); }
async function navigate() {
  const hash = location.hash.slice(1) || '/';
  const user = await api.currentUser();
  if (!user && hash !== '/login') { location.hash = '#/login'; return; }
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) { view.innerHTML = ''; await r.handler(m.groups ?? {}); window.scrollTo(0, 0); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', navigate);
backBtn.onclick = () => history.back();
function chrome({ title, back = false, tab = null }) {
  titleEl.textContent = title; backBtn.hidden = !back; tabs.hidden = !tab;
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === tab);
}
function render(html) { view.innerHTML = html; return view; }

// ---------- login ----------
route('/login', async () => {
  chrome({ title: 'Strokes Gained' });
  let mode = 'in';
  const draw = () => {
    render(`<div class="card">
      <h2>${mode === 'in' ? 'Sign in' : 'Create account'}</h2>
      ${mode === 'up' ? '<label>Name</label><input id="name" autocomplete="name">' : ''}
      <label>Email</label><input id="email" type="email" autocomplete="email" inputmode="email">
      <label>Password</label><input id="pw" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}">
      <p class="error" id="err"></p>
      <button class="primary block" id="go">${mode === 'in' ? 'Sign in' : 'Sign up'}</button>
      <p class="muted" style="text-align:center;margin-top:12px"><a href="#" id="swap">${mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}</a></p>
    </div>`);
    $('#swap').onclick = (e) => { e.preventDefault(); mode = mode === 'in' ? 'up' : 'in'; draw(); };
    $('#go').onclick = async () => {
      $('#err').textContent = ''; $('#go').disabled = true;
      try {
        if (mode === 'in') await api.signIn($('#email').value.trim(), $('#pw').value);
        else { await api.signUp($('#email').value.trim(), $('#pw').value, $('#name').value.trim()); toast('Account created'); }
        await api.sync(); location.hash = '#/';
      } catch (e) { $('#err').textContent = e.message; $('#go').disabled = false; }
    };
  };
  draw();
});

// ---------- home ----------
route('/', async () => {
  chrome({ title: 'Rounds', tab: 'home' });
  const rounds = await store.allRounds();
  const profile = await api.loadProfile();
  const baseline = getBaseline(profile?.default_baseline);
  const live = rounds.find((r) => r.status === 'in_progress');
  render(`
    ${live ? `<a class="card" href="#/round/${live.id}" style="display:block;text-decoration:none;color:inherit;border-color:var(--accent)">
      <div class="row"><div class="grow"><b>Continue round</b><br><span class="muted">${esc(live.course_name)} · ${live.played_on}</span></div><span class="pill">${Object.keys(holesDone(live)).length}/${live.holes_played} holes</span></div></a>` : ''}
    <button class="primary block" id="new">New round</button>
    <h3>History</h3>
    <div class="card list" id="list">${rounds.filter((r) => r !== live).map((r) => {
      const s = scoreRound(roundHoles(r), baseline);
      return `<a href="#/round/${r.id}/summary"><div><b>${esc(r.course_name)}</b><br><span class="muted">${r.played_on} · ${s.strokes} (${fmt(s.strokes - s.par, 0)})${r.dirty ? ' · <span class="pill">unsynced</span>' : ''}</span></div><b class="num ${cls(s.totals.total)}">${fmt(s.totals.total)}</b></a>`;
    }).join('') || '<p class="muted" style="padding:14px">No rounds yet. Tap New round to start.</p>'}</div>
    <p class="muted" style="text-align:center">SG vs ${esc(baseline.name)}</p>`);
  $('#new').onclick = () => { location.hash = '#/new'; };
  api.countPending();
});

function roundHoles(r) {
  const out = {};
  for (const [n, h] of Object.entries(r.holes)) {
    const shots = r.shots.filter((s) => s.hole_no === +n);
    if (shots.length && r.holes_done?.[n]) out[n] = { par: h.par, shots };
  }
  return out;
}
function holesDone(r) { return r.holes_done ?? {}; }

// ---------- new round ----------
route('/new', async () => {
  chrome({ title: 'New round', back: true });
  const courses = await api.loadCourses();
  const profile = await api.loadProfile();
  const today = new Date().toISOString().slice(0, 10);
  render(`<div class="card">
    <label>Course</label>
    <select id="course"><option value="">— Enter holes manually —</option>${courses.map((c) => `<option value="${c.id}" ${c.id === profile?.home_course_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <div id="manual" hidden><label>Course name</label><input id="cname" placeholder="e.g. Hadley Wood"></div>
    <label>Tee set</label><select id="tee"></select>
    <div class="grid c2"><div><label>Date</label><input id="date" type="date" value="${today}"></div>
    <div><label>Holes</label><select id="holes"><option value="18">18</option><option value="9">9</option></select></div></div>
    <label>Entry</label><div class="grid c2"><button id="m-live" class="sel">Live on course</button><button id="m-post">After the round</button></div>
    <div id="holegrid"></div>
    <p class="muted">Then set conditions on the next screen.</p>
    <button class="primary block" id="start">Start round</button>
  </div>`);
  let mode = 'live';
  $('#m-live').onclick = () => { mode = 'live'; $('#m-live').classList.add('sel'); $('#m-post').classList.remove('sel'); };
  $('#m-post').onclick = () => { mode = 'post'; $('#m-post').classList.add('sel'); $('#m-live').classList.remove('sel'); };
  const courseSel = $('#course'), teeSel = $('#tee');
  const holeGrid = $('#holegrid');
  function drawHoles(holes) {
    const n = +$('#holes').value;
    holeGrid.innerHTML = `<h3>Holes</h3><table><tr><th>#</th><th>Par</th><th>Yards</th></tr>${Array.from({ length: n }, (_, i) => {
      const h = holes?.[i + 1] ?? {};
      return `<tr><td>${i + 1}</td><td><input class="par num" data-h="${i + 1}" inputmode="numeric" value="${h.par ?? 4}" style="width:56px;text-align:right"></td><td><input class="yds num" data-h="${i + 1}" inputmode="numeric" value="${h.yards ?? ''}" style="width:80px;text-align:right"></td></tr>`;
    }).join('')}</table>`;
  }
  function onCourse() {
    const c = courses.find((x) => x.id === courseSel.value);
    $('#manual').hidden = !!c;
    const tees = c ? [...new Set(c.holes.map((h) => h.tee_set))] : ['White', 'Yellow', 'Red', 'Blue'];
    teeSel.innerHTML = tees.map((t) => `<option>${esc(t)}</option>`).join('');
    onTee();
  }
  function onTee() {
    const c = courses.find((x) => x.id === courseSel.value);
    const holes = {};
    if (c) for (const h of c.holes.filter((h) => h.tee_set === teeSel.value)) holes[h.hole_no] = h;
    drawHoles(holes);
  }
  courseSel.onchange = onCourse; teeSel.onchange = onTee; $('#holes').onchange = onTee;
  onCourse();
  $('#start').onclick = async () => {
    const c = courses.find((x) => x.id === courseSel.value);
    const name = c ? c.name : $('#cname').value.trim();
    if (!name) { toast('Give the course a name'); return; }
    const holes = {};
    for (const inp of holeGrid.querySelectorAll('input.par')) holes[inp.dataset.h] = { par: +inp.value || 4 };
    for (const inp of holeGrid.querySelectorAll('input.yds')) holes[inp.dataset.h].yards = +inp.value || 0;
    if (Object.values(holes).some((h) => !h.yards)) { toast('Enter yardage for every hole'); return; }
    let course_id = c?.id ?? null;
    if (!c) {
      const saved = await api.saveCourse({ id: uuid(), name, tee_set: teeSel.value, holes: Object.entries(holes).map(([n, h]) => ({ hole_no: +n, par: h.par, yards: h.yards, tee_set: teeSel.value })) });
      course_id = saved.id;
    }
    const round = {
      id: uuid(), course_id, course_name: name, tee_set: teeSel.value, played_on: $('#date').value,
      holes_played: +$('#holes').value, status: 'in_progress', entry_mode: mode, holes, holes_done: {},
      conditions: [], shots: [], created_at: new Date().toISOString(),
    };
    await api.saveRoundLocal(round);
    location.hash = `#/round/${round.id}/conditions`;
  };
});

// ---------- conditions ----------
route('/round/:id/conditions', async ({ id }) => {
  const r = await store.getRound(id);
  chrome({ title: 'Conditions', back: true });
  const fromHole = r.current_hole ?? 1;
  const prev = conditionsFor(r, fromHole) ?? { rain: 'none', wind_strength: 'calm', wind_direction: null, ground: 'normal', fog: false, frost: false, temp_c: null };
  const c = { ...prev, id: uuid(), from_hole: fromHole };
  const seg = (key, opts) => `<label>${key.replace('_', ' ')}</label><div class="grid c${Math.min(opts.length, 4)}">${opts.map((o) => `<button data-k="${key}" data-v="${o}" class="${c[key] === o ? 'sel' : ''}">${o}</button>`).join('')}</div>`;
  render(`<div class="card">
    <p class="muted">${fromHole === 1 ? 'Set before you start.' : `Applies from hole ${fromHole} onward; earlier holes keep their conditions.`}</p>
    ${seg('rain', COND.rain)}${seg('wind_strength', COND.wind_strength)}
    <div id="wd">${seg('wind_direction', COND.wind_direction)}</div>
    ${seg('ground', COND.ground)}
    <div class="grid c3"><div><label>Temp °C</label><input id="temp" inputmode="numeric" value="${c.temp_c ?? ''}"></div>
    <div><label>Fog</label><button id="fog" class="block ${c.fog ? 'sel' : ''}">${c.fog ? 'Yes' : 'No'}</button></div>
    <div><label>Frost</label><button id="frost" class="block ${c.frost ? 'sel' : ''}">${c.frost ? 'Yes' : 'No'}</button></div></div>
    <label>Notes</label><input id="cnotes" value="${esc(c.notes ?? '')}">
    <button class="primary block" id="save" style="margin-top:12px">Save conditions</button>
  </div>`);
  view.onclick = (e) => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    c[b.dataset.k] = b.dataset.v;
    for (const x of view.querySelectorAll(`button[data-k="${b.dataset.k}"]`)) x.classList.toggle('sel', x === b);
  };
  $('#fog').onclick = () => { c.fog = !c.fog; $('#fog').textContent = c.fog ? 'Yes' : 'No'; $('#fog').classList.toggle('sel', c.fog); };
  $('#frost').onclick = () => { c.frost = !c.frost; $('#frost').textContent = c.frost ? 'Yes' : 'No'; $('#frost').classList.toggle('sel', c.frost); };
  $('#save').onclick = async () => {
    c.temp_c = $('#temp').value === '' ? null : +$('#temp').value;
    c.notes = $('#cnotes').value || null;
    if (c.wind_strength === 'calm') c.wind_direction = null;
    r.conditions = r.conditions.filter((x) => x.from_hole !== fromHole).concat(c).sort((a, b) => a.from_hole - b.from_hole);
    await api.saveRoundLocal(r);
    location.hash = `#/round/${id}`;
  };
});
function conditionsFor(r, hole) {
  return [...(r.conditions ?? [])].filter((c) => c.from_hole <= hole).sort((a, b) => b.from_hole - a.from_hole)[0] ?? null;
}
function condSummary(c) {
  if (!c) return 'No conditions set';
  const parts = [c.rain === 'none' ? 'Dry' : `${c.rain} rain`, c.wind_strength === 'calm' ? 'calm' : `${c.wind_strength} ${c.wind_direction ?? ''} wind`];
  if (c.temp_c != null) parts.push(`${c.temp_c}°`);
  if (c.fog) parts.push('fog'); if (c.frost) parts.push('frost'); if (c.ground !== 'normal') parts.push(c.ground);
  return parts.join(' · ');
}

// ---------- shot entry ----------
const DEFAULT_BAG = [['Dr', 230], ['3w', 215], ['5w', 200], ['Hy', 190], ['4i', 180], ['5i', 170], ['6i', 160], ['7i', 150], ['8i', 140], ['9i', 130], ['PW', 120], ['GW', 105], ['SW', 90], ['LW', 70], ['Putter', null]];
/** Bag is stored as [{club, yards}]; older profiles stored plain strings. */
function normBag(bag) {
  if (!Array.isArray(bag) || !bag.length) return DEFAULT_BAG.map(([club, yards]) => ({ club, yards }));
  return bag.map((b) => (typeof b === 'string' ? { club: b, yards: null } : { club: b.club, yards: b.yards ?? null }));
}
function clubForDistance(bag, yards) {
  const cands = bag.filter((b) => b.yards && b.club !== 'Putter');
  if (!cands.length || !yards) return null;
  // Pick the shortest club that still reaches; if none reaches, the longest club.
  const reaching = cands.filter((b) => b.yards >= yards).sort((a, b) => a.yards - b.yards);
  return (reaching[0] ?? cands.sort((a, b) => b.yards - a.yards)[0]).club;
}
const nextHoleNeedingData = (r) => { for (let h = 1; h <= r.holes_played; h++) if (!r.holes_done?.[h]) return h; return r.holes_played; };

route('/round/:id', async ({ id }) => {
  const r = await store.getRound(id);
  if (!r) { location.hash = '#/'; return; }
  const profile = await api.loadProfile();
  const bag = normBag(profile?.bag);
  const teeClub = profile?.tee_club ?? 'Dr';
  const baseline = getBaseline(profile?.default_baseline);
  let hole = (r.current_hole && !r.holes_done?.[r.current_hole]) ? r.current_hole : nextHoleNeedingData(r);
  let editing = null;        // shot id being edited; null = entering a new shot
  let showYardage = false;   // tee shot: keypad hidden until "Change" is tapped
  chrome({ title: esc(r.course_name), back: true });

  const shotsOn = (h) => r.shots.filter((s) => s.hole_no === h).sort((a, b) => a.shot_no - b.shot_no);
  const strokesOn = (h) => shotsOn(h).reduce((n, s) => n + 1 + (s.penalty_strokes ?? 0), 0);

  function blank() {
    const prev = shotsOn(hole);
    const last = prev[prev.length - 1];
    const par = r.holes[hole].par;
    const s = { id: uuid(), hole_no: hole, shot_no: strokesOn(hole) + 1, lie: 'tee', distance: r.holes[hole].yards, club: null, miss: 'none', penalty_strokes: 0, penalty_type: null, within_30: null, notes: null, _auto: true };
    if (!last) {
      s.club = par >= 4 ? teeClub : clubForDistance(bag, s.distance) ?? teeClub;
      return s;
    }
    if (last.penalty_type === 'ob' || last.penalty_type === 'lost') {   // stroke and distance: replay from the same spot
      s.lie = last.lie; s.distance = last.distance; s.club = last.club; s._auto = false; return s;
    }
    s.lie = guessLie(last); s.distance = 0;
    s.club = s.lie === 'green' ? 'Putter' : null;
    return s;
  }
  function guessLie(last) {
    if (last.lie === 'green' || last.club === 'Putter') return 'green';
    if (/^(LW|SW|GW|PW)$/.test(last.club ?? '') || (last.distance <= 60 && last.lie !== 'tee')) return 'green';
    return 'fairway';
  }

  let s = blank();
  let keyBuf = '';

  function draw() {
    const prev = shotsOn(hole);
    const h = r.holes[hole];
    const done = !!r.holes_done?.[hole];
    const cond = conditionsFor(r, hole);
    const last = editing ? prev[prev.findIndex((p) => p.id === editing) - 1] : prev[prev.length - 1];
    const isTee = s.shot_no === 1 || (s.lie === 'tee' && !editing && last?.penalty_type && (last.penalty_type === 'ob' || last.penalty_type === 'lost') && last.lie === 'tee');
    const unit = s.lie === 'green' ? 'ft' : 'yds';
    const nineWay = s.lie === 'green' || (s.lie === 'recovery' && s.distance <= 50);
    const missOpts = nineWay ? MISSES : [['left', '← Left'], ['none', 'Centre'], ['right', 'Right →']];
    const viewing = done && !editing;   // completed hole, nothing being edited: show the holed shot, no "new"
    render(`
      <div class="hole-head"><div><span class="big">Hole ${hole}</span> <span class="muted">par ${h.par} · ${h.yards} yds${done ? ` · <b>${strokesOn(hole)}</b> (${strokesOn(hole) - h.par === 0 ? 'E' : fmt(strokesOn(hole) - h.par, 0)})` : ''}</span></div>
        <div class="row"><button class="icon-btn" id="prevh" ${hole === 1 ? 'disabled' : ''}>&#8249;</button><button class="icon-btn" id="nexth" ${hole === r.holes_played ? 'disabled' : ''}>&#8250;</button></div></div>
      <div class="row"><a class="cond-chip" href="#/round/${id}/conditions">☁ ${esc(condSummary(cond))}</a></div>
      <div class="shot-strip">${prev.map((p) => `<button class="shot-chip ${editing === p.id ? 'active' : ''}" data-edit="${p.id}">${p.shot_no}. ${LIE_LABELS[p.lie]} ${p.distance}${p.lie === 'green' ? 'ft' : ''}${p.club ? ' · ' + esc(p.club) : ''}${p.penalty_strokes ? ' ⚠' : ''}</button>`).join('')}${done ? `<span class="shot-chip">⛳ holed</span>` : `<button class="shot-chip ${editing ? '' : 'active'}" data-edit="">${editing ? '+ new' : `${s.shot_no}. new`}</button>`}</div>
      ${viewing ? `<div class="card"><p class="muted" style="margin:0 0 10px">Hole complete. Tap a shot above to edit it, or add a shot if one was missed.</p><button class="block" id="reopen">Add a shot to this hole</button></div>` : `
      <div class="card">
        ${last && !isTee ? `<label>Result of shot ${last.shot_no} (miss direction)</label><div class="miss-grid ${nineWay ? '' : 'three'}">${missOpts.map(([k, v]) => `<button data-miss="${k}" class="${(last.miss ?? 'none') === k ? 'sel' : ''}">${v}</button>`).join('')}</div>` : ''}
        ${isTee ? `<label>Shot ${s.shot_no} · tee</label>` : `<label>Lie before shot ${s.shot_no}</label>
        <div class="grid c3 lie-grid">${Object.entries(LIE_LABELS).filter(([k]) => k !== 'tee').map(([k, v]) => `<button data-lie="${k}" class="${s.lie === k ? 'sel' : ''}">${v}</button>`).join('')}</div>`}
        <label>Distance to hole</label>
        ${isTee && !showYardage ? `<div class="row"><div class="dist-display grow">${s.distance}<small>yds</small></div><button id="chg">Change</button></div>` : `
        <div class="dist-display">${s.distance}<small>${unit}</small></div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '−10', 0, '+10'].map((k) => `<button data-key="${k}">${k}</button>`).join('')}</div>
        <div class="grid c2" style="margin-top:8px"><button data-key="C">Clear</button><button data-key="−1">−1</button></div>`}
        <label>Penalty on this shot</label>
        <div class="grid c5">${[['0', 'None'], ['water', 'Water'], ['lost', 'Lost'], ['ob', 'OB'], ['unplayable', 'Unplay.']].map(([k, v]) => `<button data-pen="${k}" class="${(s.penalty_type ?? '0') === k ? 'sel' : ''}">${v}</button>`).join('')}</div>
        <details ${s.notes || s.within_30 != null ? 'open' : ''}><summary>More: around-the-green flag, notes</summary>
          <label>Within 30 yards of the green?</label>
          <div class="grid c3">${[['auto', 'Auto'], ['yes', 'Yes'], ['no', 'No']].map(([k, v]) => `<button data-w30="${k}" class="${(s.within_30 == null ? 'auto' : s.within_30 ? 'yes' : 'no') === k ? 'sel' : ''}">${v}</button>`).join('')}</div>
          <label>Notes</label><input id="snotes" value="${esc(s.notes ?? '')}" placeholder="optional">
        </details>
        <label>Club</label>
        <div class="club-row">${bag.map((b) => `<button data-club="${esc(b.club)}" class="${s.club === b.club ? 'sel' : ''}">${esc(b.club)}</button>`).join('')}</div>
      </div>
      <div class="sticky-actions">
        ${editing ? `<button class="danger" id="del">Delete</button><button class="primary grow" id="save">Save shot</button>` :
          `<button class="primary grow" id="save">Next shot</button><button class="grow" id="holed">Holed ⛳</button>`}
      </div>`}`);
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit !== undefined) { editing = b.dataset.edit || null; s = editing ? { ...prev.find((p) => p.id === editing), _auto: false } : blank(); keyBuf = ''; showYardage = false; draw(); return; }
      if (b.id === 'reopen') { delete r.holes_done[hole]; await api.saveRoundLocal(r); s = blank(); draw(); return; }
      if (b.id === 'chg') { showYardage = true; keyBuf = String(s.distance); draw(); return; }
      if (b.dataset.lie) { const wasGreen = s.lie === 'green'; s.lie = b.dataset.lie; if (s.lie === 'green' && !wasGreen) { s.club = 'Putter'; s.distance = 0; s._auto = true; } if (wasGreen && s.lie !== 'green') { s.club = null; s.distance = 0; s._auto = true; } keyBuf = ''; draw(); return; }
      if (b.dataset.key !== undefined) { keypad(b.dataset.key); return; }
      if (b.dataset.club) { s.club = s.club === b.dataset.club ? null : b.dataset.club; s._auto = false; draw(); return; }
      if (b.dataset.miss) { if (last) { last.miss = b.dataset.miss; await api.saveRoundLocal(r); } draw(); return; }
      if (b.dataset.pen) { if (b.dataset.pen === '0') { s.penalty_strokes = 0; s.penalty_type = null; } else { s.penalty_strokes = 1; s.penalty_type = b.dataset.pen; } draw(); return; }
      if (b.dataset.w30) { s.within_30 = b.dataset.w30 === 'auto' ? null : b.dataset.w30 === 'yes'; draw(); return; }
      if (b.id === 'prevh') { await gotoHole(hole - 1); return; }
      if (b.id === 'nexth') { await gotoHole(hole + 1); return; }
      if (b.id === 'save') { await commit(false); return; }
      if (b.id === 'holed') { await commit(true); return; }
      if (b.id === 'del') { r.shots = r.shots.filter((p) => p.id !== editing); renumber(); (r.deleted_shot_ids ??= []).push(editing); editing = null; s = blank(); await api.saveRoundLocal(r); draw(); return; }
    };
    const notes = $('#snotes'); if (notes) notes.onchange = (e) => { s.notes = e.target.value || null; };
  }
  function keypad(k) {
    if (k === 'C') { keyBuf = ''; s.distance = 0; }
    else if (k === '+10') s.distance = s.distance + 10;
    else if (k === '−10') s.distance = Math.max(0, s.distance - 10);
    else if (k === '−1') s.distance = Math.max(0, s.distance - 1);
    else { keyBuf = (keyBuf + k).slice(0, 3); s.distance = +keyBuf; }
    if (k === '+10' || k.startsWith('−')) keyBuf = String(s.distance);
    $('.dist-display').innerHTML = `${s.distance}<small>${s.lie === 'green' ? 'ft' : 'yds'}</small>`;
    // Suggest a club from stock yardages while the golfer has not picked one by hand.
    if (s._auto && s.lie !== 'green') {
      const c = clubForDistance(bag, s.distance);
      if (c && c !== s.club) { s.club = c; for (const x of view.querySelectorAll('button[data-club]')) x.classList.toggle('sel', x.dataset.club === c); }
    }
  }
  function renumber() {
    for (const h of Object.keys(r.holes)) { let n = 1; for (const p of shotsOn(+h)) { p.shot_no = n; n += 1 + (p.penalty_strokes ?? 0); } }
  }
  async function commit(holed) {
    if (s.distance <= 0) { toast('Enter the distance to the hole'); return; }
    const notes = $('#snotes'); if (notes) s.notes = notes.value || null;
    const { _auto, ...clean } = s;
    if (editing) { Object.assign(r.shots.find((p) => p.id === editing), clean); editing = null; renumber(); }
    else r.shots.push(clean);
    if (holed) {
      r.holes_done = { ...(r.holes_done ?? {}), [hole]: true };
      const res = scoreHole(shotsOn(hole), r.holes[hole].par, baseline);
      toast(`Hole ${hole}: ${res.strokes} (${res.strokes - r.holes[hole].par === 0 ? 'E' : fmt(res.strokes - r.holes[hole].par, 0)}) · SG ${fmt(res.totals.total)}`);
      const next = nextHoleNeedingData(r);
      if (Object.keys(r.holes_done).length >= r.holes_played) { r.current_hole = hole; await api.saveRoundLocal(r); location.hash = `#/round/${id}/summary`; return; }
      await gotoHole(next);
    } else {
      await api.saveRoundLocal(r);
      s = blank(); keyBuf = ''; showYardage = false; draw();
    }
  }
  async function gotoHole(h) { hole = h; r.current_hole = h; editing = null; s = blank(); keyBuf = ''; showYardage = false; await api.saveRoundLocal(r); draw(); }
  draw();
});

// ---------- round summary ----------
route('/round/:id/summary', async ({ id }) => {
  const r = await store.getRound(id);
  if (!r) { location.hash = '#/'; return; }
  const profile = await api.loadProfile();
  let baselineId = profile?.default_baseline ?? 'pga_tour';
  chrome({ title: 'Round summary', back: true });
  const draw = () => {
    const baseline = getBaseline(baselineId);
    const res = scoreRound(roundHoles(r), baseline);
    const done = Object.keys(res.holes).map(Number).sort((a, b) => a - b);
    const allShots = done.flatMap((h) => res.holes[h].shots.map((s) => ({ ...s, hole: h })));
    const best = [...allShots].sort((a, b) => b.sg - a.sg).slice(0, 3);
    const worst = [...allShots].sort((a, b) => a.sg - b.sg).slice(0, 3);
    const max = Math.max(1, ...Object.values(res.totals).map(Math.abs));
    const bar = (k, v, color) => `<div class="cat-bar"><span>${k}</span><div class="track"><b></b><i style="background:${color};${v >= 0 ? `left:50%;width:${(v / max) * 50}%` : `right:50%;width:${(-v / max) * 50}%`}"></i></div><span class="num ${cls(v)}" style="text-align:right">${fmt(v)}</span></div>`;
    render(`
      <div class="card"><div class="row"><div class="grow"><b>${esc(r.course_name)}</b><br><span class="muted">${r.played_on} · ${r.tee_set} tees · ${done.length} holes${r.dirty ? ' · unsynced' : ''}</span></div>
        <div style="text-align:right"><span class="big">${res.strokes}</span><br><span class="muted">${res.strokes - res.par === 0 ? 'E' : fmt(res.strokes - res.par, 0)} vs par ${res.par}</span></div></div></div>
      <div class="card"><div class="row"><h3 class="grow" style="margin:0">Strokes gained</h3><select id="bl" style="width:auto;min-height:36px">${Object.values(BASELINES).map((b) => `<option value="${b.id}" ${b.id === baselineId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
        <div class="cat-bars" style="margin-top:10px">
          ${bar('Off the tee', res.totals.ott, 'var(--ott)')}${bar('Approach', res.totals.app, 'var(--app)')}${bar('Around green', res.totals.arg, 'var(--arg)')}${bar('Putting', res.totals.putt, 'var(--putt)')}
          <div class="cat-bar"><b>Total</b><div></div><b class="num ${cls(res.totals.total)}" style="text-align:right">${fmt(res.totals.total)}</b></div>
        </div>${baseline.estimated ? '<p class="muted">Estimated baseline: projected from the Tour table using published amateur gaps. Totals are anchored; the category split is approximate.</p>' : ''}</div>
      <div class="card"><h3 style="margin-top:0">Holes</h3><table><tr><th>#</th><th>Par</th><th>Score</th><th>OTT</th><th>APP</th><th>ARG</th><th>PUTT</th><th>SG</th></tr>
        ${done.map((h) => { const x = res.holes[h]; return `<tr><td>${h}</td><td>${x.par}</td><td>${x.strokes}</td><td class="num ${cls(x.totals.ott)}">${fmt(x.totals.ott)}</td><td class="num ${cls(x.totals.app)}">${fmt(x.totals.app)}</td><td class="num ${cls(x.totals.arg)}">${fmt(x.totals.arg)}</td><td class="num ${cls(x.totals.putt)}">${fmt(x.totals.putt)}</td><td class="num ${cls(x.totals.total)}"><b>${fmt(x.totals.total)}</b></td></tr>`; }).join('')}</table></div>
      <div class="card"><h3 style="margin-top:0">Best shots</h3>${best.map(shotLine).join('')}<h3>Worst shots</h3>${worst.map(shotLine).join('')}</div>
      <div class="grid c2">${r.status === 'in_progress' ? `<a class="btn" href="#/round/${id}" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Back to entry</a><button class="primary" id="finish">Finish round</button>` : `<a class="btn" href="#/round/${id}" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Edit shots</a><button class="danger" id="delete">Delete round</button>`}</div>`);
    $('#bl').onchange = (e) => { baselineId = e.target.value; draw(); };
    $('#finish')?.addEventListener('click', async () => { r.status = 'complete'; await api.saveRoundLocal(r); toast('Round saved'); location.hash = '#/'; });
    $('#delete')?.addEventListener('click', async () => { if (confirm('Delete this round?')) { await api.deleteRound(id); location.hash = '#/'; } });
  };
  const shotLine = (s) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow">H${s.hole} · shot ${s.shot_no} · ${LIE_LABELS[s.lie]} ${s.distance}${s.lie === 'green' ? ' ft' : ' yds'}${s.club ? ' · ' + esc(s.club) : ''}${s.penalty_strokes ? ' · penalty' : ''}</span><b class="num ${cls(s.sg)}">${fmt(s.sg)}</b></div>`;
  draw();
});

// ---------- trends (phase 2 placeholder with the basics) ----------
route('/trends', async () => {
  chrome({ title: 'Trends', tab: 'trends' });
  const profile = await api.loadProfile();
  const baseline = getBaseline(profile?.default_baseline);
  const rounds = (await store.allRounds()).filter((r) => r.status === 'complete').reverse();
  if (!rounds.length) { render('<p class="muted">Complete a round to see trends.</p>'); return; }
  const rows = rounds.map((r) => ({ r, s: scoreRound(roundHoles(r), baseline) }));
  const avg = (k, n) => { const xs = rows.slice(-n).map((x) => x.s.totals[k]); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const n = Math.min(rows.length, 10);
  render(`<div class="card"><h3 style="margin-top:0">Last ${n} rounds, average SG per round vs ${esc(baseline.name)}</h3>
    <table><tr><th>Category</th><th>Avg</th><th>Best</th><th>Worst</th></tr>${['ott', 'app', 'arg', 'putt', 'total'].map((k) => {
      const xs = rows.slice(-n).map((x) => x.s.totals[k]);
      return `<tr><td>${k === 'total' ? '<b>Total</b>' : CATEGORY_LABELS[k]}</td><td class="num ${cls(avg(k, n))}">${fmt(avg(k, n))}</td><td class="num pos">${fmt(Math.max(...xs))}</td><td class="num neg">${fmt(Math.min(...xs))}</td></tr>`; }).join('')}</table></div>
    <div class="card"><h3 style="margin-top:0">SG total by round</h3>${sgBars(rows.map((x) => x.s.totals.total))}</div>
    <p class="muted">Rolling averages, skill profile and the Data Golf-style views arrive in Phase 2.</p>`);
});
function sgBars(vals) {
  const w = 600, h = 160, pad = 24, n = vals.length, bw = Math.max(4, (w - pad * 2) / n - 2);
  const max = Math.max(1, ...vals.map(Math.abs));
  const y = (v) => h / 2 - (v / max) * (h / 2 - 12);
  const ma = vals.map((_, i) => { const xs = vals.slice(Math.max(0, i - 4), i + 1); return xs.reduce((a, b) => a + b, 0) / xs.length; });
  const pts = ma.map((v, i) => `${pad + i * ((w - pad * 2) / n) + bw / 2},${y(v)}`).join(' ');
  return `<svg class="sg-bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="SG total per round with 5-round average">
    <line x1="${pad}" x2="${w - pad}" y1="${h / 2}" y2="${h / 2}" stroke="var(--ink-3)"/>
    ${vals.map((v, i) => `<rect x="${pad + i * ((w - pad * 2) / n)}" y="${Math.min(y(v), h / 2)}" width="${bw}" height="${Math.abs(y(v) - h / 2)}" fill="${v >= 0 ? 'var(--pos)' : 'var(--neg)'}" opacity=".55"><title>Round ${i + 1}: ${fmt(v)}</title></rect>`).join('')}
    ${n > 1 ? `<polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="2"/>` : ''}
    <text x="${pad}" y="12" font-size="11" fill="var(--ink-2)">+${max.toFixed(1)}</text><text x="${pad}" y="${h - 4}" font-size="11" fill="var(--ink-2)">−${max.toFixed(1)}</text></svg>`;
}

// ---------- friends (phase 3 placeholder) ----------
route('/friends', async () => {
  chrome({ title: 'Friends', tab: 'friends' });
  render('<div class="card"><p class="muted">Groups, invites with approval and the leaderboard are Phase 3. The database side (groups, join requests, approval, leaderboard that only exposes round-level totals) is already in place.</p></div>');
});

// ---------- settings ----------
route('/settings', async () => {
  chrome({ title: 'Settings', tab: 'settings' });
  const profile = (await api.loadProfile()) ?? {};
  const courses = await store.allCourses();
  const bag = normBag(profile.bag);
  const teeClub = profile.tee_club ?? 'Dr';
  render(`<div class="card">
    <label>Display name</label><input id="dn" value="${esc(profile.display_name ?? '')}">
    <label>Handicap index</label><input id="hc" inputmode="decimal" value="${profile.handicap_index ?? ''}">
    <label>Home course</label><select id="hc-course"><option value="">—</option>${courses.map((c) => `<option value="${c.id}" ${c.id === profile.home_course_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label>Default baseline</label><select id="bl">${Object.values(BASELINES).map((b) => `<option value="${b.id}" ${b.id === (profile.default_baseline ?? 'pga_tour') ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <label>Preferred club off the tee on par 4s and 5s</label><select id="teeclub">${bag.map((b) => `<option ${b.club === teeClub ? 'selected' : ''}>${esc(b.club)}</option>`).join('')}</select>
    <label>Bag and stock yardages (order is the order on the entry screen; yardage picks the default club for approach and par-3 tee shots)</label>
    <table id="bagtbl"><tr><th>Club</th><th>Yards</th><th></th></tr>${bag.map((b, i) => `<tr><td><input class="bclub" value="${esc(b.club)}"></td><td><input class="byds num" inputmode="numeric" value="${b.yards ?? ''}" style="width:72px;text-align:right"></td><td><button class="icon-btn bdel" data-i="${i}" title="Remove" style="font-size:20px">×</button></td></tr>`).join('')}</table>
    <button id="bagadd" class="block">Add club</button>
    <label>Share my round totals on friends leaderboards</label><button id="share" class="block ${profile.share_leaderboard ? 'sel' : ''}">${profile.share_leaderboard ? 'Sharing' : 'Not sharing'}</button>
    <button class="primary block" id="save" style="margin-top:12px">Save</button>
  </div>
  <div class="card"><h3 style="margin-top:0">Sync</h3><p class="muted" id="syncinfo"></p><div class="grid c2"><button id="syncnow">Sync now</button><button id="export">Export CSV</button></div></div>
  <div class="card"><button class="danger block" id="out">Sign out</button><p class="muted" style="text-align:center">v${APP_VERSION}</p></div>`);
  let share = !!profile.share_leaderboard;
  $('#bagtbl').onclick = (e) => { const b = e.target.closest('.bdel'); if (b) b.closest('tr').remove(); };
  $('#bagadd').onclick = () => { const tr = document.createElement('tr'); tr.innerHTML = '<td><input class="bclub" placeholder="e.g. 2i"></td><td><input class="byds num" inputmode="numeric" style="width:72px;text-align:right"></td><td><button class="icon-btn bdel" style="font-size:20px">×</button></td>'; $('#bagtbl').appendChild(tr); };
  $('#share').onclick = () => { share = !share; $('#share').textContent = share ? 'Sharing' : 'Not sharing'; $('#share').classList.toggle('sel', share); };
  $('#save').onclick = async () => {
    const rows = [...$('#bagtbl').querySelectorAll('tr')].slice(1);
    const newBag = rows.map((tr) => ({ club: tr.querySelector('.bclub').value.trim(), yards: tr.querySelector('.byds').value === '' ? null : +tr.querySelector('.byds').value })).filter((b) => b.club);
    await api.saveProfile({ display_name: $('#dn').value.trim(), handicap_index: $('#hc').value === '' ? null : +$('#hc').value, home_course_id: $('#hc-course').value || null, default_baseline: $('#bl').value, bag: newBag, tee_club: $('#teeclub').value, share_leaderboard: share });
    toast('Saved');
  };
  const info = async () => { const p = await api.countPending(); $('#syncinfo').textContent = `${p} round(s) waiting to sync. ${api.syncState.lastSync ? 'Last sync ' + api.syncState.lastSync.toLocaleTimeString() : ''} ${api.syncState.lastError ? 'Error: ' + api.syncState.lastError : ''} ${navigator.onLine ? '' : 'Offline.'}`; };
  info();
  $('#syncnow').onclick = async () => { await api.sync(); info(); toast(api.syncState.lastError ? 'Sync failed' : 'Synced'); };
  $('#export').onclick = exportCsv;
  $('#out').onclick = async () => { if (confirm('Sign out? Unsynced rounds on this phone will be lost.')) { await api.signOut(); location.hash = '#/login'; } };
});

async function exportCsv() {
  const profile = await api.loadProfile();
  const baseline = getBaseline(profile?.default_baseline);
  const rounds = await store.allRounds();
  const head = ['round_id', 'date', 'course', 'tee', 'hole', 'par', 'yards', 'shot', 'lie', 'distance', 'unit', 'club', 'miss', 'penalty', 'category', 'start_expected', 'end_expected', 'sg', 'rain', 'wind', 'wind_dir', 'temp_c', 'ground', 'notes'];
  const lines = [head.join(',')];
  for (const r of rounds) {
    const res = scoreRound(roundHoles(r), baseline);
    for (const [h, x] of Object.entries(res.holes)) {
      const c = conditionsFor(r, +h) ?? {};
      for (const s of x.shots) lines.push([r.id, r.played_on, r.course_name, r.tee_set, h, x.par, r.holes[h].yards, s.shot_no, s.lie, s.distance, s.lie === 'green' ? 'ft' : 'yds', s.club ?? '', s.miss ?? '', s.penalty_strokes ?? 0, s.category, round2(s.start_expected), round2(s.end_expected), round2(s.sg), c.rain ?? '', c.wind_strength ?? '', c.wind_direction ?? '', c.temp_c ?? '', c.ground ?? '', s.notes ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `strokes-gained-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
api.supabase.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_IN') api.scheduleSync(300); });
navigate().then(() => api.scheduleSync(1000));
