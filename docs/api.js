// Supabase client, auth, and the local <-> cloud sync.
// Rule: the UI never waits on the network. Shots are written locally, rounds are marked
// dirty, and sync() pushes whatever is dirty whenever we are online.

import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { store } from './store.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email, password, display_name) {
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name } } });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
  await store.clearAll();
}

// ---------- profile ----------
export async function loadProfile() {
  const user = await currentUser();
  if (!user) return null;
  const cached = await store.get('profile');
  if (!navigator.onLine) return cached;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) return cached;
  await store.set('profile', data);
  return data;
}
export async function saveProfile(patch) {
  const user = await currentUser();
  const cached = (await store.get('profile')) ?? { id: user.id };
  const next = { ...cached, ...patch };
  await store.set('profile', next);
  await store.set('profile_dirty', true);
  if (navigator.onLine) await pushProfile();
  return next;
}
async function pushProfile() {
  const p = await store.get('profile');
  if (!p || !(await store.get('profile_dirty'))) return;
  const { id, display_name, handicap_index, home_course_id, default_baseline, share_leaderboard, bag } = p;
  const { error } = await supabase.from('profiles').upsert({ id, display_name, handicap_index, home_course_id, default_baseline, share_leaderboard, bag });
  if (!error) await store.set('profile_dirty', false);
}

// ---------- courses ----------
export async function loadCourses() {
  if (navigator.onLine) {
    const { data, error } = await supabase.from('courses').select('id,name,created_by,is_public,course_holes(*)');
    if (!error) {
      for (const c of data) await store.putCourse({ ...c, holes: c.course_holes, course_holes: undefined });
    }
  }
  return store.allCourses();
}
export async function saveCourse(course) {
  // course: { id, name, tee_set, holes: [{hole_no, par, yards, stroke_index}] }
  const user = await currentUser();
  const local = { ...course, created_by: user.id, dirty: true };
  await store.putCourse(local);
  if (navigator.onLine) await pushCourse(local);
  return local;
}
async function pushCourse(c) {
  const { error } = await supabase.from('courses').upsert({ id: c.id, name: c.name, created_by: c.created_by, is_public: true });
  if (error) return;
  const rows = c.holes.map((h) => ({ course_id: c.id, tee_set: h.tee_set ?? c.tee_set ?? 'White', hole_no: h.hole_no, par: h.par, yards: h.yards, stroke_index: h.stroke_index ?? null }));
  const { error: e2 } = await supabase.from('course_holes').upsert(rows);
  if (!e2) await store.putCourse({ ...c, dirty: false });
}

// ---------- rounds ----------
export async function saveRoundLocal(round) {
  round.dirty = true;
  round.updated_at = new Date().toISOString();
  await store.putRound(round);
  scheduleSync();
}

let syncTimer = null;
export function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), delay);
}

export const syncState = { running: false, lastError: null, pending: 0, lastSync: null, listeners: new Set() };
function notify() { for (const fn of syncState.listeners) fn(syncState); }

export async function countPending() {
  const rounds = await store.allRounds();
  syncState.pending = rounds.filter((r) => r.dirty).length;
  notify();
  return syncState.pending;
}

/** Push dirty rounds, then pull the server copy of everything. */
export async function sync() {
  if (syncState.running || !navigator.onLine) return;
  const user = await currentUser();
  if (!user) return;
  syncState.running = true; syncState.lastError = null; notify();
  try {
    await pushProfile();
    for (const c of await store.allCourses()) if (c.dirty) await pushCourse(c);
    const rounds = await store.allRounds();
    for (const r of rounds) if (r.dirty) await pushRound(r, user.id);
    await pullRounds(user.id);
    syncState.lastSync = new Date();
  } catch (e) {
    syncState.lastError = e.message ?? String(e);
  } finally {
    syncState.running = false;
    await countPending();
  }
}

async function pushRound(r, userId) {
  const { error } = await supabase.from('rounds').upsert({
    id: r.id, user_id: userId, course_id: r.course_id ?? null, course_name: r.course_name,
    tee_set: r.tee_set, played_on: r.played_on, holes_played: r.holes_played, status: r.status,
    entry_mode: r.entry_mode, notes: r.notes ?? null,
  });
  if (error) throw error;
  const holes = Object.entries(r.holes).map(([n, h]) => ({ round_id: r.id, hole_no: +n, par: h.par, yards: h.yards }));
  if (holes.length) { const { error: e } = await supabase.from('round_holes').upsert(holes); if (e) throw e; }
  if (r.conditions?.length) {
    const rows = r.conditions.map((c) => ({ ...c, round_id: r.id }));
    const { error: e } = await supabase.from('round_conditions').upsert(rows, { onConflict: 'round_id,from_hole' });
    if (e) throw e;
  }
  if (r.deleted_shot_ids?.length) {
    const { error: e } = await supabase.from('shots').delete().in('id', r.deleted_shot_ids);
    if (e) throw e;
  }
  if (r.shots.length) {
    const rows = r.shots.map((s) => ({
      id: s.id, round_id: r.id, hole_no: s.hole_no, shot_no: s.shot_no, lie: s.lie, distance: s.distance,
      within_30: s.within_30 ?? null, club: s.club ?? null, miss: s.miss ?? 'none',
      penalty_strokes: s.penalty_strokes ?? 0, penalty_type: s.penalty_type ?? null, notes: s.notes ?? null,
    }));
    // Upsert on id; the (round, hole, shot_no) unique constraint can collide when shots were
    // renumbered offline, so delete this round's server shots that are not in the local set first.
    const { data: serverShots } = await supabase.from('shots').select('id').eq('round_id', r.id);
    const keep = new Set(rows.map((x) => x.id));
    const stale = (serverShots ?? []).map((x) => x.id).filter((id) => !keep.has(id));
    if (stale.length) await supabase.from('shots').delete().in('id', stale);
    const { error: e } = await supabase.from('shots').upsert(rows);
    if (e) throw e;
  }
  await store.putRound({ ...r, dirty: false, deleted_shot_ids: [] });
}

async function pullRounds(userId) {
  const { data, error } = await supabase.from('rounds')
    .select('*, round_holes(*), round_conditions(*), shots(*)')
    .eq('user_id', userId).order('played_on', { ascending: false }).limit(200);
  if (error) throw error;
  const local = new Map((await store.allRounds()).map((r) => [r.id, r]));
  for (const row of data) {
    const existing = local.get(row.id);
    if (existing?.dirty) continue; // never clobber unsynced local work
    const holes = {};
    for (const h of row.round_holes) holes[h.hole_no] = { par: h.par, yards: h.yards };
    await store.putRound({
      id: row.id, course_id: row.course_id, course_name: row.course_name, tee_set: row.tee_set,
      played_on: row.played_on, holes_played: row.holes_played, status: row.status, entry_mode: row.entry_mode,
      notes: row.notes, created_at: row.created_at, updated_at: row.updated_at, holes,
      conditions: row.round_conditions.map(({ round_id, created_at, ...c }) => c),
      shots: row.shots.map(({ round_id, created_at, updated_at, ...s }) => ({ ...s, distance: +s.distance })),
      dirty: false,
    });
  }
}

export async function deleteRound(id) {
  await store.deleteRound(id);
  if (navigator.onLine) await supabase.from('rounds').delete().eq('id', id);
}

window.addEventListener('online', () => scheduleSync(500));
