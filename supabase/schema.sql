-- =====================================================================
-- 짐짝(GYMJJAK) – Supabase 스키마
--   Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여넣고 Run.
--   여러 번 실행해도 안전합니다 (기존 데이터는 유지).
--
--   구성: 테이블 + RLS(행 단위 보안) + RPC 함수 + 가입 트리거 + 사진 저장소 + 실시간
--   규칙(차단, 신고, 자동 정지, 약관 동의 등)은 모두 아래 함수 안에서 검사합니다.
--   브라우저는 공개키(publishable key)로 이 함수들만 호출할 수 있습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 설정
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id                     int primary key default 1 check (id = 1),
  terms_version          text not null default '2026-10-26', -- 약관을 바꾸면 날짜를 올림 → 기존 회원 재동의
  allow_manual_location  boolean not null default false,     -- 개발용: 지도 클릭으로 동네 인증 허용
  auto_suspend_reporters int not null default 3,             -- 30일 내 서로 다른 N명에게 신고되면 자동 정지
  verify_valid_days      int not null default 30,            -- 동네 인증 유효기간
  daily_note_limit       int not null default 20
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  nickname       text not null check (char_length(nickname) between 2 and 20),
  gender         text check (gender in ('male', 'female')),
  age            int check (age between 14 and 99),
  career         text check (career in ('6개월 미만', '6개월~1년', '1~2년', '2~3년', '3~5년', '5년 이상')),
  bench          int check (bench between 0 and 500),
  squat          int check (squat between 0 and 500),
  deadlift       int check (deadlift between 0 and 500),
  gym_name       text check (char_length(gym_name) <= 50),
  workout_days   text[] not null default '{}' check (workout_days <@ array['월', '화', '수', '목', '금', '토', '일']),
  workout_times  text[] not null default '{}' check (workout_times <@ array['새벽', '오전', '점심', '오후', '저녁', '밤']),
  bio            text check (char_length(bio) <= 500),
  pref_gender    text check (pref_gender in ('male', 'female')),
  pref_age_min   int check (pref_age_min between 14 and 99),
  pref_age_max   int check (pref_age_max between 14 and 99),
  pref_min_total int check (pref_min_total between 0 and 1500),
  pref_note      text check (char_length(pref_note) <= 200),
  photo_path     text,  -- storage 'avatars' 버킷 안의 경로
  is_public      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (pref_age_min is null or pref_age_max is null or pref_age_min <= pref_age_max)
);

-- 약관 동의 · 이용 정지 (회원이 직접 수정할 수 없도록 프로필과 분리)
create table if not exists public.account_status (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  terms_agreed_at  timestamptz,
  terms_version    text,
  suspended_at     timestamptz,
  suspended_reason text
);

