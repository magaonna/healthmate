-- 짐짝 시연용 데이터. demo-a / demo-b 두 계정에만 적용. 여러 번 실행해도 안전.
-- 먼저: Authentication → Users → Add user → Create new user (Auto Confirm User 체크) 로 두 계정 생성
do $$
declare
  emails text[] := array['demo-a@example.com', 'demo-b@example.com'];
  n int;
begin
  select count(*) into n from auth.users where email = any(emails);
  if n <> 2 then raise exception '시연 계정 2개를 먼저 만들어 주세요 (찾은 개수: %)', n; end if;

  insert into public.profiles (id, nickname)
  select id, case email when 'demo-a@example.com' then '시연A' else '시연B' end
  from auth.users where email = any(emails)
  on conflict (id) do nothing;

  update public.profiles p set
    nickname = case u.email when 'demo-a@example.com' then '시연A' else '시연B' end,
    gender = 'male', age = 30, career = '2~3년',
    bench = 100, squat = 140, deadlift = 180,
    gym_name = '짐짝 시연 헬스장', workout_days = '{월,수,금}', workout_times = '{저녁}',
    bio = '시연용 계정입니다', is_public = true, updated_at = now()
  from auth.users u where u.id = p.id and u.email = any(emails);

  insert into public.account_status (user_id, terms_agreed_at, terms_version)
  select id, now(), (select terms_version from public.app_settings where id = 1)
  from auth.users where email = any(emails)
  on conflict (user_id) do update set terms_agreed_at = excluded.terms_agreed_at,
    terms_version = excluded.terms_version, suspended_at = null, suspended_reason = null;

  -- 두 계정을 같은 동네로 (시연 위치: 바꿔도 됨). 30일 유효
  insert into public.locations (user_id, lat, lng, region, district, verified_at)
  select id, 37.4979, 127.0276, '역삼1동', '서울 강남구', now()
  from auth.users where email = any(emails)
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, region = excluded.region,
    district = excluded.district, verified_at = excluded.verified_at;

  -- 영상 인증 검토용: demo-a 를 관리자로 (관리자는 본인 영상을 검토할 수 없으니 영상은 demo-b 가 올림)
  insert into public.admins (user_id)
  select id from auth.users where email = 'demo-a@example.com'
  on conflict (user_id) do nothing;
end $$;
