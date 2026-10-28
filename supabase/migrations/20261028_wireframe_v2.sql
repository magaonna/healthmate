-- =====================================================================
-- 와이어프레임 v2 기능 2026-10-28
--   구인 글 · 운동 약속(확정 · 체크인 · 취소 · 후기 · 노쇼) · 1RM 영상 인증 · 오늘 운동 인증 · 응원
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--   20261028_remove_map_coords.sql 을 먼저 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.
--   새로 설치하는 경우에는 schema.sql 만 실행하면 된다 (이 내용이 이미 들어 있음).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 테이블 · 컬럼
-- ---------------------------------------------------------------------
-- 영상 인증을 통과한 1RM (관리자 승인으로만 바뀜. 회원이 직접 고칠 수 없음)
alter table public.profiles add column if not exists bench_verified    int check (bench_verified between 0 and 500);
alter table public.profiles add column if not exists squat_verified    int check (squat_verified between 0 and 500);
alter table public.profiles add column if not exists deadlift_verified int check (deadlift_verified between 0 and 500);

-- 채팅방 안내 문구(약속 확정 · 체크인 등)는 kind = 'system'
alter table public.messages add column if not exists kind text not null default 'text' check (kind in ('text', 'system'));

-- 구인 글
create table if not exists public.posts (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  lift             text not null check (lift in ('bench', 'squat', 'deadlift', 'etc')),
  work_kg          int check (work_kg between 1 and 500),        -- 내 작업 중량
  min_1rm          int check (min_1rm between 0 and 500),        -- 상대 1RM 조건 (NULL = 조건 없음)
  require_verified boolean not null default false,               -- 영상 인증된 1RM만 받기
  kind             text not null check (kind in ('flash', 'fixed')), -- 번개 / 고정 메이트
  meet_at          timestamptz,                                  -- 번개: 날짜 + 시간
  days             text[] not null default '{}' check (days <@ array['월', '화', '수', '목', '금', '토', '일']), -- 고정: 요일
  time_of_day      text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  gym_name         text not null check (char_length(gym_name) between 1 and 50),
  same_gender      boolean not null default false,
  memo             text check (char_length(memo) <= 200),
  status           text not null default 'open' check (status in ('open', 'closed')),
  created_at       timestamptz not null default now(),
  check (kind = 'fixed' or meet_at is not null)
);
create index if not exists posts_user_idx on public.posts (user_id, status);
create index if not exists posts_open_idx on public.posts (status, created_at desc);

-- 쪽지가 어떤 구인 글에 대한 요청인지
alter table public.notes add column if not exists post_id bigint references public.posts (id) on delete set null;
create index if not exists notes_post_idx on public.notes (post_id) where post_id is not null;

-- 운동 약속 (채팅방마다 진행 중인 약속은 하나)
create table if not exists public.appointments (
  id           bigint generated always as identity primary key,
  room_id      bigint not null references public.rooms (id) on delete cascade,
  post_id      bigint references public.posts (id) on delete set null,
  title        text not null check (char_length(title) between 1 and 40),
  place        text check (char_length(place) <= 80),
  meet_at      timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'done', 'cancelled')),
  proposed_by  uuid references auth.users (id) on delete set null, -- 제안한 사람. 상대가 확정한다
  checkin_a    timestamptz,  -- rooms.user_a 의 헬스장 도착 체크인
  checkin_b    timestamptz,  -- rooms.user_b
  cancelled_by uuid references auth.users (id) on delete set null,
  late_cancel  boolean not null default false,  -- 확정된 약속을 2시간 이내에 취소
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists appointments_active_idx on public.appointments (room_id) where status in ('pending', 'confirmed');
create index if not exists appointments_cancel_idx on public.appointments (cancelled_by) where late_cancel;

-- 운동 후 후기 · 노쇼 신고 (약속 하나에 한 사람당 하나)
create table if not exists public.reviews (
  appointment_id bigint not null references public.appointments (id) on delete cascade,
  reviewer_id    uuid not null references auth.users (id) on delete cascade,
  target_id      uuid not null references auth.users (id) on delete cascade,
  good           boolean,
  tags           text[] not null default '{}',
  comment        text check (char_length(comment) <= 200),
  noshow         boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (appointment_id, reviewer_id)
);
create index if not exists reviews_target_idx on public.reviews (target_id);

-- 1RM 영상 인증 신청 (code: 코드만 받음 → pending: 영상 제출 → approved / rejected)
create table if not exists public.lift_verifications (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  lift           text not null check (lift in ('bench', 'squat', 'deadlift')),
  code           text not null check (code ~ '^[0-9]{4}$'),
  code_issued_at timestamptz not null default now(),
  weight_kg      int check (weight_kg between 20 and 500),
  video_path     text,  -- storage 'lift-videos' 버킷 (비공개)
  status         text not null default 'code' check (status in ('code', 'pending', 'approved', 'rejected')),
  reject_reason  text check (char_length(reject_reason) <= 200),
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users (id) on delete set null
);
create index if not exists lift_verifications_user_idx on public.lift_verifications (user_id, lift, id desc);
create index if not exists lift_verifications_status_idx on public.lift_verifications (status) where status = 'pending';

-- 오늘 운동 인증 (하루 하나)
create table if not exists public.workout_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  log_date   date not null,  -- 한국 시간 기준 날짜
  part       text not null check (part in ('가슴', '등', '하체', '어깨·팔', '전신')),
  lift       text check (lift in ('bench', 'squat', 'deadlift')),
  weight_kg  numeric(5, 1) check (weight_kg between 1 and 500),
  reps       int check (reps between 1 and 30),
  photo_path text not null,  -- storage 'workouts' 버킷 (비공개)
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- 메이트 운동 인증에 보낸 응원 (채팅방마다 하루 한 번)
create table if not exists public.cheers (
  room_id   bigint not null references public.rooms (id) on delete cascade,
  from_id   uuid not null references auth.users (id) on delete cascade,
  cheer_day date not null,
  primary key (room_id, from_id, cheer_day)
);

alter table public.posts              enable row level security;
alter table public.appointments       enable row level security;
alter table public.reviews            enable row level security;
alter table public.lift_verifications enable row level security;
alter table public.workout_logs       enable row level security;
alter table public.cheers             enable row level security;

