/* 짐짝(GYMJJAK) – Supabase 연결 계층
 * 화면 코드(app.js)는 이 파일의 Backend 객체만 사용한다.
 * 규칙(차단·신고·정지·약관 등)은 supabase/schema.sql 의 RPC 함수가 검사한다.
 */
(() => {
  const cfg = window.GYMJJAK_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });

  // 서버 함수가 보내는 코드형 오류 (화면 이동으로 처리)
  const CODES = ['NOT_AUTHENTICATED', 'SUSPENDED', 'NEED_CONSENT', 'NEED_VERIFY'];
  // Supabase 인증 오류 → 한국어 안내. (오류 코드 · 원문 메시지 둘 다 확인)
  const AUTH_MESSAGES = [
    [/invalid_credentials|invalid login credentials/i, '이메일 또는 비밀번호가 올바르지 않습니다.'],
    [/email_not_confirmed|email not confirmed/i, '이메일 인증을 완료해 주세요. 가입할 때 받은 메일의 링크를 눌러 주세요.'],
    [/user_already_exists|user already registered/i, '이미 가입된 이메일입니다.'],
    [/email_address_not_authorized|email address not authorized/i,
      '인증 메일을 보낼 수 없는 주소예요. (운영자: Supabase 기본 메일은 팀원 이메일로만 발송돼요. SMTP를 연결하거나 Confirm email 을 꺼 주세요)'],
    [/over_email_send_rate_limit|email rate limit/i, '인증 메일 발송 한도를 넘었어요. 잠시 후 다시 시도해 주세요. (운영자: Supabase SMTP 설정 필요)'],
    [/error sending (confirmation|magic link|recovery)? ?email|smtp/i, '인증 메일 발송에 실패했어요. (운영자: Supabase 메일 발송(SMTP) 설정을 확인해 주세요)'],
    [/signup_disabled|signups not allowed/i, '지금은 회원가입이 꺼져 있어요. (운영자: Supabase Auth 에서 회원가입 허용 필요)'],
    [/email_provider_disabled|email logins are disabled/i, '이메일 가입이 꺼져 있어요. (운영자: Supabase Auth → Email 사용 설정 필요)'],
    [/database error saving new user|unexpected_failure/i, '가입 처리 중 오류가 발생했어요. 이용이 제한된 이메일이거나 서버 설정 문제일 수 있어요.'],
    [/weak_password|password should|password is known/i, '비밀번호가 너무 약해요. 영문·숫자를 섞어 8자 이상으로 입력해 주세요.'],
    [/over_request_rate_limit|rate limit|too many requests|security purposes/i, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'],
    [/email_address_invalid|validation_failed|unable to validate email|invalid email|email address .* is invalid/i, '사용할 수 없는 이메일 주소예요. 다른 이메일로 시도해 주세요.'],
    [/failed to fetch|network|load failed/i, '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'],
  ];

  function toError(e) {
    const msg = e?.message || String(e || '요청에 실패했습니다.');
    const err = new Error(msg);
    if (CODES.includes(msg)) err.code = msg;
    const room = /^ROOM_EXISTS:(\d+)$/.exec(msg);
    if (room) { err.message = '이미 채팅 중인 상대입니다.'; err.roomId = Number(room[1]); }
    const probe = `${e?.code || ''} ${msg}`;
    const hit = AUTH_MESSAGES.find(([re]) => re.test(probe));
    if (hit) err.message = hit[1];
    if (/JWT|not authenticated/i.test(msg)) err.code = 'NOT_AUTHENTICATED';
    if (hit || !CODES.includes(msg)) console.warn('[Supabase]', e?.status || '', e?.code || '', msg); // 원인 확인용 (브라우저 개발자 도구 Console)
    return err;
  }

  // RPC 결과의 사진 경로(photo) → 공개 URL (원래 경로는 photoPath 로 보관)
  const photoUrl = (path) => sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  function fixPhotos(v) {
    if (Array.isArray(v)) v.forEach(fixPhotos);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'photo' && typeof x === 'string' && x && !/^(https?:|blob:)/.test(x)) { v.photoPath = x; v.photo = photoUrl(x); }
        else if (x && typeof x === 'object') fixPhotos(x);
      }
    }
    return v;
  }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw toError(error);
    return fixPhotos(data);
  }
  async function auth(promise) {
    const { data, error } = await promise;
    if (error) throw toError(error);
    return data;
  }
  const redirectTo = () => location.origin + location.pathname;

  // ------------------------------------------------------------ 실시간 (Realtime) + 연결 안 될 때 폴링
  let channel = null;
  const typingChannels = new Map();

  function subscribe(uid, handlers) {
    unsubscribe();
    channel = sb.channel(`user-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `to_id=eq.${uid}` }, () => handlers.noteNew())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `from_id=eq.${uid}` }, ({ new: n }) => {
        if (n.status === 'accepted') handlers.noteAccepted(n.room_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => handlers.message(toMsg(m)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: m }) => {
        // 내가 보낸 메시지를 상대가 읽었을 때만 '1'(안 읽음)을 지운다. 내가 상대 메시지를 읽은 경우는 제외
        if (m.read_at && m.sender_id === uid) handlers.read(m.room_id);
      })
      .subscribe((status) => handlers.status(status === 'SUBSCRIBED'));
  }
  function unsubscribe() {
    if (channel) sb.removeChannel(channel);
    channel = null;
    typingChannels.forEach((c) => sb.removeChannel(c));
    typingChannels.clear();
  }
  const toMsg = (m) => ({ id: m.id, roomId: m.room_id, senderId: m.sender_id, content: m.content, createdAt: m.created_at, readAt: m.read_at });

  // 입력 중 표시: 채팅방별 broadcast 채널
  function typingChannel(roomId, onTyping) {
    if (typingChannels.has(roomId)) sb.removeChannel(typingChannels.get(roomId));
    const c = sb.channel(`typing-${roomId}`).on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload)).subscribe();
    typingChannels.set(roomId, c);
    return { send: (payload) => c.send({ type: 'broadcast', event: 'typing', payload }).catch(() => {}) };
  }

  window.Backend = {
    client: sb,
    photoUrl,

    // ---- 설정 · 세션
    async settings() { return rpc('get_settings'); },
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuthChange(cb) { return sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async me() { return rpc('get_me'); },

    // ---- 회원가입 / 로그인
    async signup({ email, password, nickname, ...agreements }) {
      const data = await auth(sb.auth.signUp({ email, password, options: { data: { nickname, ...agreements }, emailRedirectTo: redirectTo() } }));
      // 이메일 인증을 켜둔 프로젝트는 세션 없이 사용자만 생성됨
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('이미 가입된 이메일입니다.');
      return { needsConfirm: !data.session };
    },
    async resendConfirm(email) { await auth(sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } })); },
    async login(email, password) { await auth(sb.auth.signInWithPassword({ email, password })); },
    async oauth(provider) { await auth(sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } })); },
    async logout() { unsubscribe(); await sb.auth.signOut().catch(() => {}); },
    async changePassword(email, current, next) {
      const { error } = await sb.auth.signInWithPassword({ email, password: current });
      if (error) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      if (next.length < 8) throw new Error('새 비밀번호는 8자 이상이어야 합니다.');
      await auth(sb.auth.updateUser({ password: next }));
    },
    agreeTerms(agreements, nickname) {
      return rpc('agree_terms', { p_agree_age: agreements.agreeAge, p_agree_terms: agreements.agreeTerms, p_agree_privacy: agreements.agreePrivacy,
        p_agree_location: agreements.agreeLocation, p_nickname: nickname ?? null });
    },

    // ---- 프로필 · 사진
    async uploadPhoto(uid, file) {
      if (file.size > 5 * 1024 * 1024) throw new Error('사진은 5MB 이하만 올릴 수 있습니다.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
      const path = `${uid}/${Date.now()}.${{ 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'jpg'}`;
      const { error } = await sb.storage.from('avatars').upload(path, file, { contentType: file.type, cacheControl: '604800' });
      if (error) throw toError(error);
      return path;
    },
    async removePhoto(path) { if (path) await sb.storage.from('avatars').remove([path]).catch(() => {}); },
    updateProfile(p) { return rpc('update_my_profile', { p }); },
    verifyLocation({ lat, lng, accuracy, region, district, manual, providedTo }) {
      return rpc('verify_location', { p_lat: lat, p_lng: lng, p_accuracy: accuracy ?? null, p_region: region || '', p_district: district || '',
        p_manual: !!manual, p_provided_to: providedTo || null });
    },
    nearby(radiusKm) { return rpc('nearby_profiles', { radius_km: radiusKm }); },
    profile(id) { return rpc('get_profile', { p_user: id }); },

    // ---- 쪽지
    sendNote(toId, content) { return rpc('send_note', { p_to: toId, p_content: content }); },
    notes(box) { return rpc('list_notes', { p_box: box }); },
    acceptNote(id) { return rpc('accept_note', { p_note: id }); },
    declineNote(id) { return rpc('decline_note', { p_note: id }); },

    // ---- 채팅
    rooms() { return rpc('list_rooms'); },
    room(id, before = null) { return rpc('get_room', { p_room: id, p_before: before }); },
    sendMessage(roomId, content) { return rpc('send_message', { p_room: roomId, p_content: content }); },
    markRead(roomId) { return rpc('mark_room_read', { p_room: roomId }).catch(() => {}); },
    badges() { return rpc('get_badges'); },
    subscribe,
    unsubscribe,
    typingChannel,

    // ---- 차단 · 신고
    block(id) { return rpc('block_user', { p_target: id }); },
    unblock(id) { return rpc('unblock_user', { p_target: id }); },
    blocks() { return rpc('list_blocks'); },
    report({ targetId, reason, detail, roomId, block }) {
      return rpc('report_user', { p_target: targetId, p_reason: reason, p_detail: detail || '', p_room: roomId || null, p_block: !!block });
    },

    // ---- 관리자
    adminReports(status) { return rpc('admin_list_reports', { p_status: status }); },
    adminResolve(id, action, reason) { return rpc('admin_resolve_report', { p_report: id, p_action: action, p_reason: reason || null }); },
    adminSuspended() { return rpc('admin_list_suspended'); },
    adminUnsuspend(id) { return rpc('admin_unsuspend', { p_user: id }); },

    // ---- 계정
    async exportData() {
      const data = await rpc('export_my_data');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'gymjjak-my-data.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async deleteAccount(me, { password, confirm }) {
      if (me.provider === 'email') {
        const { error } = await sb.auth.signInWithPassword({ email: me.email, password });
        if (error) throw new Error('비밀번호가 올바르지 않습니다.');
      } else if (confirm !== '탈퇴') {
        throw new Error("확인을 위해 '탈퇴'를 입력해 주세요.");
      }
      await this.removePhoto(me.photoPath);
      await rpc('delete_my_account');
      unsubscribe();
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    },
  };
})();
