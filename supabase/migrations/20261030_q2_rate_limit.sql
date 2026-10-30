-- =====================================================================
-- Q2. 조회 · 인증 횟수 제한, 반경 밖 프로필 조회 차단  (백로그 #2, 출시 막음)
-- 작성: 한서준(서버·보안) · 검수: 강민재(개발팀장) · 2026-10-30
--
-- 무엇이 문제였나
--   1) 주변 검색 · 프로필 조회 · 동네 인증에 횟수 제한이 없어, 프로그램으로 계속 불러
--      동네 회원 정보를 통째로 모으거나 위치를 바꿔 가며 거리를 재는 일이 가능했다.
--   2) 반경 밖 회원도 회원 ID만 알면 프로필을 열 수 있었다.
--
-- 바꾸는 것
--   - 한 시간 기준: 주변 메이트 120번, 주변 구인 글 120번, 프로필 열기 200번,
--     동네 인증 6번(하루 20번). 보통 사용자는 닿지 않는 수준이다.
--   - 프로필은 반경 10km 안에서 최근 동네 인증을 한 회원만 열린다.
--     채팅방이 있거나 쪽지를 주고받은 사이는 거리와 관계없이 열린다.
--
-- 실행 방법 (대표님): Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--   README "기존 DB 업데이트" 1~4번을 먼저 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 조회 · 인증 횟수 제한 (Q2) — 자동 수집 · 위치 역추적 방지
-- ---------------------------------------------------------------------
create table if not exists public.api_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action  text not null,
  bucket  timestamptz not null,  -- 1시간 단위
  hits    int not null default 0,
  primary key (user_id, action, bucket)
);
alter table public.api_hits enable row level security;
revoke all on public.api_hits from public, anon, authenticated;

