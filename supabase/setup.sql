-- Strokes Gained Tracker — schema, row-level security, SG views.
-- Apply in the Supabase SQL editor or with `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------- enums ----------
create type lie_t as enum ('tee','fairway','rough','sand','recovery','green');
create type miss_t as enum ('none','left','right','short','long','short_left','short_right','long_left','long_right');
create type penalty_t as enum ('ob','lost','water','unplayable','other');
create type round_status_t as enum ('in_progress','complete');
create type entry_mode_t as enum ('live','post');
create type rain_t as enum ('none','light','steady','heavy');
create type wind_t as enum ('calm','light','moderate','strong');
create type wind_dir_t as enum ('N','NE','E','SE','S','SW','W','NW');
create type ground_t as enum ('soft','normal','firm');
create type member_status_t as enum ('pending','approved');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  handicap_index numeric(4,1),
  home_course_id uuid,
  default_baseline text not null default 'pga_tour',
  share_leaderboard boolean not null default false,
  bag jsonb not null default '["Dr","3w","5w","Hy","4i","5i","6i","7i","8i","9i","PW","GW","SW","LW","Putter"]',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------- courses ----------
create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id) on delete set null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create table course_holes (
  course_id uuid not null references courses(id) on delete cascade,
  tee_set text not null default 'White',
  hole_no smallint not null check (hole_no between 1 and 18),
  par smallint not null check (par between 3 and 6),
  yards smallint not null check (yards between 50 and 800),
  stroke_index smallint check (stroke_index between 1 and 18),
  primary key (course_id, tee_set, hole_no)
);
alter table profiles add constraint profiles_home_course_fk
  foreign key (home_course_id) references courses(id) on delete set null;

-- ---------- rounds, conditions, shots ----------
create table rounds (
  id uuid primary key,                         -- client-generated
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,
  course_name text not null,                   -- denormalised so a round survives course edits
  tee_set text not null default 'White',
  played_on date not null default current_date,
  holes_played smallint not null default 18 check (holes_played in (9,18)),
  status round_status_t not null default 'in_progress',
  entry_mode entry_mode_t not null default 'live',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table round_holes (
  round_id uuid not null references rounds(id) on delete cascade,
  hole_no smallint not null check (hole_no between 1 and 18),
  par smallint not null,
  yards smallint not null,
  primary key (round_id, hole_no)
);

create table round_conditions (
  id uuid primary key,                         -- client-generated
  round_id uuid not null references rounds(id) on delete cascade,
  from_hole smallint not null default 1 check (from_hole between 1 and 18),
  rain rain_t not null default 'none',
  wind_strength wind_t not null default 'calm',
  wind_direction wind_dir_t,
  temp_c smallint,
  fog boolean not null default false,
  frost boolean not null default false,
  ground ground_t not null default 'normal',
  notes text,
  created_at timestamptz not null default now(),
  unique (round_id, from_hole)
);

create table shots (
  id uuid primary key,                         -- client-generated: offline upserts are idempotent
  round_id uuid not null references rounds(id) on delete cascade,
  hole_no smallint not null check (hole_no between 1 and 18),
  shot_no smallint not null check (shot_no between 1 and 30),
  lie lie_t not null,
  distance numeric(5,1) not null check (distance >= 0),   -- yards; feet when lie = 'green'
  within_30 boolean,                           -- around-the-green flag; null = infer from distance
  club text,
  miss miss_t not null default 'none',
  penalty_strokes smallint not null default 0 check (penalty_strokes between 0 and 2),
  penalty_type penalty_t,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, hole_no, shot_no)
);
create index shots_round_idx on shots(round_id, hole_no, shot_no);
create index rounds_user_idx on rounds(user_id, played_on desc);

-- ---------- baselines ----------
create table baselines (
  id text primary key,
  name text not null,
  owner_id uuid references profiles(id) on delete cascade,  -- null = shared/published
  source_url text,
  created_at timestamptz not null default now()
);
create table baseline_points (
  baseline_id text not null references baselines(id) on delete cascade,
  lie lie_t not null,
  distance numeric(5,1) not null,
  expected numeric(6,4) not null,
  primary key (baseline_id, lie, distance)
);

-- ---------- friends ----------
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references profiles(id) on delete cascade,
  invite_code text not null unique default encode(gen_random_bytes(6),'hex'),
  created_at timestamptz not null default now()
);
create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status member_status_t not null default 'pending',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- The owner is automatically an approved member of their own group.
create or replace function add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, status) values (new.id, new.owner_id, 'approved')
    on conflict do nothing;
  return new;
end $$;
create trigger groups_owner_member after insert on groups
  for each row execute procedure add_owner_as_member();

-- ---------- updated_at ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger rounds_touch before update on rounds for each row execute procedure touch_updated_at();
create trigger shots_touch before update on shots for each row execute procedure touch_updated_at();

-- ---------- SG engine in SQL (mirrors web/sg.js) ----------
create or replace function sg_expected(p_baseline text, p_lie lie_t, p_distance numeric)
returns numeric language plpgsql stable as $$
declare
  lo record; hi record; v numeric; use_lie lie_t := p_lie; first_tee numeric;
begin
  if p_distance <= 0 then return 0; end if;
  if p_lie = 'tee' then
    select min(distance) into first_tee from baseline_points where baseline_id = p_baseline and lie = 'tee';
    if first_tee is null or p_distance < first_tee then use_lie := 'fairway'; end if;
  end if;
  select distance, expected into lo from baseline_points
    where baseline_id = p_baseline and lie = use_lie and distance <= p_distance
    order by distance desc limit 1;
  select distance, expected into hi from baseline_points
    where baseline_id = p_baseline and lie = use_lie and distance >= p_distance
    order by distance asc limit 1;
  if lo.distance is null and hi.distance is null then
    raise exception 'baseline % has no column for lie %', p_baseline, use_lie;
  end if;
  if lo.distance is null then return hi.expected; end if;           -- clamp below
  if hi.distance is null then                                       -- extrapolate above
    select distance, expected into hi from baseline_points
      where baseline_id = p_baseline and lie = use_lie and distance < lo.distance
      order by distance desc limit 1;
    if hi.distance is null then return lo.expected; end if;
    v := lo.expected + (p_distance - lo.distance) / (lo.distance - hi.distance) * (lo.expected - hi.expected);
    return greatest(v, 1);
  end if;
  if lo.distance = hi.distance then return lo.expected; end if;
  return lo.expected + (p_distance - lo.distance) / (hi.distance - lo.distance) * (hi.expected - lo.expected);
end $$;

-- Per-shot SG against the user's default baseline (or pga_tour).
create or replace view shot_sg with (security_invoker = true) as
with s as (
  select sh.*, rh.par,
         coalesce(p.default_baseline, 'pga_tour') as baseline_id,
         lead(sh.lie) over w as next_lie,
         lead(sh.distance) over w as next_distance,
         (select c.id from round_conditions c
            where c.round_id = sh.round_id and c.from_hole <= sh.hole_no
            order by c.from_hole desc limit 1) as conditions_id
  from shots sh
  join rounds r on r.id = sh.round_id
  join profiles p on p.id = r.user_id
  left join round_holes rh on rh.round_id = sh.round_id and rh.hole_no = sh.hole_no
  window w as (partition by sh.round_id, sh.hole_no order by sh.shot_no)
)
select s.id, s.round_id, s.hole_no, s.shot_no, s.lie, s.distance, s.club, s.miss,
       s.penalty_strokes, s.penalty_type, s.notes, s.par, s.baseline_id, s.conditions_id,
       case
         when s.lie = 'green' then 'putt'
         when s.lie = 'tee' and s.shot_no = 1 then case when s.par = 3 then 'app' else 'ott' end
         when coalesce(s.within_30, s.distance <= 30) then 'arg'
         else 'app' end as category,
       sg_expected(s.baseline_id, s.lie, s.distance) as start_expected,
       case when s.next_lie is null then 0 else sg_expected(s.baseline_id, s.next_lie, s.next_distance) end as end_expected,
       sg_expected(s.baseline_id, s.lie, s.distance)
         - case when s.next_lie is null then 0 else sg_expected(s.baseline_id, s.next_lie, s.next_distance) end
         - (1 + s.penalty_strokes) as sg
from s;

create or replace view round_summary with (security_invoker = true) as
select r.id as round_id, r.user_id, r.played_on, r.course_name, r.status, r.holes_played,
       count(distinct x.hole_no) as holes_logged,
       sum(1 + x.penalty_strokes) as strokes,
       sum(case when x.category='ott' then x.sg else 0 end) as sg_ott,
       sum(case when x.category='app' then x.sg else 0 end) as sg_app,
       sum(case when x.category='arg' then x.sg else 0 end) as sg_arg,
       sum(case when x.category='putt' then x.sg else 0 end) as sg_putt,
       sum(x.sg) as sg_total
from rounds r
join shot_sg x on x.round_id = r.id
group by r.id;

-- ---------- row-level security ----------
alter table profiles enable row level security;
alter table courses enable row level security;
alter table course_holes enable row level security;
alter table rounds enable row level security;
alter table round_holes enable row level security;
alter table round_conditions enable row level security;
alter table shots enable row level security;
alter table baselines enable row level security;
alter table baseline_points enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());

create policy "courses readable" on courses for select using (auth.role() = 'authenticated');
create policy "courses insert" on courses for insert with check (created_by = auth.uid());
create policy "courses edit own" on courses for update using (created_by = auth.uid());
create policy "holes readable" on course_holes for select using (auth.role() = 'authenticated');
create policy "holes edit own" on course_holes for all using (
  exists (select 1 from courses c where c.id = course_id and c.created_by = auth.uid()));

create policy "own rounds" on rounds for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own round holes" on round_holes for all using (
  exists (select 1 from rounds r where r.id = round_id and r.user_id = auth.uid()));
create policy "own conditions" on round_conditions for all using (
  exists (select 1 from rounds r where r.id = round_id and r.user_id = auth.uid()));
create policy "own shots" on shots for all using (
  exists (select 1 from rounds r where r.id = round_id and r.user_id = auth.uid()));

create policy "baselines readable" on baselines for select using (owner_id is null or owner_id = auth.uid());
create policy "baseline points readable" on baseline_points for select using (
  exists (select 1 from baselines b where b.id = baseline_id and (b.owner_id is null or b.owner_id = auth.uid())));

create policy "groups visible to members" on groups for select using (
  owner_id = auth.uid() or exists (select 1 from group_members m where m.group_id = id and m.user_id = auth.uid()));
create policy "groups create" on groups for insert with check (owner_id = auth.uid());
create policy "groups owner edit" on groups for update using (owner_id = auth.uid());
-- Helper bypasses RLS so group policies do not recurse into themselves.
create or replace function is_approved_member(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid() and status = 'approved')
$$;
create or replace function is_group_owner(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from groups where id = gid and owner_id = auth.uid())
$$;
create policy "members visible" on group_members for select using (
  user_id = auth.uid() or is_group_owner(group_id) or is_approved_member(group_id));
create policy "request to join" on group_members for insert with check (user_id = auth.uid() and status = 'pending');
create policy "owner approves" on group_members for update using (is_group_owner(group_id));
create policy "leave or remove" on group_members for delete using (user_id = auth.uid() or is_group_owner(group_id));

-- Join a group by invite code without exposing the groups table to non-members.
create or replace function join_group(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select id into gid from groups where invite_code = p_code;
  if gid is null then raise exception 'Unknown invite code'; end if;
  insert into group_members (group_id, user_id, status) values (gid, auth.uid(), 'pending')
    on conflict do nothing;
  return gid;
end $$;

-- Leaderboard: round-level category totals only, for approved co-members who opted in.
-- Security definer because round_summary is RLS-limited to the caller's own rounds.
create or replace function leaderboard(p_group uuid)
returns table (user_id uuid, display_name text, handicap_index numeric, rounds bigint,
               sg_total numeric, sg_ott numeric, sg_app numeric, sg_arg numeric, sg_putt numeric)
language sql security definer stable set search_path = public as $$
  select p.id, p.display_name, p.handicap_index, count(*) as rounds,
         avg(rs.sg_total), avg(rs.sg_ott), avg(rs.sg_app), avg(rs.sg_arg), avg(rs.sg_putt)
  from group_members m
  join profiles p on p.id = m.user_id and p.share_leaderboard
  join lateral (select * from round_summary r where r.user_id = p.id and r.status='complete'
                order by r.played_on desc limit 10) rs on true
  where m.group_id = p_group and m.status = 'approved'
    and (is_approved_member(p_group) or is_group_owner(p_group))
  group by p.id
$$;

create policy "group members see names" on profiles for select using (
  exists (select 1 from group_members b where b.user_id = profiles.id and b.status='approved' and is_approved_member(b.group_id)));
-- Generated from web/baselines.js by tests/gen_seed.mjs. Do not edit by hand.
insert into baselines (id, name, source_url) values ('pga_tour', 'PGA Tour', 'https://business.columbia.edu/sites/default/files-efs/pubfiles/4996/assessing_golfer_performance.full.pdf') on conflict (id) do update set name = excluded.name, source_url = excluded.source_url;
delete from baseline_points where baseline_id = 'pga_tour';
insert into baseline_points (baseline_id, lie, distance, expected) values
('pga_tour','tee',100,2.92),
('pga_tour','tee',120,2.99),
('pga_tour','tee',140,2.97),
('pga_tour','tee',160,2.99),
('pga_tour','tee',180,3.05),
('pga_tour','tee',200,3.12),
('pga_tour','tee',220,3.17),
('pga_tour','tee',240,3.25),
('pga_tour','tee',260,3.45),
('pga_tour','tee',280,3.65),
('pga_tour','tee',300,3.71),
('pga_tour','tee',320,3.79),
('pga_tour','tee',340,3.86),
('pga_tour','tee',360,3.92),
('pga_tour','tee',380,3.96),
('pga_tour','tee',400,3.99),
('pga_tour','tee',420,4.02),
('pga_tour','tee',440,4.08),
('pga_tour','tee',460,4.17),
('pga_tour','tee',480,4.28),
('pga_tour','tee',500,4.41),
('pga_tour','tee',520,4.54),
('pga_tour','tee',540,4.65),
('pga_tour','tee',560,4.74),
('pga_tour','tee',580,4.79),
('pga_tour','tee',600,4.82),
('pga_tour','fairway',10,2.18),
('pga_tour','fairway',20,2.4),
('pga_tour','fairway',30,2.52),
('pga_tour','fairway',40,2.6),
('pga_tour','fairway',50,2.66),
('pga_tour','fairway',60,2.7),
('pga_tour','fairway',70,2.72),
('pga_tour','fairway',80,2.75),
('pga_tour','fairway',90,2.77),
('pga_tour','fairway',100,2.8),
('pga_tour','fairway',120,2.85),
('pga_tour','fairway',140,2.91),
('pga_tour','fairway',160,2.98),
('pga_tour','fairway',180,3.08),
('pga_tour','fairway',200,3.19),
('pga_tour','fairway',220,3.32),
('pga_tour','fairway',240,3.45),
('pga_tour','fairway',260,3.58),
('pga_tour','fairway',280,3.69),
('pga_tour','fairway',300,3.78),
('pga_tour','fairway',320,3.84),
('pga_tour','fairway',340,3.88),
('pga_tour','fairway',360,3.95),
('pga_tour','fairway',380,4.03),
('pga_tour','fairway',400,4.11),
('pga_tour','fairway',420,4.19),
('pga_tour','fairway',440,4.27),
('pga_tour','fairway',460,4.34),
('pga_tour','fairway',480,4.42),
('pga_tour','fairway',500,4.5),
('pga_tour','fairway',520,4.58),
('pga_tour','fairway',540,4.66),
('pga_tour','fairway',560,4.74),
('pga_tour','fairway',580,4.82),
('pga_tour','fairway',600,4.89),
('pga_tour','rough',10,2.34),
('pga_tour','rough',20,2.59),
('pga_tour','rough',30,2.7),
('pga_tour','rough',40,2.78),
('pga_tour','rough',50,2.87),
('pga_tour','rough',60,2.91),
('pga_tour','rough',70,2.93),
('pga_tour','rough',80,2.96),
('pga_tour','rough',90,2.99),
('pga_tour','rough',100,3.02),
('pga_tour','rough',120,3.08),
('pga_tour','rough',140,3.15),
('pga_tour','rough',160,3.23),
('pga_tour','rough',180,3.31),
('pga_tour','rough',200,3.42),
('pga_tour','rough',220,3.53),
('pga_tour','rough',240,3.64),
('pga_tour','rough',260,3.74),
('pga_tour','rough',280,3.83),
('pga_tour','rough',300,3.9),
('pga_tour','rough',320,3.95),
('pga_tour','rough',340,4.02),
('pga_tour','rough',360,4.11),
('pga_tour','rough',380,4.21),
('pga_tour','rough',400,4.3),
('pga_tour','rough',420,4.4),
('pga_tour','rough',440,4.49),
('pga_tour','rough',460,4.58),
('pga_tour','rough',480,4.68),
('pga_tour','rough',500,4.77),
('pga_tour','rough',520,4.87),
('pga_tour','rough',540,4.96),
('pga_tour','rough',560,5.06),
('pga_tour','rough',580,5.15),
('pga_tour','rough',600,5.25),
('pga_tour','sand',10,2.43),
('pga_tour','sand',20,2.53),
('pga_tour','sand',30,2.66),
('pga_tour','sand',40,2.82),
('pga_tour','sand',50,2.92),
('pga_tour','sand',60,3.15),
('pga_tour','sand',70,3.21),
('pga_tour','sand',80,3.24),
('pga_tour','sand',90,3.24),
('pga_tour','sand',100,3.23),
('pga_tour','sand',120,3.21),
('pga_tour','sand',140,3.22),
('pga_tour','sand',160,3.28),
('pga_tour','sand',180,3.4),
('pga_tour','sand',200,3.55),
('pga_tour','sand',220,3.7),
('pga_tour','sand',240,3.84),
('pga_tour','sand',260,3.93),
('pga_tour','sand',280,4),
('pga_tour','sand',300,4.04),
('pga_tour','sand',320,4.12),
('pga_tour','sand',340,4.26),
('pga_tour','sand',360,4.41),
('pga_tour','sand',380,4.55),
('pga_tour','sand',400,4.69),
('pga_tour','sand',420,4.83),
('pga_tour','sand',440,4.97),
('pga_tour','sand',460,5.11),
('pga_tour','sand',480,5.25),
('pga_tour','sand',500,5.4),
('pga_tour','sand',520,5.54),
('pga_tour','sand',540,5.68),
('pga_tour','sand',560,5.82),
('pga_tour','sand',580,5.96),
('pga_tour','sand',600,6.1),
('pga_tour','recovery',10,3.45),
('pga_tour','recovery',20,3.51),
('pga_tour','recovery',30,3.57),
('pga_tour','recovery',40,3.71),
('pga_tour','recovery',50,3.79),
('pga_tour','recovery',60,3.83),
('pga_tour','recovery',70,3.84),
('pga_tour','recovery',80,3.84),
('pga_tour','recovery',90,3.82),
('pga_tour','recovery',100,3.8),
('pga_tour','recovery',120,3.78),
('pga_tour','recovery',140,3.8),
('pga_tour','recovery',160,3.81),
('pga_tour','recovery',180,3.82),
('pga_tour','recovery',200,3.87),
('pga_tour','recovery',220,3.92),
('pga_tour','recovery',240,3.97),
('pga_tour','recovery',260,4.03),
('pga_tour','recovery',280,4.1),
('pga_tour','recovery',300,4.2),
('pga_tour','recovery',320,4.31),
('pga_tour','recovery',340,4.44),
('pga_tour','recovery',360,4.56),
('pga_tour','recovery',380,4.66),
('pga_tour','recovery',400,4.75),
('pga_tour','recovery',420,4.84),
('pga_tour','recovery',440,4.94),
('pga_tour','recovery',460,5.03),
('pga_tour','recovery',480,5.13),
('pga_tour','recovery',500,5.22),
('pga_tour','recovery',520,5.32),
('pga_tour','recovery',540,5.41),
('pga_tour','recovery',560,5.51),
('pga_tour','recovery',580,5.6),
('pga_tour','recovery',600,5.7),
('pga_tour','green',1,1.001),
('pga_tour','green',2,1.01),
('pga_tour','green',3,1.04),
('pga_tour','green',4,1.13),
('pga_tour','green',5,1.23),
('pga_tour','green',6,1.34),
('pga_tour','green',7,1.42),
('pga_tour','green',8,1.5),
('pga_tour','green',9,1.56),
('pga_tour','green',10,1.61),
('pga_tour','green',15,1.78),
('pga_tour','green',20,1.87),
('pga_tour','green',30,1.98),
('pga_tour','green',40,2.06),
('pga_tour','green',50,2.14),
('pga_tour','green',60,2.21),
('pga_tour','green',90,2.4);
insert into baselines (id, name, source_url) values ('golfer_90', '90-golfer (putting only)', 'https://golfingfocus.com/what-percentage-of-putts-do-pros-make-tv-does-not-tell-the-story/') on conflict (id) do update set name = excluded.name, source_url = excluded.source_url;
delete from baseline_points where baseline_id = 'golfer_90';
insert into baseline_points (baseline_id, lie, distance, expected) values
('golfer_90','green',1,1.01),
('golfer_90','green',2,1.06),
('golfer_90','green',3,1.17),
('golfer_90','green',4,1.36),
('golfer_90','green',5,1.51),
('golfer_90','green',6,1.62),
('golfer_90','green',7,1.69),
('golfer_90','green',8,1.75),
('golfer_90','green',9,1.79),
('golfer_90','green',10,1.82),
('golfer_90','green',15,1.94),
('golfer_90','green',20,2.02),
('golfer_90','green',30,2.16),
('golfer_90','green',40,2.3),
('golfer_90','green',50,2.41),
('golfer_90','green',60,2.51);
