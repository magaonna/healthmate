-- =====================================================================
-- 와이어프레임 v2 검토 반영 (보안 · 규칙 보완) 2026-10-28
--   20261028_wireframe_v2.sql 을 이미 실행한 DB 에 이어서 실행한다. 여러 번 실행해도 안전하다.
--   (새로 설치하면 schema.sql 만 실행하면 된다)
--
--   1. 반경 검색으로 정확한 거리를 알아내지 못하게: 반경 · 정렬 모두 1km 단위
--   2. 확정 · 취소 · 수락이 동시에 와도 한 번만 처리 (행 잠금)
--   3. 체크인은 약속 1시간 전 ~ 1시간 뒤. 후기 · 노쇼 신고는 그 뒤에
--   4. 확정된 약속은 2시간 전부터 · 체크인 뒤에는 시간 변경 불가 (늦은 취소 · 노쇼 회피 방지)
--   5. 상대가 도착한 약속은 취소 불가. '늦은 취소'는 약속 2시간 전 ~ 1시간 뒤에만 기록
--   6. 노쇼 신고는 내가 체크인했을 때만
--   7. 1RM 인증 코드 재발급 하루 10번 제한이 실제로 동작하게
--   8. 관리자 본인의 영상 인증은 다른 관리자가 검토
--   9. 구인 글 하루 10개 · 약속 제안 방마다 하루 10번
-- =====================================================================

create or replace function public._my_appt(p_appt bigint, uid uuid, out a public.appointments, out r public.rooms, out other uuid)
language plpgsql security definer set search_path = public as $$
begin
  select * into a from public.appointments where id = p_appt for update;  -- 확정 · 취소가 동시에 와도 하나만 처리
  select * into r from public.rooms where id = a.room_id and uid in (user_a, user_b);
  if a.id is null or r.id is null then raise exception '약속을 찾을 수 없습니다.'; end if;
  other := case when r.user_a = uid then r.user_b else r.user_a end;
  if public._is_blocked(uid, other) then raise exception '약속을 찾을 수 없습니다.'; end if;
end $$;

create or replace function public._appt_json(a public.appointments, uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'title', a.title, 'place', coalesce(a.place, ''), 'meetAt', a.meet_at, 'status', a.status,
    'proposedByMe', a.proposed_by = uid, 'lateCancel', a.late_cancel, 'cancelledByMe', a.cancelled_by = uid,
    'myCheckin', case when r.user_a = uid then a.checkin_a else a.checkin_b end,
    'otherCheckin', case when r.user_a = uid then a.checkin_b else a.checkin_a end,
    'canCheckin', a.status = 'confirmed' and (case when r.user_a = uid then a.checkin_a else a.checkin_b end) is null
                  and now() between a.meet_at - interval '1 hour' and a.meet_at + interval '1 hour',
    'checkinOpensAt', a.meet_at - interval '1 hour',
    'myReview', (select jsonb_build_object('good', rv.good, 'noshow', rv.noshow) from public.reviews rv
                  where rv.appointment_id = a.id and rv.reviewer_id = uid),
    'canReview', a.status in ('confirmed', 'done')
                 and not exists (select 1 from public.reviews rv where rv.appointment_id = a.id and rv.reviewer_id = uid)
                 and ((a.checkin_a is not null and a.checkin_b is not null) or now() > a.meet_at + interval '1 hour'),
    'canNoshow', a.status = 'confirmed'
                 and (case when r.user_a = uid then a.checkin_a else a.checkin_b end) is not null
                 and (case when r.user_a = uid then a.checkin_b else a.checkin_a end) is null
                 and now() > a.meet_at + interval '1 hour')
  from public.rooms r where r.id = a.room_id
$$;

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