-- 동네 인증 (정확한 좌표는 본인만 조회 가능, 다른 회원에게는 근사 좌표만)
create table if not exists public.locations (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  region      text not null,
  district    text,
  verified_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id         bigint generated always as identity primary key,
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  from_id    uuid not null references auth.users (id) on delete cascade,
  to_id      uuid not null references auth.users (id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 300),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  room_id    bigint references public.rooms (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notes_to_idx on public.notes (to_id, status);
create index if not exists notes_from_idx on public.notes (from_id);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  room_id    bigint not null references public.rooms (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists messages_room_idx on public.messages (room_id, id);

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- 신고: 대상이 탈퇴해도 기록은 남김 (target_id NULL + 닉네임 스냅샷)
create table if not exists public.reports (
  id              bigint generated always as identity primary key,
  reporter_id     uuid references auth.users (id) on delete set null,
  target_id       uuid references auth.users (id) on delete set null,
  target_nickname text not null,
  reason          text not null,
  detail          text,
  evidence        jsonb,  -- 채팅방에서 신고한 경우 최근 대화 30개
  status          text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  created_at      timestamptz not null default now(),
  handled_at      timestamptz
);
create index if not exists reports_target_idx on public.reports (target_id, status);

-- 위치정보 이용·제공사실 확인자료 (위치정보법, 6개월 보관). 좌표는 저장하지 않음
create table if not exists public.location_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid,  -- 탈퇴 후에도 보관 기간 동안 유지
  source      text not null,
  purpose     text not null,
  provided_to text,
  created_at  timestamptz not null default now()
);

-- 정지 상태로 탈퇴한 계정의 이메일 · 카카오 회원번호 (재가입 방지, SHA-256 해시만 보관)
create table if not exists public.banned_emails (
  email_hash text primary key,
  created_at timestamptz not null default now()
);

-- 관리자: insert into public.admins (user_id) select id from public.profiles where nickname = '관리자 닉네임';
--   (이메일로 가입했다면: select id from auth.users where email = '관리자@이메일')
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------
-- RLS: 직접 조회는 본인 데이터만. 그 밖의 읽기/쓰기는 모두 아래 RPC 함수로.
-- (messages / notes 조회 정책은 실시간 알림을 받기 위해 필요)
-- ---------------------------------------------------------------------
alter table public.app_settings   enable row level security;
alter table public.profiles       enable row level security;
alter table public.account_status enable row level security;
alter table public.locations      enable row level security;
alter table public.rooms          enable row level security;
alter table public.notes          enable row level security;
alter table public.messages       enable row level security;
alter table public.blocks         enable row level security;
alter table public.reports        enable row level security;
alter table public.location_logs  enable row level security;
alter table public.banned_emails  enable row level security;
alter table public.admins         enable row level security;

drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select to anon, authenticated using (true);

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "status_own" on public.account_status;
create policy "status_own" on public.account_status for select to authenticated using (user_id = auth.uid());

drop policy if exists "locations_own" on public.locations;
create policy "locations_own" on public.locations for select to authenticated using (user_id = auth.uid());

drop policy if exists "rooms_member" on public.rooms;
create policy "rooms_member" on public.rooms for select to authenticated using (auth.uid() in (user_a, user_b));

drop policy if exists "notes_party" on public.notes;
create policy "notes_party" on public.notes for select to authenticated using (auth.uid() in (from_id, to_id));

drop policy if exists "messages_member" on public.messages;
create policy "messages_member" on public.messages for select to authenticated using (
  exists (select 1 from public.rooms r where r.id = messages.room_id and auth.uid() in (r.user_a, r.user_b))
);

drop policy if exists "blocks_own" on public.blocks;
create policy "blocks_own" on public.blocks for select to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------
-- 내부 도우미 함수 (브라우저에서 직접 호출 불가 – 파일 끝에서 권한 회수)
-- ---------------------------------------------------------------------
create or replace function public._settings() returns public.app_settings
language sql stable security definer set search_path = public as $$
  select * from public.app_settings where id = 1
$$;

create or replace function public._email_hash(email text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex')
$$;

-- 재가입 방지용 키: 이메일 + 소셜 계정(카카오 회원번호 등). 소셜 로그인은 user_metadata 에 provider_id / sub 가 들어있음
create or replace function public._ban_keys(email text, app_meta jsonb, user_meta jsonb) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when nullif(btrim(email), '') is not null then public._email_hash(email) end,
    case when coalesce(app_meta->>'provider', 'email') <> 'email'
              and coalesce(user_meta->>'provider_id', user_meta->>'sub') is not null
         then public._email_hash((app_meta->>'provider') || ':' || coalesce(user_meta->>'provider_id', user_meta->>'sub')) end
  ], null)
$$;

create or replace function public._haversine(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- 다른 회원에게 보여줄 근사 좌표: 약 300m 격자 + 회원별 고정 오프셋
create or replace function public._approx(lat float8, lng float8, uid uuid) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'lat', round(lat / 0.003) * 0.003 + ((('x' || substr(md5(uid::text), 1, 2))::bit(8)::int) / 255.0 - 0.5) * 0.0024,
    'lng', round(lng / 0.003) * 0.003 + ((('x' || substr(md5(uid::text), 3, 2))::bit(8)::int) / 255.0 - 0.5) * 0.0024)
$$;

create or replace function public._is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create or replace function public._is_active(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_status where user_id = uid and suspended_at is null)
$$;

create or replace function public._is_admin(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = uid)
$$;

-- 가입 트리거 이전에 생긴 계정 등 프로필이 없으면 만들어 준다
create or replace function public._ensure_profile(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb;
  nick text;
begin
  if exists (select 1 from public.profiles where id = uid) then return; end if;
  select coalesce(raw_user_meta_data, '{}'::jsonb) into meta from auth.users where id = uid;
  nick := left(btrim(coalesce(meta->>'nickname', meta->>'name', meta->>'full_name', meta->>'preferred_username', meta->>'user_name', '')), 20);
  if char_length(nick) < 2 then nick := '짐짝러' || (1000 + floor(random() * 9000))::int; end if;
  insert into public.profiles (id, nickname) values (uid, nick) on conflict (id) do nothing;
  insert into public.account_status (user_id) values (uid) on conflict (user_id) do nothing;
end $$;

-- 로그인 + 약관 동의 + 정지 아님 → 사용자 id
create or replace function public._require_active() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  st public.account_status;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into st from public.account_status where user_id = uid;
  if st.suspended_at is not null then raise exception 'SUSPENDED'; end if;
  if st.terms_agreed_at is null or st.terms_version is distinct from (public._settings()).terms_version then
    raise exception 'NEED_CONSENT';
  end if;
  return uid;
end $$;

create or replace function public._require_verified(uid uuid) returns public.locations
language plpgsql stable security definer set search_path = public as $$
declare loc public.locations;
begin
  select * into loc from public.locations
    where user_id = uid and verified_at > now() - make_interval(days => (public._settings()).verify_valid_days);
  if not found then raise exception 'NEED_VERIFY'; end if;
  return loc;
end $$;

create or replace function public._require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public._is_admin(auth.uid()) then raise exception '관리자만 사용할 수 있습니다.'; end if;
  return auth.uid();
end $$;

-- 화면에 보여줄 프로필 JSON (vlat/vlng 가 있으면 거리 포함)
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
                       else jsonb_build_object('distanceKm', round(public._haversine(vlat, vlng, loc.lat, loc.lng)::numeric, 1)) end
     end
$$;

create or replace function public._small_user(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'nickname', p.nickname, 'photo', p.photo_path, 'region', l.region)
  from public.profiles p left join public.locations l on l.user_id = p.id where p.id = uid
$$;

-- 빈 값은 NULL, 범위를 벗어나면 안내 문구로 오류
create or replace function public._opt_int(p jsonb, k text, lo int, hi int, label text) returns int
language plpgsql immutable as $$
declare
  v text := nullif(btrim(coalesce(p->>k, '')), '');
  n numeric;
begin
  if v is null then return null; end if;
  begin
    n := v::numeric;
  exception when others then
    raise exception '%: %~% 사이 숫자로 입력해 주세요.', label, lo, hi;
  end;
  if n <> trunc(n) or n < lo or n > hi then raise exception '%: %~% 사이 숫자로 입력해 주세요.', label, lo, hi; end if;
  return n::int;
end $$;

create or replace function public._ordered(vals jsonb, allowed text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(a order by i), '{}')
  from unnest(allowed) with ordinality t(a, i)
  where a in (select jsonb_array_elements_text(case when jsonb_typeof(vals) = 'array' then vals else '[]'::jsonb end))
$$;

create or replace function public._suspend(uid uuid, reason text) returns void
language sql security definer set search_path = public as $$
  update public.account_status
     set suspended_at = coalesce(suspended_at, now()), suspended_reason = reason
   where user_id = uid
$$;

create or replace function public._block(blocker uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.blocks (blocker_id, blocked_id) values (blocker, target) on conflict do nothing;
  -- 서로 주고받은 대기 쪽지는 거절 처리
  update public.notes set status = 'declined'
   where status = 'pending' and ((from_id = blocker and to_id = target) or (from_id = target and to_id = blocker));
end $$;

-- ---------------------------------------------------------------------
-- 가입 트리거: 프로필 · 약관 동의 기록 생성, 이용 제한 이메일 차단
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  agreed boolean;
begin
  if exists (select 1 from public.banned_emails
             where email_hash = any(public._ban_keys(new.email, new.raw_app_meta_data, new.raw_user_meta_data))) then
    raise exception 'BANNED_EMAIL';
  end if;
  perform public._ensure_profile(new.id);
  agreed := coalesce((meta->>'agreeAge')::boolean, false) and coalesce((meta->>'agreeTerms')::boolean, false)
        and coalesce((meta->>'agreePrivacy')::boolean, false) and coalesce((meta->>'agreeLocation')::boolean, false);
  if agreed then
    update public.account_status set terms_agreed_at = now(), terms_version = (public._settings()).terms_version
     where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- RPC 함수 (브라우저에서 supabase.rpc('이름', {...}) 로 호출)
-- =====================================================================

create or replace function public.get_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('termsVersion', terms_version, 'allowManualLocation', allow_manual_location,
                            'verifyValidDays', verify_valid_days)
  from public.app_settings where id = 1
$$;

-- 내 정보 (정지 · 약관 미동의 상태에서도 호출 가능)
create or replace function public.get_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  l public.locations;
  st public.account_status;
  u auth.users;
  vdays int := (public._settings()).verify_valid_days;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform public._ensure_profile(uid);
  select * into p from public.profiles where id = uid;
  select * into l from public.locations where user_id = uid;
  select * into st from public.account_status where user_id = uid;
  select * into u from auth.users where id = uid;
  return public._profile_json(p, l, null, null) || jsonb_build_object(
    'email', u.email,
    'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
    'isAdmin', public._is_admin(uid),
    'termsAgreed', st.terms_agreed_at is not null and st.terms_version is not distinct from (public._settings()).terms_version,
    'suspended', case when st.suspended_at is null then null
                      else jsonb_build_object('at', st.suspended_at, 'reason', st.suspended_reason) end,
    'isPublic', p.is_public,
    'lat', l.lat, 'lng', l.lng,
    'location', case when l.user_id is null then null else jsonb_build_object(
      'region', l.region, 'district', l.district, 'verifiedAt', l.verified_at,
      'verified', l.verified_at > now() - make_interval(days => vdays)) end,
    'profileComplete', p.gender is not null and p.age is not null and p.career is not null and cardinality(p.workout_days) > 0);
end $$;

-- 약관 동의 (소셜 로그인 첫 가입자 · 약관이 바뀐 기존 회원). 닉네임도 함께 정할 수 있음
create or replace function public.agree_terms(p_agree_age boolean, p_agree_terms boolean, p_agree_privacy boolean,
                                              p_agree_location boolean, p_nickname text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  nick text := btrim(coalesce(p_nickname, ''));
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not (coalesce(p_agree_age, false) and coalesce(p_agree_terms, false) and coalesce(p_agree_privacy, false) and coalesce(p_agree_location, false)) then
    raise exception '필수 약관에 모두 동의해 주세요.';
  end if;
  perform public._ensure_profile(uid);
  if p_nickname is not null then
    if char_length(nick) not between 2 and 20 then raise exception '닉네임은 2~20자로 입력해 주세요.'; end if;
    update public.profiles set nickname = nick, updated_at = now() where id = uid;
  end if;
  update public.account_status set terms_agreed_at = now(), terms_version = (public._settings()).terms_version where user_id = uid;
end $$;

-- 프로필 저장. p 의 키: nickname, gender, age, career, bench, squat, deadlift, gymName, workoutDays, workoutTimes,
-- bio, prefGender, prefAgeMin, prefAgeMax, prefMinTotal, prefNote, isPublic, photo(키가 있을 때만 변경)
create or replace function public.update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  nick text := btrim(coalesce(p->>'nickname', ''));
  v_age int := public._opt_int(p, 'age', 14, 99, '나이');
  v_bench int := public._opt_int(p, 'bench', 0, 500, '벤치프레스 1RM');
  v_squat int := public._opt_int(p, 'squat', 0, 500, '스쿼트 1RM');
  v_dead int := public._opt_int(p, 'deadlift', 0, 500, '데드리프트 1RM');
  v_amin int := public._opt_int(p, 'prefAgeMin', 14, 99, '원하는 최소 나이');
  v_amax int := public._opt_int(p, 'prefAgeMax', 14, 99, '원하는 최대 나이');
  v_total int := public._opt_int(p, 'prefMinTotal', 0, 1500, '원하는 3대 합계');
  v_photo text;
begin
  if char_length(nick) not between 2 and 20 then raise exception '닉네임은 2~20자로 입력해 주세요.'; end if;
  if v_amin is not null and v_amax is not null and v_amin > v_amax then
    raise exception '원하는 나이의 최소값이 최대값보다 클 수 없어요.';
  end if;
  if p ? 'photo' then
    v_photo := nullif(p->>'photo', '');
    if v_photo is not null and v_photo not like uid::text || '/%' then raise exception '사진 경로가 올바르지 않습니다.'; end if;
  end if;
  update public.profiles set
    nickname = nick,
    gender = case when p->>'gender' in ('male', 'female') then p->>'gender' end,
    age = v_age,
    career = case when p->>'career' in ('6개월 미만', '6개월~1년', '1~2년', '2~3년', '3~5년', '5년 이상') then p->>'career' end,
    bench = v_bench, squat = v_squat, deadlift = v_dead,
    gym_name = left(btrim(coalesce(p->>'gymName', '')), 50),
    workout_days = public._ordered(p->'workoutDays', array['월', '화', '수', '목', '금', '토', '일']),
    workout_times = public._ordered(p->'workoutTimes', array['새벽', '오전', '점심', '오후', '저녁', '밤']),
    bio = left(btrim(coalesce(p->>'bio', '')), 500),
    pref_gender = case when p->>'prefGender' in ('male', 'female') then p->>'prefGender' end,
    pref_age_min = v_amin, pref_age_max = v_amax, pref_min_total = v_total,
    pref_note = left(btrim(coalesce(p->>'prefNote', '')), 200),
    is_public = coalesce((p->>'isPublic')::boolean, true),
    photo_path = case when p ? 'photo' then v_photo else photo_path end,
    updated_at = now()
  where id = uid;
end $$;

-- 동네 인증. 동네 이름은 브라우저에서 지도 API 로 변환해 전달
create or replace function public.verify_location(p_lat float8, p_lng float8, p_accuracy float8, p_region text,
                                                  p_district text default '', p_manual boolean default false,
                                                  p_provided_to text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  reg text := left(btrim(coalesce(p_region, '')), 40);
begin
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

-- 반경 안의 헬스메이트
create or replace function public.nearby_profiles(radius_km float8 default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  r float8 := least(greatest(coalesce(radius_km, 3), 0.5), 10);
  dlat float8 := r / 111;
  dlng float8 := r / (111 * cos(radians(me.lat)));
  vdays int := (public._settings()).verify_valid_days;
  users jsonb;
begin
  select coalesce(jsonb_agg(j order by dist), '[]'::jsonb) into users from (
    select public._profile_json(p, l, me.lat, me.lng) as j, public._haversine(me.lat, me.lng, l.lat, l.lng) as dist
    from public.profiles p
    join public.locations l on l.user_id = p.id
    join public.account_status s on s.user_id = p.id
    where p.id <> uid and p.is_public and s.suspended_at is null
      and l.verified_at > now() - make_interval(days => vdays)
      and l.lat between me.lat - dlat and me.lat + dlat
      and l.lng between me.lng - dlng and me.lng + dlng
      and not public._is_blocked(uid, p.id)
  ) t where dist <= r;
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
  select * into p from public.profiles where id = p_user;
  if not found or (not p.is_public and p.id <> uid) or not public._is_active(p.id) or public._is_blocked(uid, p.id) then
    raise exception '프로필을 찾을 수 없습니다.';
  end if;
  select * into l from public.locations where user_id = p.id;
  select id into room_id from public.rooms where user_a = least(uid, p.id) and user_b = greatest(uid, p.id);
  return public._profile_json(p, l, me.lat, me.lng) || jsonb_build_object(
    'roomId', room_id,
    'pendingNote', exists (select 1 from public.notes where from_id = uid and to_id = p.id and status = 'pending'));
end $$;

-- ---- 쪽지

create or replace function public.send_note(p_to uuid, p_content text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  body text := left(btrim(coalesce(p_content, '')), 300);
  room_id bigint;
  new_id bigint;
begin
  if body = '' then raise exception '쪽지 내용을 입력해 주세요.'; end if;
  if p_to = uid then raise exception '자기 자신에게는 보낼 수 없습니다.'; end if;
  if not exists (select 1 from public.profiles where id = p_to and is_public) or not public._is_active(p_to) or public._is_blocked(uid, p_to) then
    raise exception '상대방을 찾을 수 없습니다.';
  end if;
  select id into room_id from public.rooms where user_a = least(uid, p_to) and user_b = greatest(uid, p_to);
  if room_id is not null then raise exception 'ROOM_EXISTS:%', room_id; end if;
  if exists (select 1 from public.notes where from_id = uid and to_id = p_to and status = 'pending') then
    raise exception '이미 보낸 쪽지가 답변을 기다리고 있습니다.';
  end if;
  if (select count(*) from public.notes where from_id = uid and created_at > now() - interval '1 day') >= (public._settings()).daily_note_limit then
    raise exception '하루에 보낼 수 있는 쪽지 수(%개)를 초과했습니다.', (public._settings()).daily_note_limit;
  end if;
  insert into public.notes (from_id, to_id, content) values (uid, p_to, body) returning id into new_id;
  return new_id;
end $$;

create or replace function public.list_notes(p_box text default 'inbox') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  sent boolean := p_box = 'sent';
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'content', n.content, 'status', n.status, 'roomId', n.room_id, 'createdAt', n.created_at,
      'other', public._small_user(case when sent then n.to_id else n.from_id end)) order by n.id desc), '[]'::jsonb)
    into res
  from (select * from public.notes n
         where (case when sent then n.from_id else n.to_id end) = uid
           and not exists (select 1 from public.blocks b where b.blocker_id = uid
                             and b.blocked_id = (case when sent then n.to_id else n.from_id end))
         order by n.id desc limit 100) n;
  if not sent then update public.notes set read_at = now() where to_id = uid and read_at is null; end if;
  return res;
end $$;

create or replace function public.accept_note(p_note bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  n public.notes;
  rid bigint;
begin
  select * into n from public.notes where id = p_note and to_id = uid;
  if not found or public._is_blocked(n.from_id, n.to_id) or not public._is_active(n.from_id) then raise exception '쪽지를 찾을 수 없습니다.'; end if;
  if n.status <> 'pending' then raise exception '이미 처리된 쪽지입니다.'; end if;
  insert into public.rooms (user_a, user_b) values (least(n.from_id, n.to_id), greatest(n.from_id, n.to_id))
    on conflict (user_a, user_b) do nothing;
  select id into rid from public.rooms where user_a = least(n.from_id, n.to_id) and user_b = greatest(n.from_id, n.to_id);
  -- 쪽지 내용을 채팅방 첫 메시지로
  insert into public.messages (room_id, sender_id, content, created_at) values (rid, n.from_id, n.content, n.created_at);
  -- 서로 주고받은 대기 쪽지도 함께 수락 처리
  update public.notes set status = 'accepted', room_id = rid
   where id = n.id or (status = 'pending' and ((from_id = n.from_id and to_id = n.to_id) or (from_id = n.to_id and to_id = n.from_id)));
  return rid;
end $$;

create or replace function public.decline_note(p_note bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  update public.notes set status = 'declined' where id = p_note and to_id = uid and status = 'pending';
  if not found then raise exception '이미 처리된 쪽지입니다.'; end if;
end $$;

-- ---- 채팅

create or replace function public.list_rooms() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  res jsonb;
begin
  select coalesce(jsonb_agg(x order by sort_at desc), '[]'::jsonb) into res from (
    select jsonb_build_object(
      'id', r.id, 'other', public._small_user(o.other_id),
      'lastMessage', lm.content, 'lastAt', lm.created_at,
      'unread', (select count(*) from public.messages m where m.room_id = r.id and m.sender_id <> uid and m.read_at is null)) as x,
      coalesce(lm.created_at, r.created_at) as sort_at
    from public.rooms r
    cross join lateral (select case when r.user_a = uid then r.user_b else r.user_a end as other_id) o
    left join lateral (select content, created_at from public.messages m where m.room_id = r.id order by m.id desc limit 1) lm on true
    where uid in (r.user_a, r.user_b)
      and not exists (select 1 from public.blocks b where b.blocker_id = uid and b.blocked_id = o.other_id)
  ) t;
  return res;
end $$;

create or replace function public.mark_room_read(p_room bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  update public.messages m set read_at = now()
   from public.rooms r
   where r.id = p_room and m.room_id = r.id and uid in (r.user_a, r.user_b) and m.sender_id <> uid and m.read_at is null;
end $$;

-- 채팅방 정보 + 최근 메시지 50개 (p_before 보다 이전)
create or replace function public.get_room(p_room bigint, p_before bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  r public.rooms;
  other uuid;
  op public.profiles;
  ol public.locations;
  msgs jsonb;
begin
  select * into r from public.rooms where id = p_room and uid in (user_a, user_b);
  if not found then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if exists (select 1 from public.blocks where blocker_id = uid and blocked_id = other) then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  select * into op from public.profiles where id = other;
  select * into ol from public.locations where user_id = other;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'roomId', room_id, 'senderId', sender_id, 'content', content,
                                               'createdAt', created_at, 'readAt', read_at) order by id), '[]'::jsonb)
    into msgs
  from (select * from public.messages where room_id = r.id and (p_before is null or id < p_before) order by id desc limit 50) m;
  perform public.mark_room_read(r.id);
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'other', public._profile_json(op, ol, null, null),
                               'canSend', not public._is_blocked(uid, other) and public._is_active(other)),
    'messages', msgs);
end $$;

create or replace function public.send_message(p_room bigint, p_content text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  r public.rooms;
  other uuid;
  body text := left(btrim(coalesce(p_content, '')), 1000);
  m public.messages;
begin
  select * into r from public.rooms where id = p_room and uid in (user_a, user_b);
  if not found then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  if body = '' then raise exception '메시지를 입력해 주세요.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if public._is_blocked(uid, other) or not public._is_active(other) then raise exception '메시지를 보낼 수 없는 상대예요.'; end if;
  insert into public.messages (room_id, sender_id, content) values (r.id, uid, body) returning * into m;
  return jsonb_build_object('id', m.id, 'roomId', m.room_id, 'senderId', m.sender_id, 'content', m.content,
                            'createdAt', m.created_at, 'readAt', m.read_at);
end $$;

create or replace function public.get_badges() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  return jsonb_build_object(
    'notes', (select count(*) from public.notes n where n.to_id = uid and n.status = 'pending' and n.read_at is null
               and not exists (select 1 from public.blocks b where b.blocker_id = uid and b.blocked_id = n.from_id)),
    'chats', (select count(*) from public.messages m join public.rooms r on r.id = m.room_id
               where uid in (r.user_a, r.user_b) and m.sender_id <> uid and m.read_at is null
                 and not exists (select 1 from public.blocks b where b.blocker_id = uid and b.blocked_id = m.sender_id)),
    'reports', case when public._is_admin(uid) then (select count(*) from public.reports where status = 'pending') else 0 end);
end $$;

-- ---- 차단

create or replace function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  if p_target = uid or not exists (select 1 from auth.users where id = p_target) then raise exception '차단할 수 없는 사용자입니다.'; end if;
  perform public._block(uid, p_target);
end $$;

create or replace function public.unblock_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  delete from public.blocks where blocker_id = uid and blocked_id = p_target;
end $$;

create or replace function public.list_blocks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname, 'photo', p.photo_path,
                                                       'blockedAt', b.created_at) order by b.created_at desc), '[]'::jsonb)
          from public.blocks b join public.profiles p on p.id = b.blocked_id where b.blocker_id = uid);
