-- =====================================================================
-- 지도 제거: 다른 회원의 흐린 좌표(lat/lng)를 더 이상 보내지 않기
-- 2026-10-28
--
-- 화면에서 지도를 뺐으므로, 주변 회원 목록 · 프로필 · 채팅방 정보에 들어 있던
-- 다른 회원의 근사 좌표(약 300m 범위)를 응답에서 없앤다. 거리(1km 단위)는 그대로 보낸다.
-- 내 정보(get_me)의 내 좌표는 본인만 받으므로 그대로 둔다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--   20261028_q1_location_privacy.sql 을 먼저 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.
-- =====================================================================

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
  || case when loc.user_id is null or vlat is null then '{}'::jsonb
          else jsonb_build_object('distanceKm', public._fuzzy_km(vlat, vlng, loc.lat, loc.lng, p.id))
     end
$$;

revoke execute on function public._profile_json(public.profiles, public.locations, float8, float8) from public, anon, authenticated;
