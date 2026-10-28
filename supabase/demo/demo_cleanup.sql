-- 시연 끝난 뒤: 관리자 권한 회수 + 목록에서 숨김 (계정 삭제는 앱에서 각 계정으로 [회원 탈퇴] 또는 Dashboard → Users → Delete)
delete from public.admins where user_id in (select id from auth.users where email in ('demo-a@example.com', 'demo-b@example.com'));
update public.profiles set is_public = false where id in (select id from auth.users where email in ('demo-a@example.com', 'demo-b@example.com'));
delete from public.posts where user_id in (select id from auth.users where email in ('demo-a@example.com', 'demo-b@example.com'));