end $$;

-- ---- 신고

create or replace function public.report_user(p_target uuid, p_reason text, p_detail text default '',
                                              p_room bigint default null, p_block boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  nick text;
  body text := left(btrim(coalesce(p_detail, '')), 1000);
  ev jsonb;
  reporters int;
begin
  select nickname into nick from public.profiles where id = p_target;
  if nick is null or p_target = uid then raise exception '신고할 수 없는 사용자입니다.'; end if;
  if p_reason is null or p_reason not in ('부적절한 사진·프로필', '욕설·비하·혐오 표현', '성희롱·불쾌한 연락', '스팸·광고·영업',
                                          '사기·금전 요구', '미성년자 의심', '기타') then
    raise exception '신고 사유를 선택해 주세요.';
  end if;
  if p_reason = '기타' and body = '' then raise exception '기타 사유는 내용을 입력해 주세요.'; end if;
  if exists (select 1 from public.reports where reporter_id = uid and target_id = p_target and status = 'pending') then
    raise exception '이미 신고한 사용자예요. 운영팀이 검토 중입니다.';
  end if;
  -- 채팅방에서 신고하면 최근 대화 30개를 증거로 저장 (관리자만 열람)
  if p_room is not null and exists (select 1 from public.rooms where id = p_room
                                      and user_a = least(uid, p_target) and user_b = greatest(uid, p_target)) then
    select jsonb_agg(jsonb_build_object('from', case when sender_id = p_target then 'target' else 'reporter' end,
                                        'content', content, 'at', created_at) order by id)
      into ev
    from (select * from public.messages where room_id = p_room order by id desc limit 30) m;
  end if;
  insert into public.reports (reporter_id, target_id, target_nickname, reason, detail, evidence)
  values (uid, p_target, nick, p_reason, body, ev);
  if coalesce(p_block, false) then perform public._block(uid, p_target); end if;

  select count(distinct reporter_id) into reporters from public.reports
   where target_id = p_target and status <> 'dismissed' and created_at > now() - interval '30 days';
  if reporters >= (public._settings()).auto_suspend_reporters then
    perform public._suspend(p_target, '신고 누적 (' || reporters || '명) – 운영팀 검토 중');
  end if;
  return jsonb_build_object('blocked', coalesce(p_block, false));
end $$;

-- ---- 관리자

create or replace function public.admin_list_reports(p_status text default 'pending') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st text := case when p_status in ('pending', 'dismissed', 'actioned') then p_status else 'pending' end;
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'detail', r.detail, 'status', r.status, 'createdAt', r.created_at,
      'handledAt', r.handled_at, 'evidence', r.evidence,
      'reporter', jsonb_build_object('id', r.reporter_id, 'nickname', coalesce(rp.nickname, '(탈퇴)'), 'email', ru.email),
      'target', jsonb_build_object('id', r.target_id, 'nickname', r.target_nickname, 'email', tu.email,
                                   'deleted', r.target_id is null,
                                   'suspended', case when ts.suspended_at is null then null
                                                     else jsonb_build_object('at', ts.suspended_at, 'reason', ts.suspended_reason) end,
                                   'reportCount', (select count(*) from public.reports x where x.target_id = r.target_id)))
      order by r.id desc), '[]'::jsonb)
    from (select * from public.reports where status = st order by id desc limit 200) r
    left join public.profiles rp on rp.id = r.reporter_id
    left join auth.users ru on ru.id = r.reporter_id
    left join auth.users tu on tu.id = r.target_id
    left join public.account_status ts on ts.user_id = r.target_id);