-- 관리자는 자기 행만 볼 수 있음 (영상 저장소 정책에서 관리자 여부를 확인할 때 필요)
drop policy if exists "admins_self" on public.admins;
create policy "admins_self" on public.admins for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 내부 도우미 함수
-- ---------------------------------------------------------------------
create or replace function public._today() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

-- 한국 시간 표시: 10월 28일(수) 19:00
create or replace function public._kst_label(ts timestamptz) returns text
language sql stable as $$
  select to_char(ts at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일"')
      || '(' || (array['일', '월', '화', '수', '목', '금', '토'])[extract(dow from ts at time zone 'Asia/Seoul')::int + 1] || ') '
      || to_char(ts at time zone 'Asia/Seoul', 'HH24:MI')
$$;

-- 고정 메이트 글의 다음 운동 시각 (앞으로 7일 안에서 가장 가까운 요일)
create or replace function public._next_occurrence(p_days text[], p_time text) returns timestamptz
language sql stable as $$
  select min((d::date + p_time::time) at time zone 'Asia/Seoul')
  from generate_series(public._today(), public._today() + 7, interval '1 day') d
  where (array['일', '월', '화', '수', '목', '금', '토'])[extract(dow from d)::int + 1] = any(p_days)
    and (d::date + p_time::time) at time zone 'Asia/Seoul' > now()
$$;

-- 번개 글은 약속 시각 1시간 뒤 자동 마감
create or replace function public._post_open(p public.posts) returns boolean
language sql stable as $$
  select p.status = 'open' and not (p.kind = 'flash' and p.meet_at < now() - interval '1 hour')
$$;

create or replace function public._lift_name(lift text) returns text
language sql immutable as $$
  select case lift when 'bench' then '벤치' when 'squat' then '스쿼트' when 'deadlift' then '데드' else '기타' end
$$;

create or replace function public._post_title(p public.posts) returns text
language sql immutable as $$
  select case when p.lift = 'etc' then '같이 운동'
              else public._lift_name(p.lift) || case when p.kind = 'fixed' then ' 고정 메이트' else ' 스팟' end end
$$;

-- 이 회원이 구인 글에 요청할 수 있는지: ok · own · closed · gender · no_record · below · need_video
create or replace function public._post_eligibility(p public.posts, uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles;
  v int;
  vv int;
begin
  if p.user_id = uid then return 'own'; end if;
  if not public._post_open(p) then return 'closed'; end if;
  select * into me from public.profiles where id = uid;
  if p.same_gender and (me.gender is null or me.gender is distinct from (select gender from public.profiles where id = p.user_id)) then
    return 'gender';
  end if;
  if p.lift = 'etc' or coalesce(p.min_1rm, 0) = 0 then return 'ok'; end if;
  v  := case p.lift when 'bench' then me.bench when 'squat' then me.squat else me.deadlift end;
  vv := case p.lift when 'bench' then me.bench_verified when 'squat' then me.squat_verified else me.deadlift_verified end;
  if v is null then return 'no_record'; end if;
  if v < p.min_1rm then return 'below'; end if;
  if p.require_verified and coalesce(vv, 0) < p.min_1rm then return 'need_video'; end if;
  return 'ok';
end $$;

create or replace function public._post_json(p public.posts, viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'lift', p.lift, 'workKg', p.work_kg, 'min1rm', p.min_1rm,
    'requireVerified', p.require_verified, 'kind', p.kind, 'meetAt', p.meet_at, 'days', to_jsonb(p.days),
    'time', p.time_of_day, 'gymName', p.gym_name, 'sameGender', p.same_gender, 'memo', coalesce(p.memo, ''),
    'status', case when public._post_open(p) then 'open' else 'closed' end, 'createdAt', p.created_at,
    'mine', p.user_id = viewer,
    'applicants', (select count(*) from public.notes n where n.post_id = p.id and n.status = 'pending'),
    'requested', exists (select 1 from public.notes n where n.post_id = p.id and n.from_id = viewer and n.status = 'pending'),
    'eligibility', public._post_eligibility(p, viewer))
$$;

-- 함께한 운동 · 노쇼 · 늦은 취소 · 받은 후기
create or replace function public._trust_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'together', (select count(*) from public.appointments a join public.rooms r on r.id = a.room_id
                  where uid in (r.user_a, r.user_b) and a.checkin_a is not null and a.checkin_b is not null),
    'noshow', (select count(*) from public.reviews where target_id = uid and noshow),
    'lateCancel', (select count(*) from public.appointments where cancelled_by = uid and late_cancel),
    'reviewCount', (select count(*) from public.reviews where target_id = uid and not noshow and good is not null),
    'tags', (select coalesce(jsonb_agg(jsonb_build_array(tag, cnt) order by cnt desc, tag), '[]'::jsonb) from (
               select t.tag, count(*) as cnt from public.reviews rv cross join unnest(rv.tags) t(tag)
               where rv.target_id = uid and rv.good group by t.tag order by count(*) desc limit 6) x),
    'reviews', (select coalesce(jsonb_agg(c order by at desc), '[]'::jsonb) from (
               select comment as c, created_at as at from public.reviews
               where target_id = uid and good and coalesce(comment, '') <> '' order by created_at desc limit 5) y))
$$;

-- 약속 JSON (보는 사람 기준: 내 체크인 / 상대 체크인 / 후기 가능 여부)
create or replace function public._appt_json(a public.appointments, uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'title', a.title, 'place', coalesce(a.place, ''), 'meetAt', a.meet_at, 'status', a.status,
    'proposedByMe', a.proposed_by = uid, 'lateCancel', a.late_cancel, 'cancelledByMe', a.cancelled_by = uid,
    'myCheckin', case when r.user_a = uid then a.checkin_a else a.checkin_b end,
    'otherCheckin', case when r.user_a = uid then a.checkin_b else a.checkin_a end,
    'canCheckin', a.status = 'confirmed' and (case when r.user_a = uid then a.checkin_a else a.checkin_b end) is null
                  and now() between a.meet_at - interval '1 hour' and a.meet_at + interval '3 hours',
    'checkinOpensAt', a.meet_at - interval '1 hour',
    'myReview', (select jsonb_build_object('good', rv.good, 'noshow', rv.noshow) from public.reviews rv
                  where rv.appointment_id = a.id and rv.reviewer_id = uid),
    'canReview', a.status in ('confirmed', 'done')
                 and not exists (select 1 from public.reviews rv where rv.appointment_id = a.id and rv.reviewer_id = uid)
                 and ((a.checkin_a is not null and a.checkin_b is not null) or now() > a.meet_at + interval '30 minutes'))
  from public.rooms r where r.id = a.room_id
$$;

-- 채팅방 안내 문구 남기기 (실시간으로 두 사람에게 전달됨)
create or replace function public._system_message(p_room bigint, actor uuid, body text) returns void
language sql security definer set search_path = public as $$
  insert into public.messages (room_id, sender_id, content, kind) values (p_room, actor, left(body, 1000), 'system')
$$;

-- 내가 속한 채팅방의 약속 (상대 id 와 함께)
create or replace function public._my_appt(p_appt bigint, uid uuid, out a public.appointments, out r public.rooms, out other uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  select * into a from public.appointments where id = p_appt;
  select * into r from public.rooms where id = a.room_id and uid in (user_a, user_b);
  if a.id is null or r.id is null then raise exception '약속을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if public._is_blocked(uid, other) then raise exception '약속을 찾을 수 없습니다.'; end if;
end $$;

-- 화면에 보여줄 프로필 JSON: 영상 인증된 1RM(verified) 추가
create or replace function public._profile_json(p public.profiles, loc public.locations, vlat float8, vlng float8) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'gender', p.gender, 'age', p.age, 'career', p.career,
    'bench', p.bench, 'squat', p.squat, 'deadlift', p.deadlift,
    'total', case when p.bench is not null and p.squat is not null and p.deadlift is not null then p.bench + p.squat + p.deadlift end,
    'verified', jsonb_build_object('bench', p.bench_verified, 'squat', p.squat_verified, 'deadlift', p.deadlift_verified),
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

-- ---------------------------------------------------------------------
-- 내 정보 · 프로필: 신뢰 지표 추가
-- ---------------------------------------------------------------------
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
    'profileComplete', p.gender is not null and p.age is not null and p.career is not null and cardinality(p.workout_days) > 0,
    'trust', public._trust_json(uid));
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
    'pendingNote', exists (select 1 from public.notes where from_id = uid and to_id = p.id and status = 'pending'),
    'trust', public._trust_json(p.id),
    'posts', (select coalesce(jsonb_agg(public._post_json(x, uid) order by x.id desc), '[]'::jsonb)
              from public.posts x where x.user_id = p.id and public._post_open(x)
                and (not x.same_gender or x.user_id = uid
                     or (select gender from public.profiles where id = uid) is not distinct from p.gender)));
