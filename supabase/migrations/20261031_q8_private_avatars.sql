-- =====================================================================
-- Q8. 프로필 사진 비공개 저장소  (백로그 #22)
-- 작성: 한서준(서버·보안) · 화면 연결: 이도윤 · 검수: 강민재 · 2026-10-31
--
-- 무엇이 문제였나
--   프로필 사진 저장소(avatars)가 공개라, 주소만 알면 누구나(로그인 없이도) 사진을 열 수 있었다.
--   비공개로 바꾼 회원 · 차단한 회원 · 예전에 바꾼 사진까지 그대로 열렸다.
--
-- 바꾸는 것
--   - 저장소를 비공개로 바꾼다.
--   - 사진은 로그인한 사람 중 본인, 공개 프로필의 "현재" 사진(차단 사이 제외), 채팅 상대만 볼 수 있다.
--   - 화면은 1시간짜리 서명된 임시 주소로 사진을 보여 준다(backend.js).
--
-- 실행 방법 (대표님): Supabase SQL Editor → 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다.
--   이 SQL과 화면 변경(PR)은 같이 반영해야 한다. 순서: SQL 실행 → 바로 PR 머지.
--   (SQL만 먼저 실행하면 PR 머지 전까지 다른 회원 사진이 안 보인다. 기능 오류는 없다.)
-- =====================================================================

-- 프로필 사진(avatars)은 비공개 저장소: 본인 · 공개 프로필(차단 아님) · 대화 상대의 "현재" 사진만 열람 가능 (Q8)
create or replace function public._avatar_visible(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  viewer uuid := auth.uid();
  owner uuid;
begin
  if viewer is null then return false; end if;
  begin
    owner := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  if owner = viewer then return true; end if;
  return exists (
    select 1 from public.profiles p
    where p.id = owner and p.photo_path = p_name and public._is_active(p.id) and not public._is_blocked(viewer, p.id)
      and (p.is_public or exists (select 1 from public.rooms r where r.user_a = least(viewer, p.id) and r.user_b = greatest(viewer, p.id))));
end $$;
grant execute on function public._avatar_visible(text) to authenticated;

update storage.buckets set public = false where id = 'avatars';
drop policy if exists "avatars_view" on storage.objects;
create policy "avatars_view" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public._avatar_visible(name));

notify pgrst, 'reload schema';