end $$;

create or replace function public.admin_resolve_report(p_report bigint, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare rep public.reports;
begin
  perform public._require_admin();
  select * into rep from public.reports where id = p_report;
  if not found then raise exception '신고를 찾을 수 없습니다.'; end if;
  if p_action = 'suspend' then
    if rep.target_id is not null then
      perform public._suspend(rep.target_id, coalesce(nullif(btrim(p_reason), ''), '운영정책 위반 (' || rep.reason || ')'));
      update public.reports set status = 'actioned', handled_at = now() where target_id = rep.target_id and status = 'pending';
    end if;
    update public.reports set status = 'actioned', handled_at = now() where id = rep.id;
  elsif p_action = 'dismiss' then
    update public.reports set status = 'dismissed', handled_at = now() where id = rep.id;
  else
    raise exception '알 수 없는 처리입니다.';
  end if;
end $$;

create or replace function public.admin_list_suspended() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.user_id, 'nickname', p.nickname, 'email', u.email,
                                                       'suspendedAt', s.suspended_at, 'reason', s.suspended_reason)
                                    order by s.suspended_at desc), '[]'::jsonb)
          from public.account_status s join public.profiles p on p.id = s.user_id join auth.users u on u.id = s.user_id
          where s.suspended_at is not null);
end $$;

