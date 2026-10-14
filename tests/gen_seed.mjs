import { PGA_TOUR, GOLFER_90 } from '../docs/baselines.js';
import { writeFileSync } from 'node:fs';
let sql = `-- Generated from docs/baselines.js by tests/gen_seed.mjs. Do not edit by hand.\n`;
for (const b of [PGA_TOUR, GOLFER_90]) {
  sql += `insert into baselines (id, name, source_url) values ('${b.id}', '${b.name.replace(/'/g,"''")}', '${b.source}') on conflict (id) do update set name = excluded.name, source_url = excluded.source_url;\n`;
  sql += `delete from baseline_points where baseline_id = '${b.id}';\ninsert into baseline_points (baseline_id, lie, distance, expected) values\n`;
  const rows = [];
  for (const [lie, pts] of Object.entries(b.lies)) for (const [d, v] of pts) rows.push(`('${b.id}','${lie}',${d},${v})`);
  sql += rows.join(',\n') + ';\n';
}
writeFileSync(new URL('../supabase/seed/0001_baselines.sql', import.meta.url), sql);
console.log('wrote seed');
