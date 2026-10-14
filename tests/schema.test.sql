\set ON_ERROR_STOP on
\i tests/local_auth_stub.sql
\i supabase/migrations/0001_schema.sql
\i supabase/seed/0001_baselines.sql
-- two users
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','nick@example.com'), ('22222222-2222-2222-2222-222222222222','mate@example.com');
-- interpolation checks mirror tests/sg.test.mjs
select 'tee400', sg_expected('pga_tour','tee',400) = 3.99 as ok;
select 'fw150', round(sg_expected('pga_tour','fairway',150),4) = 2.9450 as ok;
select 'green12.5', round(sg_expected('pga_tour','green',12.5),4) = 1.6950 as ok;
select 'clamp', sg_expected('pga_tour','fairway',5) = 2.18 as ok;
select 'short tee', sg_expected('pga_tour','tee',80) = sg_expected('pga_tour','fairway',80) as ok;
-- act as Nick
set role postgres; -- superuser bypasses RLS; emulate the RLS path with a non-superuser role
do $$ begin if not exists (select 1 from pg_roles where rolname='app_user') then create role app_user nologin; end if; end $$; grant usage on schema public, auth to app_user; grant execute on all functions in schema auth to app_user; grant all on all tables in schema public to app_user; grant execute on all functions in schema public to app_user;
grant app_user to postgres;
set role app_user;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);
insert into rounds (id,user_id,course_name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Test GC');
insert into round_holes values ('aaaaaaaa-0000-0000-0000-000000000001',1,4,400),('aaaaaaaa-0000-0000-0000-000000000001',2,3,170);
insert into round_conditions (id,round_id,from_hole,rain,wind_strength) values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,'none','calm');
insert into round_conditions (id,round_id,from_hole,rain,wind_strength) values ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',2,'steady','strong');
insert into shots (id,round_id,hole_no,shot_no,lie,distance,penalty_strokes) values
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',1,1,'tee',400,1),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',1,2,'tee',400,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',1,3,'fairway',140,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',1,4,'green',10,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,1,'tee',170,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,2,'sand',20,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,3,'green',8,0),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,4,'green',2,0);
select hole_no, shot_no, category, round(sg,2) as sg, conditions_id from shot_sg order by 1,2;
select strokes, round(sg_total,2) sg_total, round(sg_ott,2) ott, round(sg_app,2) app, round(sg_arg,2) arg, round(sg_putt,2) putt from round_summary;
-- identity: hole1 baseline 3.99 - 5 strokes = -1.01 ; hole2 baseline J(tee,170)=3.02 - 4 = -0.98 ; total -1.99
select 'identity', round(sum(sg),2) = round(3.99 + sg_expected('pga_tour','tee',170) - 9, 2) as ok from shot_sg;
-- RLS: mate sees nothing
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'rls_rounds', count(*) = 0 as ok from rounds;
select 'rls_shots', count(*) = 0 as ok from shot_sg;
-- groups: mate creates a group, nick requests to join, mate approves, nick opts into leaderboard
insert into groups (id,name,owner_id) values ('dddddddd-0000-0000-0000-000000000001','Saturday fourball','22222222-2222-2222-2222-222222222222');
\set code `psql -h /tmp -p 5433 -U postgres -d sgtest -X -tA -c "select invite_code from groups where id='dddddddd-0000-0000-0000-000000000001'"`
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'join', join_group(:'code') = 'dddddddd-0000-0000-0000-000000000001' as ok;
select 'pending_hidden_from_lb', count(*) = 0 as ok from leaderboard('dddddddd-0000-0000-0000-000000000001');
update profiles set share_leaderboard = true where id = auth.uid();
update rounds set status='complete';
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
update group_members set status='approved' where group_id='dddddddd-0000-0000-0000-000000000001';
select 'owner_sees_nick', display_name, rounds, round(sg_total,2) from leaderboard('dddddddd-0000-0000-0000-000000000001');
select 'owner_sees_name', count(*) = 1 as ok from profiles where id = '11111111-1111-1111-1111-111111111111';
select 'owner_still_no_shots', count(*) = 0 as ok from shots;