create or replace function public.admin_unsuspend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update public.account_status set suspended_at = null, suspended_reason = null where user_id = p_user;
end $$;

-- ---- 계정 (정지 · 약관 미동의 상태에서도 호출 가능)

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at,
                                          'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
                                          'termsAgreedAt', s.terms_agreed_at, 'termsVersion', s.terms_version,
                                          'suspendedAt', s.suspended_at, 'suspendedReason', s.suspended_reason)
                from auth.users u left join public.account_status s on s.user_id = u.id where u.id = uid),
    'profile', (select to_jsonb(p) from public.profiles p where id = uid),
    'location', (select to_jsonb(l) from public.locations l where user_id = uid),
    'locationLogs', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'purpose', purpose, 'providedTo', provided_to,
                                                                  'at', created_at) order by id), '[]'::jsonb)
                     from public.location_logs where user_id = uid),
    'notesSent', (select coalesce(jsonb_agg(jsonb_build_object('to', p.nickname, 'content', n.content, 'status', n.status, 'at', n.created_at)), '[]'::jsonb)
                  from public.notes n join public.profiles p on p.id = n.to_id where n.from_id = uid),
    'notesReceived', (select coalesce(jsonb_agg(jsonb_build_object('from', p.nickname, 'content', n.content, 'status', n.status, 'at', n.created_at)), '[]'::jsonb)
                      from public.notes n join public.profiles p on p.id = n.from_id where n.to_id = uid),
    'messagesSent', (select coalesce(jsonb_agg(jsonb_build_object('roomId', room_id, 'content', content, 'at', created_at) order by id), '[]'::jsonb)
                     from public.messages where sender_id = uid),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('nickname', p.nickname, 'at', b.created_at)), '[]'::jsonb)
               from public.blocks b join public.profiles p on p.id = b.blocked_id where b.blocker_id = uid),
    'reportsFiled', (select coalesce(jsonb_agg(jsonb_build_object('target', target_nickname, 'reason', reason, 'detail', detail,
                                                                  'status', status, 'at', created_at)), '[]'::jsonb)
                     from public.reports where reporter_id = uid));