end $$;

-- ---------------------------------------------------------------------
-- 구인 글
-- ---------------------------------------------------------------------
-- p 의 키: lift, workKg, min1rm, requireVerified, kind, date('YYYY-MM-DD', 번개), days(고정), time('HH:MM'), gymName, sameGender, memo
create or replace function public.create_post(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  loc public.locations := public._require_verified(uid);
  me public.profiles;
  v_lift text := p->>'lift';
  v_kind text := p->>'kind';
  v_work int := public._opt_int(p, 'workKg', 1, 500, '내 작업 중량');
  v_min int := public._opt_int(p, 'min1rm', 0, 500, '상대 1RM 조건');
  v_time text := coalesce(p->>'time', '');
  v_gym text := left(btrim(coalesce(p->>'gymName', '')), 50);
  v_same boolean := coalesce((p->>'sameGender')::boolean, false);
  v_meet timestamptz;
  v_days text[] := '{}';
  new_id bigint;
begin
  select * into me from public.profiles where id = uid;
  if v_lift is null or v_lift not in ('bench', 'squat', 'deadlift', 'etc') then raise exception '종목을 골라 주세요.'; end if;
  if v_kind is null or v_kind not in ('flash', 'fixed') then raise exception '구인 유형을 골라 주세요.'; end if;
  if v_lift <> 'etc' and v_work is null then raise exception '내 작업 중량을 입력해 주세요.'; end if;
  if v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '시간을 골라 주세요.'; end if;
  if v_gym = '' then v_gym := coalesce(nullif(btrim(me.gym_name), ''), ''); end if;
  if v_gym = '' then raise exception '헬스장 이름을 입력해 주세요.'; end if;
  if v_same and me.gender is null then raise exception '동성에게만 받으려면 내 정보에서 성별을 먼저 입력해 주세요.'; end if;
  if v_kind = 'flash' then
    begin
      v_meet := ((p->>'date')::date + v_time::time) at time zone 'Asia/Seoul';
    exception when others then
      raise exception '날짜를 골라 주세요.';
    end;
    if v_meet is null then raise exception '날짜를 골라 주세요.'; end if;
    if v_meet < now() - interval '10 minutes' then raise exception '지난 시간으로는 글을 올릴 수 없어요.'; end if;
    if v_meet > now() + interval '14 days' then raise exception '2주 안의 날짜만 고를 수 있어요.'; end if;
  else
    v_days := public._ordered(p->'days', array['월', '화', '수', '목', '금', '토', '일']);
    if cardinality(v_days) = 0 then raise exception '요일을 하나 이상 골라 주세요.'; end if;
  end if;
  if (select count(*) from public.posts x where x.user_id = uid and public._post_open(x)) >= 3 then
    raise exception '열려 있는 구인 글은 3개까지예요. 다른 글을 마감한 뒤 올려 주세요.';
  end if;
  insert into public.posts (user_id, lift, work_kg, min_1rm, require_verified, kind, meet_at, days, time_of_day,
                            gym_name, same_gender, memo)
  values (uid, v_lift, v_work, case when v_lift = 'etc' then null else nullif(v_min, 0) end,
          v_lift <> 'etc' and coalesce(v_min, 0) > 0 and coalesce((p->>'requireVerified')::boolean, false),
          v_kind, v_meet, v_days, v_time, v_gym, v_same, nullif(left(btrim(coalesce(p->>'memo', '')), 200), ''))
  returning id into new_id;
  return new_id;
end $$;

-- 반경 안의 열린 구인 글 (내 글 포함)
create or replace function public.nearby_posts(radius_km float8 default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  my_gender text := (select gender from public.profiles where id = uid);
  r float8 := least(greatest(coalesce(radius_km, 3), 0.5), 10);
  dlat float8 := r / 111;
  dlng float8 := r / (111 * cos(radians(me.lat)));
  vdays int := (public._settings()).verify_valid_days;
  res jsonb;
begin
  select coalesce(jsonb_agg(j order by dist, meet), '[]'::jsonb) into res from (
    select public._post_json(x, uid) || jsonb_build_object('author', jsonb_build_object(
             'id', p.id, 'nickname', p.nickname, 'photo', p.photo_path, 'gender', p.gender, 'age', p.age,
             'verified', coalesce(p.bench_verified, p.squat_verified, p.deadlift_verified) is not null,
             'distanceKm', case when p.id = uid then 0 else public._fuzzy_km(me.lat, me.lng, l.lat, l.lng, p.id) end)) as j,
           case when p.id = uid then -1 else public._haversine(me.lat, me.lng, l.lat, l.lng) end as dist,
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
            and public._haversine(me.lat, me.lng, l.lat, l.lng) <= r
            and not public._is_blocked(uid, p.id)
            and (not x.same_gender or p.gender is not distinct from my_gender)))
  ) t;
  return jsonb_build_object('radius', r, 'region', me.region, 'posts', res);