-- 한 시간에 per_hour 번, 하루에 per_day 번(NULL = 제한 없음)까지만 허용
create or replace function public._rate_limit(uid uuid, act text, per_hour int, per_day int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  b timestamptz := date_trunc('hour', now());
  n int;
begin
  insert into public.api_hits (user_id, action, bucket, hits) values (uid, act, b, 1)
  on conflict (user_id, action, bucket) do update set hits = public.api_hits.hits + 1
  returning hits into n;
  if n > per_hour then raise exception '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'; end if;
  if per_day is not null and (select coalesce(sum(hits), 0) from public.api_hits
                              where user_id = uid and action = act and bucket > now() - interval '24 hours') > per_day then
    raise exception '오늘은 더 이상 할 수 없어요. 내일 다시 시도해 주세요.';
  end if;
  if random() < 0.01 then delete from public.api_hits where bucket < now() - interval '2 days'; end if;
end $$;

create or replace function public.verify_location(p_lat float8, p_lng float8, p_accuracy float8, p_region text,
                                                  p_district text default '', p_manual boolean default false,
                                                  p_provided_to text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  reg text := left(btrim(coalesce(p_region, '')), 40);
begin
  perform public._rate_limit(uid, 'verify', 6, 20);  -- 동네 인증: 시간당 6번, 하루 20번 (위치를 바꿔 가며 거리 재기 방지)
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception '위치 정보가 올바르지 않습니다.'; end if;
  if coalesce(p_manual, false) and not (public._settings()).allow_manual_location then
    raise exception '수동 위치 지정은 허용되지 않습니다. GPS로 인증해 주세요.';
  end if;
  if not coalesce(p_manual, false) and (p_accuracy is null or p_accuracy > 1000) then
    raise exception '위치 정확도가 너무 낮습니다(%m). 실외에서 다시 시도해 주세요.', coalesce(round(p_accuracy)::text, '?');
  end if;
  if reg = '' then reg := to_char(p_lat, 'FM990.000') || ', ' || to_char(p_lng, 'FM990.000') || ' 부근'; end if;
  insert into public.locations (user_id, lat, lng, region, district, verified_at)
  values (uid, p_lat, p_lng, reg, left(coalesce(p_district, ''), 60), now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, region = excluded.region,
    district = excluded.district, verified_at = excluded.verified_at;
  insert into public.location_logs (user_id, source, purpose, provided_to)
  values (uid, case when coalesce(p_manual, false) then 'manual' else 'gps' end, '동네 인증', left(p_provided_to, 100));
  -- 보관기간 지난 기록 정리 (위치 이용 기록 6개월, 처리된 신고 1년)
  delete from public.location_logs where created_at < now() - interval '183 days';
  delete from public.reports where status <> 'pending' and handled_at < now() - interval '365 days';
  return jsonb_build_object('region', reg, 'district', coalesce(p_district, ''));
end $$;

create or replace function public.nearby_profiles(radius_km float8 default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  r float8 := least(greatest(ceil(coalesce(radius_km, 3)), 1), 10);  -- 1km 단위만 (정확한 거리 역추적 방지)
  dlat float8 := (r + 1) / 111;
  dlng float8 := (r + 1) / (111 * cos(radians(me.lat)));
  vdays int := (public._settings()).verify_valid_days;
  users jsonb;
begin
  perform public._rate_limit(uid, 'nearby', 120);
  select coalesce(jsonb_agg(j order by fk, nick), '[]'::jsonb) into users from (
    select public._profile_json(p, l, me.lat, me.lng) as j, public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) as fk, p.nickname as nick
    from public.profiles p
    join public.locations l on l.user_id = p.id
    join public.account_status s on s.user_id = p.id
    where p.id <> uid and p.is_public and s.suspended_at is null
      and l.verified_at > now() - make_interval(days => vdays)
      and l.lat between me.lat - dlat and me.lat + dlat
      and l.lng between me.lng - dlng and me.lng + dlng
      and not public._is_blocked(uid, p.id)
  ) t where fk <= r;
  return jsonb_build_object('radius', r, 'region', me.region, 'users', users);
end $$;

create or replace function public.get_profile(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  p public.profiles;
  l public.locations;
  room_id bigint;
begin
  perform public._rate_limit(uid, 'profile', 200);
  select * into p from public.profiles where id = p_user;
  if not found or (not p.is_public and p.id <> uid) or not public._is_active(p.id) or public._is_blocked(uid, p.id) then
    raise exception '프로필을 찾을 수 없습니다.';
  end if;
  select * into l from public.locations where user_id = p.id;
  select id into room_id from public.rooms where user_a = least(uid, p.id) and user_b = greatest(uid, p.id);
  -- 반경 밖 회원은 ID를 알아도 볼 수 없음 (채팅방이 있거나 쪽지를 주고받은 사이는 예외)
  if p.id <> uid and room_id is null
     and not exists (select 1 from public.notes n where (n.from_id = uid and n.to_id = p.id) or (n.from_id = p.id and n.to_id = uid))
     and (l.user_id is null or l.verified_at <= now() - make_interval(days => (public._settings()).verify_valid_days)
          or public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) > 10) then
    raise exception '프로필을 찾을 수 없습니다.';
  end if;
  return public._profile_json(p, l, me.lat, me.lng) || jsonb_build_object(
    'roomId', room_id,
    'pendingNote', exists (select 1 from public.notes where from_id = uid and to_id = p.id and status = 'pending'),
    'trust', public._trust_json(p.id),
    'posts', (select coalesce(jsonb_agg(public._post_json(x, uid) order by x.id desc), '[]'::jsonb)
              from public.posts x where x.user_id = p.id and public._post_open(x)
                and (not x.same_gender or x.user_id = uid
                     or (select gender from public.profiles where id = uid) is not distinct from p.gender)));
end $$;

create or replace function public.nearby_posts(radius_km float8 default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  my_gender text := (select gender from public.profiles where id = uid);
  r float8 := least(greatest(ceil(coalesce(radius_km, 3)), 1), 10);  -- 1km 단위만 (정확한 거리 역추적 방지)
  dlat float8 := (r + 1) / 111;
  dlng float8 := (r + 1) / (111 * cos(radians(me.lat)));
  vdays int := (public._settings()).verify_valid_days;
  res jsonb;
begin
  perform public._rate_limit(uid, 'posts', 120);
  select coalesce(jsonb_agg(j order by dist, meet, pid), '[]'::jsonb) into res from (
    select public._post_json(x, uid) || jsonb_build_object('author', jsonb_build_object(
             'id', p.id, 'nickname', p.nickname, 'photo', p.photo_path, 'gender', p.gender, 'age', p.age,
             'verified', coalesce(p.bench_verified, p.squat_verified, p.deadlift_verified) is not null,
             'distanceKm', case when p.id = uid then 0 else public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) end)) as j,
           case when p.id = uid then -1 else public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) end as dist, x.id as pid,
           coalesce(x.meet_at, public._next_occurrence(x.days, x.time_of_day)) as meet
    from public.posts x
    join public.profiles p on p.id = x.user_id
    join public.locations l on l.user_id = p.id
    join public.account_status s on s.user_id = p.id
    where public._post_open(x)
      and (p.id = uid or (
            p.is_public and s.suspended_at is null
            and l.verified_at > now() - make_interval(days => vdays)
            and l.lat between me.lat - dlat and me.lat + dlat
            and l.lng between me.lng - dlng and me.lng + dlng
            and public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) <= r
            and not public._is_blocked(uid, p.id)
            and (not x.same_gender or p.gender is not distinct from my_gender)))
  ) t;
  return jsonb_build_object('radius', r, 'region', me.region, 'posts', res);
end $$;

revoke execute on function public._rate_limit(uuid, text, int, int) from public, anon, authenticated;
notify pgrst, 'reload schema';
