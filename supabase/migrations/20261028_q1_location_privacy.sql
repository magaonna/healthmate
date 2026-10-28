-- =====================================================================
-- Q1. 다른 회원의 실제 위치를 역추적하지 못하게 막기  (백로그 #1, 출시 막음)
-- 작성: 한서준(서버·보안) · 검수: 강민재(개발팀장) · 2026-10-28
--
-- 무엇이 문제였나
--   1) 거리를 "정확한 좌표"로 계산해 0.1km 단위로 보내 줘서, 내 위치를 바꿔 가며
--      여러 번 재면 상대의 실제 위치를 약 100m 안으로 계산할 수 있었다(삼각측량).
--   2) 지도에 쓰는 흐린 좌표의 흔들림 값(오프셋)을 공개된 회원 ID만으로 다시 계산할 수 있어,
--      흐린 좌표에서 원래 격자 위치를 되돌릴 수 있었다.
--
-- 바꾸는 것
--   1) 흔들림 값에 회원에게 공개되지 않는 비밀값(salt)을 섞는다. 비밀값은 누구도 읽을 수 없는
--      별도 표(app_secrets)에 두고, 서버 내부 함수만 읽는다. (app_settings는 누구나 읽을 수 있어서 쓰지 않음)
--   2) 거리는 상대의 "흐린 좌표" 기준으로 계산하고 1km 단위로 올림해서 보낸다. (1km 이내 → 1)
--      지도·목록에 보이는 정보로는 실제 위치를 300m보다 정확하게 알 수 없다.
--
-- 실행 방법 (대표님): Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--   여러 번 실행해도 안전하다. 실행 후 화면에서 거리가 "1km 이내 / 약 2km" 식으로 보이면 정상.
-- =====================================================================

-- 1) 비밀값 보관 표: 정책(policy)을 만들지 않아 브라우저에서는 아무도 읽거나 쓸 수 없다.
create table if not exists public.app_secrets (
  id            int primary key default 1 check (id = 1),
  location_salt text not null default md5(random()::text || clock_timestamp()::text || random()::text)
);
insert into public.app_secrets (id) values (1) on conflict (id) do nothing;
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;

create or replace function public._location_salt() returns text
language sql stable security definer set search_path = public as $$
  select location_salt from public.app_secrets where id = 1
$$;

-- 2) 흐린 좌표: 약 300m 격자 + 회원별 고정 흔들림(비밀값 섞음)
create or replace function public._approx(lat float8, lng float8, uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with k as (select md5(public._location_salt() || ':' || uid::text) as h)
  select jsonb_build_object(
    'lat', round(lat / 0.003) * 0.003 + ((('x' || substr(k.h, 1, 2))::bit(8)::int) / 255.0 - 0.5) * 0.0024,
    'lng', round(lng / 0.003) * 0.003 + ((('x' || substr(k.h, 3, 2))::bit(8)::int) / 255.0 - 0.5) * 0.0024)
  from k
$$;

-- 3) 다른 회원에게 보여 줄 거리: 상대의 흐린 좌표 기준, 1km 단위 올림 (최소 1)
create or replace function public._fuzzy_km(vlat float8, vlng float8, lat float8, lng float8, uid uuid) returns int
language sql stable security definer set search_path = public as $$
  with a as (select public._approx(lat, lng, uid) as j)
  select greatest(1, ceil(public._haversine(vlat, vlng, (a.j->>'lat')::float8, (a.j->>'lng')::float8)))::int
  from a
$$;

-- 4) 프로필 정보: distanceKm 계산만 바뀜
create or replace function public._profile_json(p public.profiles, loc public.locations, vlat float8, vlng float8) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'gender', p.gender, 'age', p.age, 'career', p.career,
    'bench', p.bench, 'squat', p.squat, 'deadlift', p.deadlift,
    'total', case when p.bench is not null and p.squat is not null and p.deadlift is not null then p.bench + p.squat + p.deadlift end,
    'gymName', coalesce(p.gym_name, ''),
    'workoutDays', to_jsonb(coalesce(p.workout_days, '{}')),
    'workoutTimes', to_jsonb(coalesce(p.workout_times, '{}')),
    'bio', coalesce(p.bio, ''),
    'prefs', jsonb_build_object('gender', p.pref_gender, 'ageMin', p.pref_age_min, 'ageMax', p.pref_age_max,
                                'minTotal', p.pref_min_total, 'note', coalesce(p.pref_note, '')),
    'photo', p.photo_path,
    'region', loc.region)
  || case when loc.user_id is null then '{}'::jsonb
          else public._approx(loc.lat, loc.lng, p.id)
               || case when vlat is null then '{}'::jsonb
                       else jsonb_build_object('distanceKm', public._fuzzy_km(vlat, vlng, loc.lat, loc.lng, p.id)) end
     end
$$;

-- 5) 내부 함수는 브라우저에서 직접 부를 수 없게 (schema.sql 끝의 권한 회수와 같은 규칙)
revoke execute on function public._location_salt() from public, anon, authenticated;
revoke execute on function public._approx(float8, float8, uuid) from public, anon, authenticated;
revoke execute on function public._fuzzy_km(float8, float8, float8, float8, uuid) from public, anon, authenticated;
revoke execute on function public._profile_json(public.profiles, public.locations, float8, float8) from public, anon, authenticated;

-- 참고: 위치 인증을 짧은 시간에 여러 번 바꿔 가며 거리를 재는 시도는 Q2(조회·인증 횟수 제한)에서 따로 막는다.
