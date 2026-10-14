// Smoke test: serve docs/ statically, mock Supabase auth + REST, drive the entry flow offline-first.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const p = req.url.split('?')[0]; const f = path.join(root, p === '/' ? 'index.html' : p);
  try { res.setHeader('content-type', types[path.extname(f)] ?? 'text/plain'); res.end(await readFile(f)); } catch { res.statusCode = 404; res.end(); }
}).listen(4173);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--headless=new'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: 'nick@example.com' })).toString('base64url');
const token = `${header}.${payload}.sig`;
const user = { id: '11111111-1111-1111-1111-111111111111', email: 'nick@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const upserts = [];
await page.route((u) => u.hostname.endsWith('supabase.co'), async (route) => {
  const url = route.request().url(); const method = route.request().method();
  if (url.includes('/auth/v1/token')) return route.fulfill({ json: { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user } });
  if (url.includes('/auth/v1/user')) return route.fulfill({ json: user });
  if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
  if (url.includes('/rest/v1/profiles') && method === 'GET') return route.fulfill({ json: { id: user.id, display_name: 'Nick', default_baseline: 'pga_tour', bag: ['Dr', '3w', '7i', 'PW', 'SW', 'Putter'] } });
  if (url.includes('/rest/v1/') && (method === 'POST' || method === 'PATCH')) { upserts.push({ url: url.split('/rest/v1/')[1].split('?')[0], body: route.request().postDataJSON() }); return route.fulfill({ status: 201, json: [] }); }
  if (url.includes('/rest/v1/') && method === 'DELETE') return route.fulfill({ status: 204, body: '' });
  return route.fulfill({ json: [] });
});

await page.goto('http://localhost:4173/#/login');
await page.fill('#email', 'nick@example.com'); await page.fill('#pw', 'secret'); await page.click('#go');
try { await page.waitForSelector('#new', { timeout: 8000 }); } catch (e) { console.log('HASH', await page.evaluate(() => location.hash)); console.log('VIEW', (await page.textContent('#view')).slice(0, 300)); console.log('ERRORS', errors); throw e; }
await page.screenshot({ path: '/tmp/claude-0/shot-home.png' });

// New round, manual holes: 3 holes to keep it short
await page.click('#new'); await page.waitForSelector('#cname');
await page.fill('#cname', 'Test GC'); await page.selectOption('#holes', '9');
for (let h = 1; h <= 9; h++) { await page.fill(`input.par[data-h="${h}"]`, h === 2 ? '3' : '4'); await page.fill(`input.yds[data-h="${h}"]`, h === 2 ? '170' : '400'); }
await page.click('#start'); await page.waitForSelector('#save');
await page.screenshot({ path: '/tmp/claude-0/shot-conditions.png' });
await page.click('button[data-k="rain"][data-v="light"]'); await page.click('button[data-k="wind_strength"][data-v="moderate"]'); await page.click('button[data-k="wind_direction"][data-v="SW"]');
await page.click('#save'); await page.waitForSelector('.lie-grid');
await page.screenshot({ path: '/tmp/claude-0/shot-entry.png' });

// Go offline for the entry
await ctx.setOffline(true);
const enter = async (lie, dist, club, holed = false) => {
  await page.click(`button[data-lie="${lie}"]`);
  await page.click('button[data-key="C"]');
  for (const ch of String(dist)) await page.click(`button[data-key="${ch}"]`);
  if (club) await page.click(`button[data-club="${club}"]`);
  await page.click(holed ? '#holed' : '#save');
};
// Hole 1: drive 400 -> fairway 140 -> green 10ft -> holed  (Broadie example, birdie)
await page.click('button[data-club="Dr"]'); await page.click('#save');          // shot 1 preset at 400 yds
await enter('fairway', 140, '7i'); await enter('green', 10, 'Putter', true);
await page.waitForFunction(() => document.querySelector('.hole-head .big')?.textContent.includes('Hole 2'));
// Hole 2: par 3, tee 170 -> sand 20 -> green 8 -> green 2 -> holed (double bogey)
await page.click('#save'); await enter('sand', 20, 'SW'); await enter('green', 8, 'Putter'); await enter('green', 2, 'Putter', true);
await page.waitForFunction(() => document.querySelector('.hole-head .big')?.textContent.includes('Hole 3'));
await page.screenshot({ path: '/tmp/claude-0/shot-entry-h3.png' });
await page.goto('http://localhost:4173/#/round/' + (await page.evaluate(() => location.hash.split('/')[2])) + '/summary');
await page.waitForSelector('.cat-bars');
await page.screenshot({ path: '/tmp/claude-0/shot-summary.png', fullPage: true });
const summaryText = await page.textContent('#view');
console.log('summary strokes/holes:', await page.textContent('.big'), '| holes rows:', (await page.$$('table tr')).length - 1);
console.log('SG total shown:', await page.textContent('.cat-bar:last-child b.num'));
console.log('dirty/unsynced?', summaryText.includes('unsynced'));

// Back online: sync should push the round
await ctx.setOffline(false);
await page.goto('http://localhost:4173/#/settings'); await page.waitForSelector('#syncnow'); await page.click('#syncnow');
await page.waitForTimeout(1500);
console.log('upserts:', upserts.map((u) => u.url + ':' + (Array.isArray(u.body) ? u.body.length : 1)).join(', '));
console.log('sync info:', await page.textContent('#syncinfo'));
await page.screenshot({ path: '/tmp/claude-0/shot-settings.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