end $$;

-- 내 구인 글 + 받은 요청
create or replace function public.my_posts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  return (select coalesce(jsonb_agg(public._post_json(x, uid) || jsonb_build_object('requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'noteId', n.id, 'content', n.content, 'status', n.status, 'createdAt', n.created_at, 'roomId', n.room_id,
          'other', public._small_user(n.from_id),
          'liftKg', case x.lift when 'bench' then fp.bench when 'squat' then fp.squat when 'deadlift' then fp.deadlift end,
          'liftVerifiedKg', case x.lift when 'bench' then fp.bench_verified when 'squat' then fp.squat_verified when 'deadlift' then fp.deadlift_verified end,
          'trust', jsonb_build_object('noshow', (select count(*) from public.reviews where target_id = n.from_id and noshow)))
        order by n.id desc), '[]'::jsonb)
      from public.notes n join public.profiles fp on fp.id = n.from_id
      where n.post_id = x.id and not public._is_blocked(uid, n.from_id)))
    order by public._post_open(x) desc, x.id desc), '[]'::jsonb)
    from (select * from public.posts where user_id = uid order by id desc limit 30) x);
end $$;

create or replace function public.set_post_status(p_post bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  x public.posts;
begin
  select * into x from public.posts where id = p_post and user_id = uid;
  if not found then raise exception '구인 글을 찾을 수 없습니다.'; end if;
  if p_status = 'closed' then
    update public.posts set status = 'closed' where id = x.id;
  elsif p_status = 'open' then
    if x.kind = 'flash' and x.meet_at < now() - interval '1 hour' then raise exception '시간이 지난 번개 글은 다시 열 수 없어요. 새 글을 올려 주세요.'; end if;
    if (select count(*) from public.posts y where y.user_id = uid and public._post_open(y)) >= 3 then
      raise exception '열려 있는 구인 글은 3개까지예요.';
    end if;
    update public.posts set status = 'open' where id = x.id;
  else
    raise exception '알 수 없는 상태입니다.';
  end if;
end $$;

create or replace function public.delete_post(p_post bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  -- 답을 기다리는 요청은 거절 처리 (요청한 사람에게는 '마감됨'으로 보임)
  update public.notes set status = 'declined' where post_id = p_post and status = 'pending'
     and exists (select 1 from public.posts where id = p_post and user_id = uid);
  delete from public.posts where id = p_post and user_id = uid;
  if not found then raise exception '구인 글을 찾을 수 없습니다.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 쪽지: 구인 글에 대한 요청 (p_post) · 수락하면 운동 약속 생성
-- ---------------------------------------------------------------------
drop function if exists public.send_note(uuid, text);
create or replace function public.send_note(p_to uuid, p_content text, p_post bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  me public.locations := public._require_verified(uid);
  body text := left(btrim(coalesce(p_content, '')), 300);
  room_id bigint;
  new_id bigint;
  x public.posts;
  e text;
begin
  if body = '' then raise exception '쪽지 내용을 입력해 주세요.'; end if;
  if p_to = uid then raise exception '자기 자신에게는 보낼 수 없습니다.'; end if;
  if not exists (select 1 from public.profiles where id = p_to and is_public) or not public._is_active(p_to) or public._is_blocked(uid, p_to) then
    raise exception '상대방을 찾을 수 없습니다.';
  end if;
  if p_post is not null then
    select * into x from public.posts where id = p_post and user_id = p_to;
    if not found then raise exception '구인 글을 찾을 수 없습니다.'; end if;
    e := public._post_eligibility(x, uid);
    if e = 'closed' then raise exception '마감된 구인 글이에요.'; end if;
    if e = 'gender' then raise exception '동성에게만 받는 글이에요.'; end if;
    if e = 'no_record' then raise exception '내 정보에서 % 1RM을 먼저 입력해 주세요.', public._lift_name(x.lift); end if;
    if e = 'below' then raise exception '상대가 정한 조건(% %kg 이상)보다 내 기록이 낮아요.', public._lift_name(x.lift), x.min_1rm; end if;
    if e = 'need_video' then raise exception '이 글은 영상 인증된 1RM만 받아요. 1RM 영상 인증을 먼저 받아 주세요.'; end if;
  end if;
  select id into room_id from public.rooms where user_a = least(uid, p_to) and user_b = greatest(uid, p_to);
  if room_id is not null then raise exception 'ROOM_EXISTS:%', room_id; end if;
  if exists (select 1 from public.notes where from_id = uid and to_id = p_to and status = 'pending') then
    raise exception '이미 보낸 쪽지가 답변을 기다리고 있습니다.';
  end if;
  if (select count(*) from public.notes where from_id = uid and created_at > now() - interval '1 day') >= (public._settings()).daily_note_limit then
    raise exception '하루에 보낼 수 있는 쪽지 수(%개)를 초과했습니다.', (public._settings()).daily_note_limit;
  end if;
  insert into public.notes (from_id, to_id, content, post_id) values (uid, p_to, body, p_post) returning id into new_id;
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
      'other', public._small_user(case when sent then n.to_id else n.from_id end),
      'post', case when x.id is null then null else public._post_json(x, uid) end,
      'otherLiftKg', case when x.id is null or sent then null
                          else case x.lift when 'bench' then fp.bench when 'squat' then fp.squat when 'deadlift' then fp.deadlift end end,
      'otherLiftVerifiedKg', case when x.id is null or sent then null
                          else case x.lift when 'bench' then fp.bench_verified when 'squat' then fp.squat_verified when 'deadlift' then fp.deadlift_verified end end)
      order by n.id desc), '[]'::jsonb)
    into res
  from (select * from public.notes n
         where (case when sent then n.from_id else n.to_id end) = uid
           and not exists (select 1 from public.blocks b where b.blocker_id = uid
                             and b.blocked_id = (case when sent then n.to_id else n.from_id end))
         order by n.id desc limit 100) n
  left join public.posts x on x.id = n.post_id
  left join public.profiles fp on fp.id = n.from_id;
  if not sent then update public.notes set read_at = now() where to_id = uid and read_at is null; end if;
  return res;