end $$;

-- 회원 탈퇴: auth 계정을 지우면 프로필 · 위치 · 쪽지 · 채팅 · 차단이 함께 삭제됨 (CASCADE)
-- (프로필 사진 파일은 브라우저에서 Storage API 로 먼저 삭제)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  keys text[];
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  -- 정지 상태로 탈퇴하면 같은 이메일 · 카카오 계정으로 재가입 불가
  select public._ban_keys(u.email, u.raw_app_meta_data, u.raw_user_meta_data) into keys
    from auth.users u join public.account_status s on s.user_id = u.id
   where u.id = uid and s.suspended_at is not null;
  if keys is not null then
    insert into public.banned_emails (email_hash) select unnest(keys) on conflict do nothing;
  end if;
  delete from auth.users where id = uid;
end $$;

-- ---------------------------------------------------------------------
-- 프로필 사진 저장소 (공개 읽기, 본인 폴더 {user id}/ 에만 쓰기)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars_own_select" on storage.objects;
create policy "avatars_own_select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_own_insert" on storage.objects;
create policy "avatars_own_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_own_update" on storage.objects;
create policy "avatars_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_own_delete" on storage.objects;
create policy "avatars_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 실시간: 새 쪽지 · 채팅 메시지 · 읽음 표시를 브라우저로 전달
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
      alter publication supabase_realtime add table public.notes;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한: 도우미(_로 시작)·트리거 함수는 막고, RPC 만 로그인 사용자에게 허용
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_settings() to anon, authenticated;
grant execute on function
  public.get_me(),
  public.agree_terms(boolean, boolean, boolean, boolean, text),
  public.update_my_profile(jsonb),
  public.verify_location(float8, float8, float8, text, text, boolean, text),
  public.nearby_profiles(float8),
  public.get_profile(uuid),
  public.send_note(uuid, text),
  public.list_notes(text),
  public.accept_note(bigint),
  public.decline_note(bigint),
  public.list_rooms(),
  public.mark_room_read(bigint),
  public.get_room(bigint, bigint),
  public.send_message(bigint, text),
  public.get_badges(),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.list_blocks(),
  public.report_user(uuid, text, text, bigint, boolean),
  public.admin_list_reports(text),
  public.admin_resolve_report(bigint, text, text),
  public.admin_list_suspended(),
  public.admin_unsuspend(uuid),
  public.export_my_data(),
  public.delete_my_account()
to authenticated;