create or replace function public.accept_note(p_note bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  n public.notes;
  rid bigint;
  x public.posts;
  meet timestamptz;
begin
  select * into n from public.notes where id = p_note and to_id = uid for update;  -- 두 번 눌러도 한 번만
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
  perform pg_advisory_xact_lock(hashtext('post:' || uid::text));
  if (select count(*) from public.posts where user_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception '구인 글은 하루 10개까지 올릴 수 있어요.';
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
    perform pg_advisory_xact_lock(hashtext('post:' || uid::text));
    if (select count(*) from public.posts y where y.user_id = uid and public._post_open(y)) >= 3 then
      raise exception '열려 있는 구인 글은 3개까지예요.';
    end if;
    update public.posts set status = 'open' where id = x.id;
  else
    raise exception '알 수 없는 상태입니다.';
  end if;
end $$;

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
  select * into a from public.appointments where room_id = r.id and status in ('pending', 'confirmed') for update;
  changed := found;
  if changed and a.status = 'confirmed' and (a.checkin_a is not null or a.checkin_b is not null or a.meet_at < now() + interval '2 hours') then
    raise exception '확정된 약속은 2시간 전부터 바꿀 수 없어요. 취소하거나 운동 뒤 후기를 남겨 주세요.';
  end if;
  if (select count(*) from public.messages where room_id = r.id and sender_id = uid and kind = 'system'
        and (content like '%약속을 제안했어요%' or content like '%바꾸자고 했어요%') and created_at > now() - interval '1 day') >= 10 then
    raise exception '약속 제안은 하루 10번까지 할 수 있어요.';
  end if;
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
  if now() > a.meet_at + interval '1 hour' then raise exception '체크인 시간이 지났어요. (약속 1시간 뒤까지)'; end if;
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
  if a.status = 'confirmed' and now() > a.meet_at
     and (case when (x.r).user_a = uid then a.checkin_b else a.checkin_a end) is not null then
    raise exception '상대가 이미 도착한 약속은 취소할 수 없어요.';
  end if;
  late := a.status = 'confirmed' and now() between a.meet_at - interval '2 hours' and a.meet_at + interval '1 hour';
  update public.appointments set status = 'cancelled', cancelled_by = uid, late_cancel = late, updated_at = now()
   where id = a.id returning * into a;
  perform public._system_message(a.room_id, uid, nick || '님이 약속을 취소했어요' || case when late then ' (2시간 이내 취소)' else '' end);
  return public._appt_json(a, uid);
end $$;

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
    if (case when (x.r).user_a = uid then a.checkin_a else a.checkin_b end) is null then raise exception '내가 체크인한 약속만 노쇼로 신고할 수 있어요.'; end if;
    if now() <= a.meet_at + interval '1 hour' then raise exception '체크인 시간(약속 1시간 뒤)이 지난 뒤에 신고할 수 있어요.'; end if;
    insert into public.reviews (appointment_id, reviewer_id, target_id, good, noshow) values (a.id, uid, x.other, null, true);
    perform public._system_message(a.room_id, uid, '약속이 끝났어요');
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
  update public.lift_verifications set status = 'rejected', reject_reason = '새 코드를 받아 이전 코드는 쓸 수 없어요', reviewed_at = now()
   where user_id = uid and lift = p_lift and status = 'code';
  insert into public.lift_verifications (user_id, lift, code)
  values (uid, p_lift, lpad((1000 + floor(random() * 9000))::int::text, 4, '0'))
  returning * into v;
  return public._lift_json(v);
end $$;

create or replace function public.admin_review_lift(p_id bigint, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  admin uuid := public._require_admin();
  v public.lift_verifications;
begin
  select * into v from public.lift_verifications where id = p_id;
  if not found or v.status <> 'pending' then raise exception '검토할 신청을 찾을 수 없습니다.'; end if;
  if v.user_id = admin then raise exception '본인 신청은 다른 관리자가 검토해야 해요.'; end if;
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

-- _my_appt 는 stable → volatile 로 바뀌었으므로 도우미 권한을 다시 회수
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