end $$;

create or replace function public.accept_note(p_note bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  n public.notes;
  rid bigint;
  x public.posts;
  meet timestamptz;
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

  -- 구인 글 요청이면 운동 약속을 만들고 (요청한 사람이 확정), 번개 글은 마감
  select * into x from public.posts where id = n.post_id;
  if found then
    meet := case when x.kind = 'flash' then x.meet_at else public._next_occurrence(x.days, x.time_of_day) end;
    if meet is not null and meet > now() - interval '30 minutes'
       and not exists (select 1 from public.appointments where room_id = rid and status in ('pending', 'confirmed')) then
      insert into public.appointments (room_id, post_id, title, place, meet_at, proposed_by)
      values (rid, x.id, public._post_title(x), x.gym_name, meet, uid);
      perform public._system_message(rid, uid, '운동 약속이 만들어졌어요 · ' || public._kst_label(meet) || '. 확정을 눌러 약속을 잡아 주세요.');
    end if;
    if x.kind = 'flash' then
      update public.posts set status = 'closed' where id = x.id;
      update public.notes set status = 'declined' where post_id = x.id and status = 'pending';
    end if;
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------------
-- 채팅: 메시지 종류(kind) · 진행 중인 약속
-- ---------------------------------------------------------------------
create or replace function public.get_room(p_room bigint, p_before bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  r public.rooms;
  other uuid;
  op public.profiles;
  ol public.locations;
  msgs jsonb;
  a public.appointments;
begin
  select * into r from public.rooms where id = p_room and uid in (user_a, user_b);
  if not found then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if exists (select 1 from public.blocks where blocker_id = uid and blocked_id = other) then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  select * into op from public.profiles where id = other;
  select * into ol from public.locations where user_id = other;
  select * into a from public.appointments where room_id = r.id order by id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'roomId', room_id, 'senderId', sender_id, 'content', content,
                                               'kind', kind, 'createdAt', created_at, 'readAt', read_at) order by id), '[]'::jsonb)
    into msgs
  from (select * from public.messages where room_id = r.id and (p_before is null or id < p_before) order by id desc limit 50) m;
  perform public.mark_room_read(r.id);
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'other', public._profile_json(op, ol, null, null),
                               'canSend', not public._is_blocked(uid, other) and public._is_active(other),
                               'appointment', case when a.id is null then null else public._appt_json(a, uid) end),
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
                            'kind', m.kind, 'createdAt', m.created_at, 'readAt', m.read_at);
end $$;

-- ---------------------------------------------------------------------
-- 운동 약속
-- ---------------------------------------------------------------------
-- 약속 제안 (진행 중인 약속이 있으면 시간을 바꾸고 상대에게 다시 확정을 받음)
create or replace function public.propose_appointment(p_room bigint, p_meet_at timestamptz, p_title text default null,
                                                      p_place text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  r public.rooms;
  other uuid;
  a public.appointments;
  v_title text := left(coalesce(nullif(btrim(p_title), ''), '같이 운동'), 40);
  v_place text := nullif(left(btrim(coalesce(p_place, '')), 80), '');
  nick text := (select nickname from public.profiles where id = uid);
  changed boolean;
begin
  select * into r from public.rooms where id = p_room and uid in (user_a, user_b);
  if not found then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if public._is_blocked(uid, other) or not public._is_active(other) then raise exception '약속을 잡을 수 없는 상대예요.'; end if;
  if p_meet_at is null or p_meet_at < now() then raise exception '지금 이후의 시간을 골라 주세요.'; end if;
  if p_meet_at > now() + interval '30 days' then raise exception '30일 안의 날짜만 고를 수 있어요.'; end if;
  select * into a from public.appointments where room_id = r.id and status in ('pending', 'confirmed');
  changed := found;
  if changed then
    update public.appointments set meet_at = p_meet_at, title = v_title, place = coalesce(v_place, place), status = 'pending',
           proposed_by = uid, checkin_a = null, checkin_b = null, updated_at = now()
     where id = a.id returning * into a;
  else
    insert into public.appointments (room_id, title, place, meet_at, proposed_by)
    values (r.id, v_title, v_place, p_meet_at, uid) returning * into a;
  end if;
  perform public._system_message(r.id, uid, nick || '님이 ' || case when changed then '약속 시간을 바꾸자고 했어요' else '운동 약속을 제안했어요' end
                                             || ' · ' || public._kst_label(p_meet_at));
  return public._appt_json(a, uid);
end $$;

create or replace function public.confirm_appointment(p_appt bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  x record := public._my_appt(p_appt, uid);
  a public.appointments := x.a;
begin
  if a.status <> 'pending' then raise exception '이미 처리된 약속이에요.'; end if;
  if a.proposed_by = uid then raise exception '상대가 확정하면 약속이 잡혀요.'; end if;
  if a.meet_at < now() - interval '1 hour' then raise exception '지난 약속이에요. 시간을 다시 제안해 주세요.'; end if;
  update public.appointments set status = 'confirmed', updated_at = now() where id = a.id returning * into a;
  perform public._system_message(a.room_id, uid, '약속이 확정됐어요 · ' || public._kst_label(a.meet_at) || '. 헬스장에 도착하면 체크인해 주세요.');
  return public._appt_json(a, uid);
end $$;

-- 헬스장 도착 체크인 (약속 1시간 전부터 3시간 뒤까지)
create or replace function public.checkin_appointment(p_appt bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  x record := public._my_appt(p_appt, uid);
  a public.appointments := x.a;
  mine_a boolean := (x.r).user_a = uid;
  nick text := (select nickname from public.profiles where id = uid);
begin
  if a.status <> 'confirmed' then raise exception '확정된 약속만 체크인할 수 있어요.'; end if;
  if now() < a.meet_at - interval '1 hour' then raise exception '약속 1시간 전부터 체크인할 수 있어요.'; end if;
  if now() > a.meet_at + interval '3 hours' then raise exception '체크인 시간이 지났어요.'; end if;
  if (case when mine_a then a.checkin_a else a.checkin_b end) is not null then raise exception '이미 체크인했어요.'; end if;
  update public.appointments set checkin_a = case when mine_a then now() else checkin_a end,
                                 checkin_b = case when mine_a then checkin_b else now() end, updated_at = now()
   where id = a.id returning * into a;
  perform public._system_message(a.room_id, uid, nick || '님이 헬스장에 도착했어요');
  if a.checkin_a is not null and a.checkin_b is not null then
    perform public._system_message(a.room_id, uid, '두 사람 모두 도착했어요. 운동이 끝나면 후기를 남겨 주세요.');
  end if;
  return public._appt_json(a, uid);
end $$;

-- 약속 취소 (확정된 약속을 2시간 이내에 취소하면 '늦은 취소'로 기록)
create or replace function public.cancel_appointment(p_appt bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  x record := public._my_appt(p_appt, uid);
  a public.appointments := x.a;
  late boolean;
  nick text := (select nickname from public.profiles where id = uid);
begin
  if a.status not in ('pending', 'confirmed') then raise exception '이미 끝난 약속이에요.'; end if;
  if a.checkin_a is not null and a.checkin_b is not null then raise exception '두 사람 모두 체크인한 약속은 취소할 수 없어요.'; end if;
  late := a.status = 'confirmed' and a.meet_at - now() < interval '2 hours';
  update public.appointments set status = 'cancelled', cancelled_by = uid, late_cancel = late, updated_at = now()
   where id = a.id returning * into a;
  perform public._system_message(a.room_id, uid, nick || '님이 약속을 취소했어요' || case when late then ' (2시간 이내 취소)' else '' end);
  return public._appt_json(a, uid);
end $$;

-- 운동 후기 · 노쇼 신고
create or replace function public.review_appointment(p_appt bigint, p_good boolean, p_tags text[] default '{}',
                                                     p_comment text default '', p_noshow boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  x record := public._my_appt(p_appt, uid);
  a public.appointments := x.a;
  other_checkin timestamptz := case when (x.r).user_a = uid then a.checkin_b else a.checkin_a end;
  good_tags text[] := array['시간 약속을 잘 지켜요', '스팟이 정확해요', '고중량 보조에 익숙해요', '자세를 잘 봐줘요', '친절해요'];
  bad_tags text[] := array['약속 시간에 늦었어요', '스팟이 불안했어요', '운동과 관계없는 대화가 많았어요'];
  v_tags text[];
  nick text := (select nickname from public.profiles where id = uid);
begin
  if not coalesce((public._appt_json(a, uid)->>'canReview')::boolean, false) then
    if exists (select 1 from public.reviews where appointment_id = a.id and reviewer_id = uid) then raise exception '이미 후기를 남겼어요.'; end if;
    raise exception '운동이 끝난 뒤에 후기를 남길 수 있어요.';
  end if;
  if coalesce(p_noshow, false) then
    if other_checkin is not null then raise exception '상대가 체크인한 약속은 노쇼로 신고할 수 없어요.'; end if;
    insert into public.reviews (appointment_id, reviewer_id, target_id, good, noshow) values (a.id, uid, x.other, null, true);
  else
    if p_good is null then raise exception '좋았는지 아쉬웠는지 골라 주세요.'; end if;
    select coalesce(array_agg(t), '{}') into v_tags from unnest(coalesce(p_tags, '{}')) t
     where t = any(case when p_good then good_tags else bad_tags end);
    insert into public.reviews (appointment_id, reviewer_id, target_id, good, tags, comment)
    values (a.id, uid, x.other, p_good, v_tags, nullif(left(btrim(coalesce(p_comment, '')), 200), ''));
    perform public._system_message(a.room_id, uid, nick || '님이 운동 후기를 남겼어요');
  end if;
  update public.appointments set status = 'done', updated_at = now() where id = a.id returning * into a;
  return public._appt_json(a, uid);
end $$;

-- ---------------------------------------------------------------------
-- 1RM 영상 인증
-- ---------------------------------------------------------------------
create or replace function public._lift_json(v public.lift_verifications) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', v.id, 'lift', v.lift, 'status', v.status, 'code', v.code, 'codeIssuedAt', v.code_issued_at,
                            'codeExpiresAt', v.code_issued_at + interval '24 hours', 'weightKg', v.weight_kg,
                            'rejectReason', v.reject_reason, 'submittedAt', v.submitted_at, 'reviewedAt', v.reviewed_at)
$$;

-- 종목별 가장 최근 신청
create or replace function public.my_lift_verifications() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  return (select coalesce(jsonb_object_agg(v.lift, public._lift_json(v)), '{}'::jsonb)
          from (select distinct on (lift) * from public.lift_verifications where user_id = uid order by lift, id desc) v);
end $$;

-- 인증 코드 받기 (24시간 유효. 새로 받으면 이전 코드는 못 씀)
create or replace function public.issue_lift_code(p_lift text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  v public.lift_verifications;
begin
  if p_lift is null or p_lift not in ('bench', 'squat', 'deadlift') then raise exception '종목을 골라 주세요.'; end if;
  if exists (select 1 from public.lift_verifications where user_id = uid and lift = p_lift and status = 'pending') then
    raise exception '검토 중인 영상이 있어요. 결과가 나온 뒤 다시 신청해 주세요.';
  end if;
  if (select count(*) from public.lift_verifications where user_id = uid and code_issued_at > now() - interval '1 day') >= 10 then
    raise exception '오늘은 코드를 더 받을 수 없어요. 내일 다시 시도해 주세요.';
  end if;
  delete from public.lift_verifications where user_id = uid and lift = p_lift and status = 'code';
  insert into public.lift_verifications (user_id, lift, code)
  values (uid, p_lift, lpad((1000 + floor(random() * 9000))::int::text, 4, '0'))
  returning * into v;
  return public._lift_json(v);
end $$;

-- 영상 제출 (영상은 브라우저에서 'lift-videos' 버킷의 {user id}/ 폴더에 먼저 올림)
create or replace function public.submit_lift_video(p_id bigint, p_weight int, p_video text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  v public.lift_verifications;
begin
  select * into v from public.lift_verifications where id = p_id and user_id = uid;
  if not found or v.status <> 'code' then raise exception '인증 코드를 먼저 받아 주세요.'; end if;
  if v.code_issued_at < now() - interval '24 hours' then raise exception '코드가 만료됐어요. 새 코드를 받아 주세요.'; end if;
  if p_weight is null or p_weight not between 20 and 500 then raise exception '중량을 20~500kg 사이로 입력해 주세요.'; end if;
  if p_video is null or p_video not like uid::text || '/%' then raise exception '영상 경로가 올바르지 않습니다.'; end if;
  update public.lift_verifications set weight_kg = p_weight, video_path = p_video, status = 'pending', submitted_at = now()
   where id = v.id returning * into v;
  return public._lift_json(v);
end $$;

create or replace function public.admin_list_lifts(p_status text default 'pending') returns jsonb
language plpgsql security definer set search_path = public as $$
declare st text := case when p_status in ('pending', 'approved', 'rejected') then p_status else 'pending' end;
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(public._lift_json(v) || jsonb_build_object(
      'videoPath', v.video_path,
      'user', jsonb_build_object('id', p.id, 'nickname', p.nickname,
                                 'selfKg', case v.lift when 'bench' then p.bench when 'squat' then p.squat else p.deadlift end))
      order by v.submitted_at), '[]'::jsonb)
    from (select * from public.lift_verifications where status = st order by submitted_at desc limit 200) v
    join public.profiles p on p.id = v.user_id);
end $$;

-- 관리자 검토: 통과하면 프로필의 해당 1RM 을 인증값으로 (기존 기록보다 낮으면 기록은 그대로)
create or replace function public.admin_review_lift(p_id bigint, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  admin uuid := public._require_admin();
  v public.lift_verifications;
begin
  select * into v from public.lift_verifications where id = p_id;
  if not found or v.status <> 'pending' then raise exception '검토할 신청을 찾을 수 없습니다.'; end if;
  if coalesce(p_approve, false) then
    update public.profiles set
      bench_verified    = case when v.lift = 'bench'    then v.weight_kg else bench_verified end,
      squat_verified    = case when v.lift = 'squat'    then v.weight_kg else squat_verified end,
      deadlift_verified = case when v.lift = 'deadlift' then v.weight_kg else deadlift_verified end,
      bench    = case when v.lift = 'bench'    then greatest(coalesce(bench, 0), v.weight_kg) else bench end,
      squat    = case when v.lift = 'squat'    then greatest(coalesce(squat, 0), v.weight_kg) else squat end,
      deadlift = case when v.lift = 'deadlift' then greatest(coalesce(deadlift, 0), v.weight_kg) else deadlift end,
      updated_at = now()
    where id = v.user_id;
    update public.lift_verifications set status = 'approved', reviewed_at = now(), reviewed_by = admin where id = v.id;
  else
    if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception '반려 사유를 입력해 주세요.'; end if;
    update public.lift_verifications set status = 'rejected', reject_reason = left(btrim(p_reason), 200),
           reviewed_at = now(), reviewed_by = admin where id = v.id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 오늘 운동 인증 · 메이트 응원
-- ---------------------------------------------------------------------
-- p 의 키: part, lift, weightKg, reps, photo (workouts 버킷 경로). 오늘 이미 올렸으면 바꿔 씀
create or replace function public.log_workout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  v_part text := p->>'part';
  v_lift text := nullif(p->>'lift', '');
  v_photo text := nullif(p->>'photo', '');
  v_w numeric;
  v_r int := public._opt_int(p, 'reps', 1, 30, '횟수');
begin
  if v_part is null or v_part not in ('가슴', '등', '하체', '어깨·팔', '전신') then raise exception '오늘 한 부위를 골라 주세요.'; end if;
  if v_photo is null or v_photo not like uid::text || '/%' then raise exception '운동 사진을 올려 주세요.'; end if;
  if v_lift is not null and v_lift not in ('bench', 'squat', 'deadlift') then raise exception '종목이 올바르지 않습니다.'; end if;
  begin
    v_w := nullif(btrim(coalesce(p->>'weightKg', '')), '')::numeric;
  exception when others then
    raise exception '중량은 숫자로 입력해 주세요.';
  end;
  if v_w is not null and (v_w < 1 or v_w > 500 or v_w * 2 <> trunc(v_w * 2)) then raise exception '중량은 1~500kg, 0.5kg 단위로 입력해 주세요.'; end if;
  if v_lift is not null and (v_w is null or v_r is null) then raise exception '최고 세트의 중량과 횟수를 함께 입력해 주세요.'; end if;
  insert into public.workout_logs (user_id, log_date, part, lift, weight_kg, reps, photo_path)
  values (uid, public._today(), v_part, v_lift, case when v_lift is null then null else v_w end, case when v_lift is null then null else v_r end, v_photo)
  on conflict (user_id, log_date) do update set part = excluded.part, lift = excluded.lift, weight_kg = excluded.weight_kg,
    reps = excluded.reps, photo_path = excluded.photo_path, created_at = now();
  return public.my_workout();
end $$;

create or replace function public.my_workout() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  today date := public._today();
  monday date := public._today() - ((extract(isodow from public._today())::int) - 1);
  anchor date;
  streak int;
  best jsonb := '{}'::jsonb;
  l text;
begin
  anchor := case when exists (select 1 from public.workout_logs where user_id = uid and log_date = today) then today else today - 1 end;
  select count(*) into streak from (
    select log_date + (row_number() over (order by log_date desc))::int as g
    from public.workout_logs where user_id = uid and log_date <= anchor) t
  where g = anchor + 1;
  foreach l in array array['bench', 'squat', 'deadlift'] loop
    best := best || jsonb_build_object(l, jsonb_build_object(
      'thisMonth', (select jsonb_build_object('w', weight_kg, 'r', reps) from public.workout_logs
                     where user_id = uid and lift = l and log_date >= date_trunc('month', today)::date
                     order by weight_kg * (1 + reps / 30.0) desc limit 1),
      'lastMonth', (select jsonb_build_object('w', weight_kg, 'r', reps) from public.workout_logs
                     where user_id = uid and lift = l and log_date >= (date_trunc('month', today) - interval '1 month')::date
                       and log_date < date_trunc('month', today)::date
                     order by weight_kg * (1 + reps / 30.0) desc limit 1)));
  end loop;
  return jsonb_build_object(
    'today', (select jsonb_build_object('part', part, 'lift', lift, 'weightKg', weight_kg, 'reps', reps, 'image', photo_path)
              from public.workout_logs where user_id = uid and log_date = today),
    'streak', streak,
    'week', (select jsonb_agg(exists (select 1 from public.workout_logs where user_id = uid and log_date = monday + i) order by i)
             from generate_series(0, 6) i),
    'todayIndex', extract(isodow from today)::int - 1,
    'goal', 4,
    'best', best,
    -- 채팅 중인 메이트의 이번 주 인증 횟수 (차단·정지 제외, 최근 대화 순 5명)
    'mates', (select coalesce(jsonb_agg(m order by m->>'lastAt' desc nulls last), '[]'::jsonb) from (
       select public._small_user(o.other_id) || jsonb_build_object(
                'roomId', r.id,
                'weekCount', (select count(*) from public.workout_logs w where w.user_id = o.other_id and w.log_date >= monday),
                'cheeredToday', exists (select 1 from public.cheers c where c.room_id = r.id and c.from_id = uid and c.cheer_day = today),
                'lastAt', (select max(created_at) from public.messages mm where mm.room_id = r.id)) as m
       from public.rooms r
       cross join lateral (select case when r.user_a = uid then r.user_b else r.user_a end as other_id) o
       where uid in (r.user_a, r.user_b) and not public._is_blocked(uid, o.other_id) and public._is_active(o.other_id)
       order by (select max(created_at) from public.messages mm where mm.room_id = r.id) desc nulls last
       limit 5) t));
end $$;

create or replace function public.send_cheer(p_room bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  r public.rooms;
  other uuid;
  nick text := (select nickname from public.profiles where id = uid);
begin
  select * into r from public.rooms where id = p_room and uid in (user_a, user_b);
  if not found then raise exception '채팅방을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if public._is_blocked(uid, other) or not public._is_active(other) then raise exception '응원을 보낼 수 없는 상대예요.'; end if;
  insert into public.cheers (room_id, from_id, cheer_day) values (r.id, uid, public._today()) on conflict do nothing;
  if not found then raise exception '오늘은 이미 응원을 보냈어요.'; end if;
  perform public._system_message(r.id, uid, nick || '님이 이번 주 운동에 응원을 보냈어요');
end $$;

-- ---------------------------------------------------------------------
-- 뱃지 · 내 정보 내려받기
-- ---------------------------------------------------------------------
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
    'reports', case when public._is_admin(uid) then (select count(*) from public.reports where status = 'pending') else 0 end,
    'lifts', case when public._is_admin(uid) then (select count(*) from public.lift_verifications where status = 'pending') else 0 end);
end $$;

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
                     from public.reports where reporter_id = uid),
    'posts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.posts x where user_id = uid),
    'appointments', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'place', a.place, 'meetAt', a.meet_at,
                                                                  'status', a.status, 'lateCancel', a.late_cancel and a.cancelled_by = uid) order by a.id), '[]'::jsonb)
                     from public.appointments a join public.rooms r on r.id = a.room_id where uid in (r.user_a, r.user_b)),
    'reviewsWritten', (select coalesce(jsonb_agg(jsonb_build_object('good', good, 'tags', tags, 'comment', comment, 'noshow', noshow,
                                                                    'at', created_at)), '[]'::jsonb)
                       from public.reviews where reviewer_id = uid),
    'liftVerifications', (select coalesce(jsonb_agg(public._lift_json(v) order by v.id), '[]'::jsonb)
                          from public.lift_verifications v where user_id = uid),
    'workoutLogs', (select coalesce(jsonb_agg(jsonb_build_object('date', log_date, 'part', part, 'lift', lift, 'weightKg', weight_kg,
                                                                 'reps', reps) order by log_date), '[]'::jsonb)
                    from public.workout_logs where user_id = uid));
end $$;

-- ---------------------------------------------------------------------
-- 저장소: 운동 인증 사진(본인만) · 1RM 인증 영상(본인과 관리자만). 둘 다 비공개 버킷
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workouts', 'workouts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lift-videos', 'lift-videos', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

drop policy if exists "workouts_own_select" on storage.objects;
create policy "workouts_own_select" on storage.objects for select to authenticated
  using (bucket_id = 'workouts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "workouts_own_insert" on storage.objects;
create policy "workouts_own_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'workouts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "workouts_own_delete" on storage.objects;
create policy "workouts_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workouts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "lift_videos_select" on storage.objects;
create policy "lift_videos_select" on storage.objects for select to authenticated
  using (bucket_id = 'lift-videos' and ((storage.foldername(name))[1] = auth.uid()::text
                                        or exists (select 1 from public.admins where user_id = auth.uid())));
drop policy if exists "lift_videos_insert" on storage.objects;
create policy "lift_videos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'lift-videos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "lift_videos_delete" on storage.objects;
create policy "lift_videos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lift-videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 함수 실행 권한
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
  public.send_note(uuid, text, bigint),
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
  public.delete_my_account(),
  public.create_post(jsonb),
  public.nearby_posts(float8),
  public.my_posts(),
  public.set_post_status(bigint, text),
  public.delete_post(bigint),
  public.propose_appointment(bigint, timestamptz, text, text),
  public.confirm_appointment(bigint),
  public.checkin_appointment(bigint),
  public.cancel_appointment(bigint),
  public.review_appointment(bigint, boolean, text[], text, boolean),
  public.my_lift_verifications(),
  public.issue_lift_code(text),
  public.submit_lift_video(bigint, int, text),
  public.admin_list_lifts(text),
  public.admin_review_lift(bigint, boolean, text),
  public.log_workout(jsonb),
  public.my_workout(),
  public.send_cheer(bigint)
to authenticated;
