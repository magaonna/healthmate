/* 짐짝(GYMJJAK) – SPA (vanilla JS) */
(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $modalBody = document.getElementById('modalBody');
  const state = { me: null, config: null, live: false, poller: null, nearby: null, filter: { radius: 3, gender: null, minTotal: null, days: [], matchOnly: false }, chatRoomId: null,
    posts: null, postFilter: { lifts: [], today: false, evening: false, eligible: false, verified: false } };

  // ------------------------------------------------------------ utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Lucide 선형 아이콘 (ISC 라이선스). 이모지 대신 이것만 쓴다 — 디자인 시스템 5장
  const ICONS = {"map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /> <circle cx=\"12\" cy=\"10\" r=\"3\" />", "mail": "<rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\" /> <path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\" />", "message-circle": "<path d=\"M7.9 20A9 9 0 1 0 4 16.1L2 22Z\" />", "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /> <circle cx=\"12\" cy=\"7\" r=\"4\" />", "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />", "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /> <path d=\"m9 12 2 2 4-4\" />", "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" /> <path d=\"m21 21-4.3-4.3\" />", "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />", "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />", "bell": "<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\" /> <path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" />", "check": "<path d=\"M20 6 9 17l-5-5\" />", "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m9 12 2 2 4-4\" />", "circle-alert": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" /> <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />", "camera": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\" /> <circle cx=\"12\" cy=\"13\" r=\"3\" />", "video": "<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\" /> <rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\" />", "calendar": "<path d=\"M8 2v4\" /> <path d=\"M16 2v4\" /> <rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" /> <path d=\"M3 10h18\" />"};
  const ic = (name, size = 20) => `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };

  // 서버(Supabase 함수)의 코드형 오류는 화면 이동으로 처리
  function handleCodeError(err) {
    if (err.code === 'NOT_AUTHENTICATED') { state.me = null; location.hash = '#/login'; }
    if (err.code === 'SUSPENDED') { state.me = null; location.hash = '#/suspended'; }
    if (err.code === 'NEED_CONSENT') location.hash = '#/welcome';
    if (err.code === 'NEED_VERIFY') location.hash = '#/verify';
    return !!err.code;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), msg.length > 40 ? 6000 : 2400); // 긴 안내는 오래 표시
  }

  const genderLabel = { male: '남성', female: '여성' };
  const avatar = (photo, cls = '') => `<span class="avatar ${cls}">${photo ? `<img src="${esc(photo)}" alt="">` : ic('user', 24)}</span>`;
  // 거리는 서버가 1km 단위로 올림해서 보낸다 (위치 역추적 방지, Q1)
  const distLabel = (km) => (km == null ? '' : km <= 1 ? '1km 이내' : `약 ${km}km`);
  const parseDate = (s) => new Date(s);
  function timeLabel(s) {
    if (!s) return '';
    const d = parseDate(s); const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  }

  function openModal(html) { $modalBody.innerHTML = ''; $modalBody.append(h(html)); $modal.classList.remove('hidden'); }
  function closeModal() { $modal.classList.add('hidden'); $modalBody.innerHTML = ''; }
  $modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function setChrome({ tab = null, bars = true, full = false } = {}) {
    document.getElementById('topbar').classList.toggle('hidden', !bars);
    document.getElementById('tabbar').classList.toggle('hidden', !bars || tab === 'chat');
    $app.classList.toggle('full', full);
    document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    document.getElementById('topRegion').textContent = state.me?.location?.region ? state.me.location.region : '';
  }

  // ------------------------------------------------------------ 실시간 알림 (Supabase Realtime, 연결 안 되면 폴링)
  let typingTimer;
  function connectLive() {
    if (state.liveFor === state.me.id) return;
    state.liveFor = state.me.id;
    Backend.subscribe(state.me.id, {
      status: (ok) => { state.live = ok; },
      noteNew: () => { toast('새 쪽지가 도착했어요'); refreshBadges(); if (location.hash.startsWith('#/notes')) route(); },
      noteAccepted: () => { toast('쪽지가 수락되었어요. 채팅을 시작해 보세요.'); refreshBadges(); },
      message: (msg) => {
        if (state.chatRoomId === msg.roomId) {
          appendMessage(msg);
          if (msg.senderId !== state.me.id) Backend.markRead(msg.roomId);
          if (msg.kind === 'system') refreshAppt();
        }
        else if (msg.senderId !== state.me.id) { refreshBadges(); if (location.hash === '#/chats') route(); }
      },
      read: (roomId) => { if (state.chatRoomId === roomId) markAllRead(); },
    });
    // 실시간 연결이 안 되는 환경에서는 4초마다 새 소식을 확인
    clearInterval(state.poller);
    state.poller = setInterval(() => { if (!state.live && state.me) poll(); }, 4000);
  }
  function disconnectLive() {
    Backend.unsubscribe();
    clearInterval(state.poller);
    state.liveFor = null; state.live = false;
  }
  async function poll() {
    refreshBadges();
    if (state.chatRoomId) {
      try {
        const data = await Backend.room(state.chatRoomId);
        const fresh = data.messages.filter((m) => !renderedIds.has(m.id));
        fresh.forEach(appendMessage);
        if (fresh.some((m) => m.kind === 'system')) renderAppt(data.room.appointment);
        const mineMsgs = data.messages.filter((m) => m.senderId === state.me.id && m.kind !== 'system');
        if (mineMsgs.length && mineMsgs.every((m) => m.readAt)) markAllRead();
      } catch {}
    } else if (location.hash === '#/chats') route();
  }
  const markAllRead = () => document.querySelectorAll('.msg.mine .unread').forEach((el) => el.remove());
  function showTyping() {
    const el = document.getElementById('typing');
    if (!el) return;
    el.textContent = '상대방이 입력 중...';
    clearTimeout(typingTimer); typingTimer = setTimeout(() => { el.textContent = ''; }, 2000);
  }

  async function refreshBadges() {
    if (!state.me) return;
    try {
      const b = await Backend.badges();
      document.getElementById('badgeNotes').textContent = b.notes || '';
      document.getElementById('badgeChats').textContent = b.chats || '';
    } catch {}
  }

  async function loadMe() {
    state.me = null;
    try { if (await Backend.session()) state.me = await Backend.me(); } catch {}
    return state.me;
  }

  // ------------------------------------------------------------ router
  const routes = [
    [/^#\/login$/, viewAuth.bind(null, 'login'), { public: true }],
    [/^#\/signup$/, viewAuth.bind(null, 'signup'), { public: true }],
    [/^#\/policy\/(terms|privacy|location)$/, viewPolicy, { any: true }],
    [/^#\/suspended$/, viewSuspended, { noVerify: true }],
    [/^#\/welcome$/, viewWelcome, { noVerify: true }],
    [/^#\/blocks$/, viewBlocks, { noVerify: true }],
    [/^#\/admin$/, viewAdmin, { noVerify: true }],
    [/^#\/verify$/, viewVerify, { noVerify: true }],
    [/^#\/me$/, viewMe, { noVerify: true }],
    [/^#\/lifts(?:\/(bench|squat|deadlift))?$/, viewLifts, { noVerify: true }],
    [/^#\/workout$/, viewWorkout, { noVerify: true }],
    [/^#\/posts\/new$/, viewPostNew],
    [/^#\/posts\/mine$/, viewMyPosts],
    [/^#\/notes$/, viewNotes],
    [/^#\/chats$/, viewChats],
    [/^#\/chat\/(\d+)$/, viewChat],
    [/^#\/?$/, viewHome],
  ];

  async function route() {
    const hash = location.hash || '#/';
    closeModal();
    state.chatRoomId = null;
    const match = routes.find(([re]) => re.test(hash)) || routes[routes.length - 1];
    const [re, fn, opts = {}] = match;
    if (opts.any) {
      if (!state.me) await loadMe();
    } else if (!opts.public) {
      // 정지 상태는 관리자가 해제할 수 있으므로 매번 다시 확인
      if ((!state.me || state.me.suspended) && !(await loadMe())) { location.hash = '#/login'; return; }
      // 정지된 계정 → 안내 화면, 약관 미동의(소셜 첫 가입·약관 변경) → 동의 화면
      if (state.me.suspended) { if (fn !== viewSuspended) { location.hash = '#/suspended'; return; } }
      else if (fn === viewSuspended) { location.hash = '#/'; return; }
      else if (!state.me.termsAgreed) { if (fn !== viewWelcome) { location.hash = '#/welcome'; return; } }
      if (!state.me.suspended && state.me.termsAgreed) { connectLive(); refreshBadges(); }
      if (!opts.noVerify && !state.me.location?.verified) { location.hash = '#/verify'; return; }
    } else if (state.me || await loadMe()) { location.hash = '#/'; return; }
    const params = hash.match(re)?.slice(1) || [];
    try { await fn(...params); } catch (e) {
      console.error(e);
      if (!handleCodeError(e)) toast(e.message); // 코드형 오류는 화면 이동으로 처리
    }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------ views: auth
  const KAKAO_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.27 4.66 6.67-.2.75-.74 2.72-.85 3.14-.13.52.19.51.4.37.17-.11 2.65-1.8 3.72-2.53.67.1 1.36.15 2.07.15 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg>';
  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  function viewAuth(mode) {
    setChrome({ bars: false });
    const providers = state.config.loginProviders; // config.js 의 authProviders (Supabase 에서 켠 소셜 로그인)
    const emailLogin = state.config.emailLogin;     // config.js 의 emailLogin (false 면 소셜 로그인만)
    const signup = mode === 'signup' && emailLogin;
    const social = `
      ${providers.includes('kakao') ? `<button type="button" class="btn block social kakao" data-oauth="kakao">${KAKAO_ICON}카카오로 시작하기</button>` : ''}
      ${providers.includes('google') ? `<button type="button" class="btn block social google" data-oauth="google">${GOOGLE_ICON}Google로 시작하기</button>` : ''}`;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero">
          <div class="brand" style="margin-bottom:48px">짐짝 <small>GYMJJAK</small></div>
          <h1>우리 동네에서<br>같이 운동할 사람</h1>
          <div class="muted">가까운 헬스장의 메이트를 찾고,<br>쪽지로 운동 약속을 잡아 보세요.</div>
          ${signup ? '' : `<ul class="auth-points">
            <li>${ic('shield-check', 16)}<span>동네 인증을 마친 회원끼리만 보여요</span></li>
            <li>${ic('message-circle', 16)}<span>쪽지를 수락한 상대와만 채팅해요</span></li>
            <li>${ic('lock', 16)}<span>불편한 회원은 바로 차단·신고할 수 있어요</span></li>
          </ul>`}
        </div>
        ${emailLogin ? `
        <form class="card stack" id="authForm">
          <label class="field"><span>이메일</span><input type="email" name="email" required autocomplete="email"></label>
          <label class="field"><span>비밀번호${signup ? ' (8자 이상)' : ''}</span><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
          ${signup ? '<label class="field"><span>닉네임</span><input type="text" name="nickname" required minlength="2" maxlength="20"></label>' : ''}
          ${signup ? agreementsHtml() : ''}
          <button class="btn primary block" type="submit">${signup ? '동의하고 가입하기' : '로그인'}</button>
          <div class="small muted" style="text-align:center">
            ${signup ? '이미 계정이 있나요? <a class="link" href="#/login">로그인</a>' : '처음이신가요? <a class="link" href="#/signup">회원가입</a>'}
          </div>
          ${providers.length ? `<div class="divider small muted">또는</div>${social}` : ''}
        </form>` : `
        <div class="card stack">
          ${providers.length ? `${social}
            <div class="small muted" style="text-align:center">처음이면 자동으로 가입돼요.<br>로그인 후 닉네임을 정하고 약관에 동의하면 시작할 수 있어요.</div>`
          : '<div class="banner small" style="display:block">로그인 방법이 설정되지 않았어요. <code>config.js</code> 의 <code>authProviders</code> 를 확인해 주세요.</div>'}
        </div>`}
        ${policyFooter()}
      </div></div>`));
    $app.querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', () => {
      b.disabled = true;
      Backend.oauth(b.dataset.oauth).catch((e) => { toast(e.message); b.disabled = false; });
    }));
    if (!emailLogin) return;
    const form = document.getElementById('authForm');
    if (signup) bindAgreements(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (signup && !agreementsOk(form)) return toast('필수 약관에 모두 동의해 주세요.');
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const fd = Object.fromEntries(new FormData(e.target));
      const body = { email: fd.email, password: fd.password, nickname: fd.nickname, ...(signup ? readAgreements(form) : {}) };
      try {
        if (signup) {
          const { needsConfirm } = await Backend.signup(body);
          if (needsConfirm) { showConfirmEmail(body.email); return; }
        } else {
          await Backend.login(body.email, body.password);
        }
        await loadMe();
        location.hash = state.me.location?.verified ? '#/' : '#/verify';
      } catch (err) {
        toast(err.message); btn.disabled = false;
        if (/이메일 인증을 완료/.test(err.message)) showConfirmEmail(body.email);
      }
    });
  }

  // 가입 후 이메일 인증 안내 (Supabase 'Confirm email' 설정이 켜진 경우)
  function showConfirmEmail(email) {
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero"><div class="logo">${ic('mail', 32)}</div><h1>메일함을 확인해 주세요</h1>
          <div class="muted"><b>${esc(email)}</b> 로 인증 메일을 보냈어요.<br>메일의 링크를 누르면 가입이 완료돼요.</div></div>
        <div class="card stack">
          <button class="btn block" id="resendBtn">인증 메일 다시 보내기</button>
          <button class="btn primary block" id="goLogin">로그인하러 가기</button>
          <div class="small muted">메일이 안 보이면 스팸함도 확인해 주세요.</div>
        </div>
      </div></div>`));
    // 이미 #/login 화면에서 이 안내로 바뀐 경우에도 로그인 화면을 다시 그린다
    document.getElementById('goLogin').addEventListener('click', () => { if (location.hash === '#/login') viewAuth('login'); else location.hash = '#/login'; });
    document.getElementById('resendBtn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await Backend.resendConfirm(email); toast('인증 메일을 다시 보냈어요'); } catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }

  // ------------------------------------------------------------ 약관 동의
  const AGREEMENTS = [
    ['agreeAge', '만 14세 이상입니다', null],
    ['agreeTerms', '이용약관 동의', 'terms'],
    ['agreePrivacy', '개인정보 수집·이용 동의', 'privacy'],
    ['agreeLocation', '위치기반서비스 이용약관 동의', 'location'],
  ];
  const agreementsHtml = () => `
    <div class="agree-box">
      <label class="agree-all"><input type="checkbox" data-agree-all> <b>전체 동의</b></label>
      ${AGREEMENTS.map(([name, label, doc]) => `
        <div class="agree-row">
          <label><input type="checkbox" data-agree="${name}"> <span class="req">(필수)</span> ${label}</label>
          ${doc ? `<button type="button" class="link small" data-policy="${doc}">보기</button>` : ''}
        </div>`).join('')}
    </div>`;
  function bindAgreements(root) {
    const all = root.querySelector('[data-agree-all]');
    const items = [...root.querySelectorAll('[data-agree]')];
    all.addEventListener('change', () => items.forEach((i) => { i.checked = all.checked; }));
    items.forEach((i) => i.addEventListener('change', () => { all.checked = items.every((x) => x.checked); }));
    root.querySelectorAll('[data-policy]').forEach((b) => b.addEventListener('click', () => showPolicyModal(b.dataset.policy)));
  }
  const readAgreements = (root) => Object.fromEntries([...root.querySelectorAll('[data-agree]')].map((i) => [i.dataset.agree, i.checked]));
  const agreementsOk = (root) => Object.values(readAgreements(root)).every(Boolean);

  const policyFooter = () => `
    <div class="policy-footer small muted">
      <a href="#/policy/terms">이용약관</a> · <a href="#/policy/privacy"><b>개인정보처리방침</b></a> · <a href="#/policy/location">위치기반서비스 이용약관</a>
      ${state.config.service.contactEmail ? `<br>문의 <a href="mailto:${esc(state.config.service.contactEmail)}">${esc(state.config.service.contactEmail)}</a>` : ''}
    </div>`;

  function showPolicyModal(doc) {
    const d = Policies.docs[doc];
    openModal(`<div class="policy">${d.render(state.config.service)}</div><button class="btn block" data-close style="margin-top:16px">닫기</button>`);
  }

  function viewPolicy(doc) {
    const loggedIn = !!state.me && state.me.termsAgreed && !state.me.suspended;
    setChrome({ tab: 'me', bars: loggedIn });
    $app.innerHTML = '';
    $app.append(h(`
      <div class="${loggedIn ? '' : 'auth-wrap policy-page'}"><div class="card policy">
        <a class="link small" href="javascript:history.back()">← 뒤로</a>
        ${Policies.docs[doc].render(state.config.service)}
      </div></div>`));
    window.scrollTo(0, 0);
  }

  // 소셜 로그인 첫 가입자 / 약관이 바뀐 기존 회원: 약관 동의 (+ 닉네임 확인)
  function viewWelcome() {
    setChrome({ bars: false });
    const isNew = !state.me.location; // 동네 인증 전이면 새로 가입한 사람
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero">
          <div class="logo">${ic('user', 32)}</div>
          <h1>${isNew ? '짐짝에 오신 걸 환영해요!' : '약관이 변경되었어요'}</h1>
          <div class="muted">${isNew ? '닉네임을 정하고 약관에 동의해 주세요' : '계속 이용하려면 변경된 약관에 동의해 주세요'}</div>
        </div>
        <form class="card stack" id="welcomeForm">
          ${isNew ? `<label class="field"><span>닉네임</span><input type="text" name="nickname" value="${esc(state.me.nickname)}" required minlength="2" maxlength="20"></label>` : ''}
          ${agreementsHtml()}
          <button class="btn primary block" type="submit">${isNew ? '동의하고 동네 인증하기' : '동의하고 계속하기'}</button>
          <button class="btn block" type="button" id="welcomeLogout">로그아웃</button>
        </form>
        ${policyFooter()}
      </div></div>`));
    const form = document.getElementById('welcomeForm');
    bindAgreements(form);
    document.getElementById('welcomeLogout').addEventListener('click', logout);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!agreementsOk(form)) return toast('필수 약관에 모두 동의해 주세요.');
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await Backend.agreeTerms(readAgreements(form), isNew ? form.nickname.value : null);
        await loadMe();
        location.hash = state.me.location?.verified ? '#/' : '#/verify';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------ 이용 정지 안내
  function viewSuspended() {
    setChrome({ bars: false });
    const sp = state.me.suspended;
    const email = state.config.service.contactEmail;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero"><div class="logo">${ic('lock', 32)}</div><h1>이용이 정지된 계정이에요</h1></div>
        <div class="card stack">
          <dl class="kv"><dt>사유</dt><dd>${esc(sp.reason || '운영정책 위반')}</dd><dt>정지 일시</dt><dd>${esc(parseDate(sp.at).toLocaleString('ko-KR'))}</dd></dl>
          <div class="small muted">정지 중에는 다른 회원에게 프로필이 보이지 않고 쪽지·채팅을 할 수 없어요.
            ${email ? `이의가 있으면 <a class="link" href="mailto:${esc(email)}">${esc(email)}</a>로 문의해 주세요.` : ''}</div>
          <button class="btn block" data-export>내 정보 내려받기</button>
          <button class="btn block" id="suspLogout">로그아웃</button>
          <button class="btn block danger" id="suspDelete">회원 탈퇴</button>
        </div>
        ${policyFooter()}
      </div></div>`));
    document.getElementById('suspLogout').addEventListener('click', logout);
    bindExport($app);
    document.getElementById('suspDelete').addEventListener('click', openDeleteAccount);
  }

  async function logout() {
    disconnectLive();
    await Backend.logout();
    state.me = null;
    location.hash = '#/login';
  }
  const bindExport = (root) => root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => Backend.exportData().catch((e) => toast(e.message))));

  // ------------------------------------------------------------ views: 동네 인증
  async function viewVerify() {
    setChrome({ tab: 'me' });
    const loc = state.me.location;
    const manual = state.config.allowManualLocation;
    $app.innerHTML = '';
    $app.append(h(`
      <h1>동네 인증</h1>
      <div class="card stack">
        ${loc ? `<div>현재 인증된 동네: <b>${esc(loc.region)}</b> <span class="muted small">${esc(loc.district || '')}</span><br>
          <span class="small ${loc.verified ? 'muted' : ''}" style="${loc.verified ? '' : 'color:var(--danger)'}">${loc.verified ? `인증일 ${esc(timeLabel(loc.verifiedAt))} · ${state.config.verifyValidDays}일간 유효` : '인증 기간이 만료되었어요. 다시 인증해 주세요.'}</span></div>` : ''}
        <p class="muted small" style="margin:0">지금 계신 곳의 GPS 위치로 동네를 인증해요. 인증된 동네 반경 안의 헬스메이트만 볼 수 있어요.<br>
        다른 사람에게는 위치가 보이지 않고, 동네 이름과 1km 단위 거리만 보여요.</p>
        <div id="verifyResult" class="small"></div>
        <button class="btn primary block" id="gpsBtn">${ic('map-pin')} 현재 위치로 동네 인증하기</button>
        ${manual ? `<form id="manualForm" class="stack">
          <div class="small muted">개발 모드: 위도·경도를 직접 입력해 인증할 수 있어요.</div>
          <div class="row">
            <input name="lat" type="number" step="any" required placeholder="위도 (예: 37.5)" value="${state.me.lat ?? ''}">
            <input name="lng" type="number" step="any" required placeholder="경도 (예: 127.03)" value="${state.me.lng ?? ''}">
          </div>
          <button class="btn block" type="submit">입력한 위치로 인증 (개발 모드)</button>
        </form>` : ''}
      </div>`));

    async function submit(body) {
      const r = document.getElementById('verifyResult');
      r.textContent = '동네를 확인하는 중...';
      try {
        const geo = await Geo.reverseGeocode(state.config, body.lat, body.lng);
        const res = await Backend.verifyLocation({ ...body, ...geo });
        await loadMe();
        r.innerHTML = `<b>${esc(res.region)}</b> 인증을 마쳤어요.`;
        toast(`${res.region} 인증이 완료되었어요`);
        setTimeout(() => { location.hash = state.me.profileComplete ? '#/' : '#/me'; }, 800);
      } catch (e) { r.textContent = e.message; }
    }

    document.getElementById('gpsBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않아요.');
      document.getElementById('verifyResult').textContent = '현재 위치를 가져오는 중...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          submit({ lat, lng, accuracy });
        },
        (err) => { document.getElementById('verifyResult').textContent = '위치 정보를 가져올 수 없어요. ' + (err.code === 1 ? '위치 권한을 허용해 주세요.' : err.message); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    if (manual) {
      document.getElementById('manualForm').addEventListener('submit', (e) => {
        e.preventDefault();
        submit({ lat: Number(e.target.lat.value), lng: Number(e.target.lng.value), manual: true });
      });
    }
  }

  // ------------------------------------------------------------ views: 홈 (주변 메이트 목록)
  async function viewHome() {
    setChrome({ tab: 'home', full: true });
    const { days } = state.config;
    const f = state.filter;
    const pf = state.postFilter;
    const tab = sessionStorageGet('homeTab') || 'posts';
    const liftChip = (l) => `<span class="chip ${pf.lifts.includes(l) ? 'on' : ''}" data-lift="${l}">${LIFT[l]}</span>`;
    const flagChip = (k, label) => `<span class="chip ${pf[k] ? 'on' : ''}" data-flag="${k}">${label}</span>`;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="home">
        <div class="home-controls stack">
          ${!state.me.profileComplete ? '<a href="#/me" class="banner">성별·나이·구력·운동 요일을 채우면 메이트들이 나를 알아볼 수 있어요. <b class="link">작성하기</b></a>' : ''}
          <div class="tabs" id="homeTabs"><button data-t="posts" class="${tab === 'posts' ? 'on' : ''}">구인 글</button><button data-t="mates" class="${tab === 'mates' ? 'on' : ''}">메이트</button></div>
          <div class="row">
            <select id="radiusSel" class="sm-select">
              ${[1, 3, 5, 10].map((r) => `<option value="${r}" ${r === f.radius ? 'selected' : ''}>반경 ${r}km</option>`).join('')}
            </select>
            ${tab === 'mates' ? `
            <select id="genderSel" class="sm-select">
              <option value="">성별 전체</option>
              <option value="male" ${f.gender === 'male' ? 'selected' : ''}>남성</option>
              <option value="female" ${f.gender === 'female' ? 'selected' : ''}>여성</option>
            </select>
            <select id="totalSel" class="sm-select">
              <option value="">3대 전체</option>
              ${[200, 300, 400, 500, 600].map((t) => `<option value="${t}" ${f.minTotal === t ? 'selected' : ''}>3대 ${t}+</option>`).join('')}
            </select>` : `<span class="spacer"></span><a class="btn sm primary" href="#/posts/new">${ic('plus', 16)}구인 글 쓰기</a>`}
          </div>
          ${tab === 'mates' ? `
          <div class="chips" id="filterChips">
            <span class="chip ${f.matchOnly ? 'on' : ''}" data-match>조건 맞는 사람만</span>
            ${days.map((d) => `<span class="chip ${f.days.includes(d) ? 'on' : ''}" data-day="${esc(d)}">${esc(d)}</span>`).join('')}
          </div>` : `
          <div class="chips" id="postChips">
            ${['bench', 'squat', 'deadlift'].map(liftChip).join('')}
            ${flagChip('eligible', '내 조건 충족')}${flagChip('today', '오늘')}${flagChip('evening', '저녁 7–9시')}${flagChip('verified', '1RM 인증')}
          </div>`}
        </div>
        <div class="home-list" id="mateList"><div class="empty">불러오는 중...</div></div>
      </div>`));

    document.getElementById('homeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.dataset.t === tab) return;
      sessionStorageSet('homeTab', b.dataset.t); viewHome().catch((err) => toast(err.message));
    });
    document.getElementById('radiusSel').addEventListener('change', (e) => { f.radius = Number(e.target.value); load(); });
    if (tab === 'posts') {
      document.getElementById('postChips').addEventListener('click', (e) => {
        const c = e.target.closest('.chip'); if (!c) return;
        if (c.dataset.lift) pf.lifts = pf.lifts.includes(c.dataset.lift) ? pf.lifts.filter((l) => l !== c.dataset.lift) : [...pf.lifts, c.dataset.lift];
        else pf[c.dataset.flag] = !pf[c.dataset.flag];
        c.classList.toggle('on');
        renderPosts();
      });
    } else {
      document.getElementById('genderSel').addEventListener('change', (e) => { f.gender = e.target.value || null; render(); });
      document.getElementById('totalSel').addEventListener('change', (e) => { f.minTotal = Number(e.target.value) || null; render(); });
      document.getElementById('filterChips').addEventListener('click', (e) => {
        const c = e.target.closest('.chip'); if (!c) return;
        if (c.hasAttribute('data-match')) f.matchOnly = !f.matchOnly;
        else f.days = f.days.includes(c.dataset.day) ? f.days.filter((d) => d !== c.dataset.day) : [...f.days, c.dataset.day];
        c.classList.toggle('on');
        render();
      });
    }

    async function load() {
      try {
        if (tab === 'posts') state.posts = await Backend.nearbyPosts(f.radius);
        else {
          state.nearby = await Backend.nearby(f.radius);
          state.nearby.users.forEach((u) => decorate(u));
        }
      } catch (e) {
        if (handleCodeError(e)) return;
        throw e;
      }
      if (!document.getElementById('mateList')) return;
      if (tab === 'posts') renderPosts(); else render();
    }

    function renderPosts() {
      const today = kstDate(new Date());
      const posts = state.posts.posts.filter((p) =>
        (!pf.lifts.length || pf.lifts.includes(p.lift))
        && (!pf.today || (p.kind === 'flash' ? kstDate(new Date(p.meetAt)) === today : p.days.includes(DOW[new Date(`${today}T12:00:00+09:00`).getDay()])))
        && (!pf.evening || (p.time >= '19:00' && p.time <= '21:00'))
        && (!pf.eligible || p.eligibility === 'ok')
        && (!pf.verified || p.author.verified));
      const list = document.getElementById('mateList');
      if (!posts.length) {
        list.innerHTML = `<div class="empty"><span class="big">${ic('search', 32)}</span>반경 ${state.posts.radius}km 안에 조건에 맞는 구인 글이 없어요.<br>필터를 줄이거나 직접 글을 올려 보세요.
          <div style="margin-top:16px"><a class="btn sm" href="#/posts/new">구인 글 쓰기</a></div></div>`;
        return;
      }
      list.innerHTML = `<div class="small muted" style="margin-bottom:8px">${esc(state.posts.region)} 근처 구인 글 <b>${posts.length}</b>개</div>`
        + posts.map((p) => postRow(p)).join('');
      list.querySelectorAll('.post-row').forEach((el) => el.addEventListener('click', () => {
        const p = posts.find((x) => String(x.id) === el.dataset.id);
        if (p.mine) location.hash = '#/posts/mine';
        else showProfile(p.userId, p.id).catch((e) => toast(e.message));
      }));
    }

    function render() {
      const users = state.nearby.users.filter((u) =>
        (!f.gender || u.gender === f.gender)
        && (!f.minTotal || u.total >= f.minTotal)
        && (!f.days.length || f.days.some((d) => u.workoutDays.includes(d)))
        && (!f.matchOnly || u.meetsMyPrefs));
      const list = document.getElementById('mateList');
      if (!users.length) {
        list.innerHTML = `<div class="empty"><span class="big">${ic('search', 32)}</span>반경 ${state.nearby.radius}km 안에 조건에 맞는 헬스메이트가 아직 없어요.<br>필터를 줄이거나 반경을 넓혀 보세요.</div>`;
        return;
      }
      list.innerHTML = `<div class="small muted" style="margin-bottom:8px">${esc(state.nearby.region)} 근처 헬스메이트 <b>${users.length}</b>명</div>` + users.map((u) => `
        <div class="user-card" data-id="${u.id}">
          ${avatar(u.photo)}
          <div class="meta">
            <div class="row"><span class="name">${esc(u.nickname)}</span>
              <span class="small muted ellipsis">${esc(personLine(u))}</span>
              <span class="spacer"></span><span class="small muted nowrap">${distLabel(u.distanceKm)}</span></div>
            <div class="lift-line">${liftLine(u)}</div>
            <div class="tags">
              ${u.workoutDays.length ? `<span class="tag gray">${esc(u.workoutDays.join('·'))}</span>` : ''}
              ${u.workoutTimes.length ? `<span class="tag gray">${esc(u.workoutTimes.join('·'))}</span>` : ''}
              ${u.gymName ? `<span class="tag gray">${esc(u.gymName)}</span>` : ''}
            </div>
            ${matchTags(u)}
          </div>
        </div>`).join('');
      list.querySelectorAll('.user-card').forEach((el) => el.addEventListener('click', () => showProfile(el.dataset.id).catch((e) => toast(e.message))));
    }

    await load();
  }

  // ------------------------------------------------------------ 프로필 표시 helpers
  // 조건 매칭 표시 (내 프로필 기준으로 계산)
  function meetsPrefs(c, owner) {
    const p = owner.prefs || {};
    if (p.gender && c.gender !== p.gender) return false;
    if (p.ageMin != null && !(c.age >= p.ageMin)) return false;
    if (p.ageMax != null && !(c.age <= p.ageMax)) return false;
    if (p.minTotal != null && !(c.total >= p.minTotal)) return false;
    return true;
  }
  function decorate(u) {
    const me = state.me;
    u.meetsMyPrefs = meetsPrefs(u, me);
    u.iMeetTheirPrefs = meetsPrefs(me, u);
    const norm = (g) => (g || '').replace(/\s/g, '');
    u.sameGym = !!(u.gymName && me.gymName && norm(u.gymName) === norm(me.gymName));
    u.commonDays = (u.workoutDays || []).filter((d) => (me.workoutDays || []).includes(d));
    return u;
  }
  const personLine = (u) => [genderLabel[u.gender], u.age ? `${u.age}세` : '', u.career ? `구력 ${u.career}` : ''].filter(Boolean).join(' · ');
  function liftLine(u) {
    if (u.bench == null && u.squat == null && u.deadlift == null) return '<span class="muted small">3대 기록 미입력</span>';
    const kg = (v) => (v == null ? '-' : v);
    return `${u.total != null ? `<b>3대 ${u.total}kg</b> ` : ''}<span class="muted small">B ${kg(u.bench)} · S ${kg(u.squat)} · D ${kg(u.deadlift)}</span>`;
  }
  function matchTags(u) {
    const t = [];
    if (u.meetsMyPrefs && u.iMeetTheirPrefs) t.push('<span class="tag">서로 조건 맞음</span>');
    else if (u.meetsMyPrefs) t.push('<span class="tag">내 조건에 맞음</span>');
    return t.length ? `<div class="tags" style="margin-top:4px">${t.join('')}</div>` : '';
  }
  function prefsLines(p) {
    const lines = [];
    if (p.gender) lines.push(`${genderLabel[p.gender]} 메이트`);
    if (p.ageMin != null || p.ageMax != null) lines.push(`${p.ageMin ?? ''}~${p.ageMax ?? ''}세`);
    if (p.minTotal != null) lines.push(`3대 ${p.minTotal}kg 이상`);
    return lines;
  }

  // ------------------------------------------------------------ 구인 글 · 1RM helpers
  const LIFT = { bench: '벤치', squat: '스쿼트', deadlift: '데드', etc: '기타' };
  const LIFT_FULL = { bench: '벤치프레스', squat: '스쿼트', deadlift: '데드리프트', etc: '기타' };
  const PART = { bench: '가슴', squat: '하체', deadlift: '등', etc: '자유' };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const LIFTS3 = ['bench', 'squat', 'deadlift'];
  const epley = (w, r) => (r <= 1 ? Number(w) : Math.round(w * (1 + r / 30) * 2) / 2); // 추정 1RM, 0.5kg 단위
  // 날짜 · 시간은 모두 한국 시간 기준
  const kstDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const kstDow = (ymd) => DOW[new Date(`${ymd}T12:00:00+09:00`).getDay()];
  function kstLabel(iso) {
    const d = new Date(iso);
    const t = d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
    const day = kstDate(d);
    if (day === kstDate(new Date())) return `오늘 ${t}`;
    if (day === kstDate(new Date(Date.now() + 864e5))) return `내일 ${t}`;
    const [, m, dd] = day.split('-').map(Number);
    return `${m}월 ${dd}일(${kstDow(day)}) ${t}`;
  }
  const postWhen = (p) => (p.kind === 'fixed' ? `${p.days.join('·')} ${p.time}` : kstLabel(p.meetAt));
  const timeWord = (t) => { const hr = Number(t.slice(0, 2)); return hr < 9 ? '새벽' : hr < 12 ? '오전' : hr < 17 ? '낮' : '저녁'; };
  function postTitle(p) {
    if (p.lift === 'etc') return p.kind === 'fixed' ? `${p.days.join('·')} 같이 운동할 고정 메이트 구해요` : '같이 운동하실 분 구해요';
    if (p.kind === 'fixed') return `${p.days.join('·')} ${timeWord(p.time)} ${PART[p.lift]} 고정 메이트 구해요`;
    return `${LIFT[p.lift]} ${p.workKg}kg 스팟 구해요`;
  }
  const condText = (p) => (p.lift === 'etc' || !p.min1rm ? '조건 없음' : `${LIFT[p.lift]} ${p.min1rm}kg 이상${p.requireVerified ? '(영상 인증)' : ''}`);
  const liftVerified = (u, l) => u.verified?.[l] != null && u.verified[l] >= (u[l] ?? 0);
  const liftStatus = (u, l) => (u[l] == null ? '미입력' : liftVerified(u, l) ? '영상 인증' : '자기 신고');
  const isVerifiedUser = (u) => LIFTS3.some((l) => u.verified?.[l] != null);
  const trustLine = (t) => `함께한 운동 ${t.together}회 · 노쇼 ${t.noshow}회${t.lateCancel ? ` · 늦은 취소 ${t.lateCancel}회` : ''}`;
  // 서버가 계산한 요청 가능 여부(eligibility) → 안내 문구
  function eligInfo(p) {
    const L = LIFT[p.lift]; const mine = state.me[p.lift];
    return {
      ok: { ok: true, text: p.lift === 'etc' || !p.min1rm ? '조건 없음 · 누구나 요청할 수 있어요' : `조건 충족 · 내 ${L} ${mine}kg` },
      own: { ok: false, text: '내가 올린 글' },
      closed: { ok: false, text: '마감된 글' },
      gender: { ok: false, text: '동성만 요청할 수 있는 글' },
      no_record: { ok: false, text: `내 정보에 ${L} 1RM을 입력하면 요청할 수 있어요`, fix: '#/me' },
      below: { ok: false, text: `조건 미달 · 내 ${L} ${mine}kg` },
      need_video: { ok: false, text: `영상 인증 필요 · 내 ${L} ${mine}kg ${liftStatus(state.me, p.lift)}`, fix: `#/lifts/${p.lift}` },
    }[p.eligibility] || { ok: false, text: '' };
  }
  function postRow(p) {
    const e = eligInfo(p);
    return `
      <div class="post-row" data-id="${p.id}">
        ${avatar(p.author.photo)}
        <div class="meta">
          <div class="row"><span class="name">${esc(p.author.nickname)}</span>${p.author.verified ? '<span class="tag">1RM 인증</span>' : ''}
            <span class="spacer"></span><span class="small muted nowrap">${p.mine ? '내 글' : distLabel(p.author.distanceKm)}</span></div>
          <div class="post-title">${esc(postTitle(p))}</div>
          <div class="small muted">${esc([postWhen(p), PART[p.lift], condText(p), p.kind === 'fixed' ? '고정' : '번개', p.sameGender ? '동성만' : ''].filter(Boolean).join(' · '))}</div>
          ${p.memo ? `<div class="small muted ellipsis">${esc(p.memo)}</div>` : ''}
          <div class="elig ${e.ok || p.mine ? 'ok' : ''}">${ic(e.ok || p.mine ? 'circle-check' : 'circle-alert', 16)}<span>${esc(p.mine ? `내 글 · 요청 ${p.applicants}명` : e.text)}</span>
            ${!p.mine && p.requested ? '<span class="muted">· 요청 보냄</span>' : ''}${!p.mine && p.applicants ? `<span class="muted">· 요청 ${p.applicants}명</span>` : ''}</div>
        </div>
      </div>`;
  }

  async function showProfile(id, postId = null) {
    const u = decorate(await Backend.profile(id));
    const posts = u.posts || [];
    let pick = posts.some((p) => p.id === postId) ? postId : (posts.find((p) => p.eligibility === 'ok') || posts[0])?.id ?? null;
    const defaultMsg = (p) => (p
      ? `안녕하세요! ${postWhen(p)} ${p.lift === 'etc' ? '같이 운동하고 싶어요.' : `${LIFT_FULL[p.lift]} 같이 하고 싶어요.${state.me[p.lift] != null ? ` 제 ${LIFT[p.lift]} 1RM은 ${state.me[p.lift]}kg이에요.` : ''}`}`
      : `안녕하세요! ${u.workoutDays.length ? `저도 ${u.workoutDays.join('·')}에 운동해요. ` : ''}같이 운동하실래요?`);
    let action;
    if (u.roomId) action = `<a class="btn primary block" href="#/chat/${u.roomId}">채팅방으로 이동</a>`;
    else if (u.pendingNote) action = `<button class="btn block" disabled>요청을 보냈어요 · 답장을 기다리는 중</button>`;
    else action = `
      ${u.iMeetTheirPrefs === false ? '<div class="banner small">상대가 원하는 메이트 조건과 맞지 않아요. 그래도 쪽지는 보낼 수 있어요.</div>' : ''}
      <form id="noteForm" class="stack">
        ${posts.length ? `<div class="field"><span class="field-label">어떤 운동으로 만날까요?</span>
          <div class="stack report-reasons" id="postPick">
            ${posts.map((p) => `<label class="row"><input type="radio" name="post" value="${p.id}" ${p.id === pick ? 'checked' : ''}>
              <span style="flex:1;min-width:0"><b>${esc(postTitle(p))}</b><br><span class="small muted">${esc(postWhen(p))} · ${esc(condText(p))}</span></span></label>`).join('')}
            <label class="row"><input type="radio" name="post" value="" ${pick == null ? 'checked' : ''}> <span>글 없이 쪽지 보내기</span></label>
          </div></div>` : ''}
        <div id="eligBox"></div>
        <label class="field"><span>${posts.length ? '첫 메시지' : '쪽지 보내기'}</span>
          <textarea name="content" maxlength="300" required></textarea></label>
        <button class="btn primary block" type="submit">요청 보내기</button>
        <div class="small muted">상대방이 수락하면 1:1 채팅이 열려요. 구인 글로 요청하면 운동 약속도 함께 만들어져요.<br>처음 만날 땐 헬스장 안에서 만나고, 돈이나 개인정보를 요구하면 신고해 주세요.</div>
      </form>`;
    const prefs = prefsLines(u.prefs);
    const t = u.trust || { together: 0, noshow: 0, lateCancel: 0, tags: [], reviews: [] };
    openModal(`
      <div class="profile-head">
        ${avatar(u.photo, 'lg')}
        <div>
          <div class="name">${esc(u.nickname)} ${isVerifiedUser(u) ? '<span class="tag">1RM 인증</span>' : ''}</div>
          <div class="muted small">${esc(personLine(u))}</div>
          <div class="small" style="margin-top:4px">${esc(u.region || '')} ${u.distanceKm != null ? `· ${distLabel(u.distanceKm)}` : ''}</div>
          <div class="small muted">${esc(trustLine(t))}</div>
        </div>
      </div>
      <div class="stack">
        <div class="lifts">
          ${LIFTS3.map((l) => `<div><span>${LIFT_FULL[l]}</span><b>${u[l] ?? '-'}</b><span class="${liftVerified(u, l) ? 'lift-ok' : ''}">${liftStatus(u, l)}</span></div>`).join('')}
          <div class="total"><span>3대 합계</span><b>${u.total ?? '-'}</b></div>
        </div>
        ${matchTags(u)}
        <dl class="kv">
          <dt>헬스장</dt><dd>${esc(u.gymName || '-')}</dd>
          <dt>운동 요일</dt><dd>${esc(u.workoutDays.join(' · ') || '-')}</dd>
          <dt>시간대</dt><dd>${esc(u.workoutTimes.join(' · ') || '-')}</dd>
        </dl>
        ${u.bio ? `<div class="note-body">${esc(u.bio)}</div>` : ''}
        ${t.tags.length || t.reviews.length ? `<div class="pref-box">
          <div class="small" style="font-weight:600;margin-bottom:6px">함께 운동한 메이트 후기</div>
          ${t.tags.length ? `<div class="chips">${t.tags.map(([tag, n]) => `<span class="tag">${esc(tag)} ${n}</span>`).join('')}</div>` : ''}
          ${t.reviews.map((r) => `<div class="small review-line">"${esc(r)}"</div>`).join('')}
        </div>` : ''}
        <div class="pref-box">
          <div class="small" style="font-weight:700;margin-bottom:6px">이런 헬스메이트를 찾아요</div>
          ${prefs.length || u.prefs.note ? `
            ${prefs.length ? `<div class="chips">${prefs.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div>` : ''}
            ${u.prefs.note ? `<div class="small" style="margin-top:6px;white-space:pre-wrap">${esc(u.prefs.note)}</div>` : ''}`
          : '<div class="small muted">특별한 조건 없음 · 누구나 환영</div>'}
        </div>
        <div class="safety-note small muted">${ic('shield-check', 16)}<span>첫 만남은 헬스장 안에서 해요</span></div>
        ${action}
        <button class="btn block" data-close>닫기</button>
        <div class="safety-actions">
          <button type="button" class="link small muted" id="pReport">신고하기</button>
          <button type="button" class="link small muted" id="pBlock">차단하기</button>
        </div>
      </div>`);
    document.getElementById('pReport').addEventListener('click', () => openReport(u));
    document.getElementById('pBlock').addEventListener('click', () => blockUser(u));
    const form = document.getElementById('noteForm');
    if (!form) return;
    const btn = form.querySelector('button[type=submit]');
    // 고른 글에 따라 요청 가능 여부와 기본 메시지를 바꾼다 (메시지를 직접 고쳤으면 그대로 둔다)
    let lastDefault = '';
    const sync = () => {
      const p = posts.find((x) => x.id === pick) || null;
      const e = p ? eligInfo(p) : { ok: true };
      document.getElementById('eligBox').innerHTML = p && !e.ok ? `<div class="banner small">${ic('circle-alert', 16)}<span>${esc(e.text)}${e.fix ? ` <a class="link" href="${e.fix}">${e.fix.startsWith('#/lifts') ? '영상 인증하러 가기' : '입력하러 가기'}</a>` : ''}</span></div>` : '';
      btn.disabled = !e.ok;
      if (!form.content.value || form.content.value === lastDefault) form.content.value = lastDefault = defaultMsg(p);
    };
    document.getElementById('postPick')?.addEventListener('change', (e) => { pick = e.target.value ? Number(e.target.value) : null; sync(); });
    sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await Backend.sendNote(u.id, form.content.value, pick);
        toast('요청을 보냈어요. 상대방이 수락하면 알려드릴게요');
        closeModal();
        if (location.hash === '#/' || location.hash === '') route();
      } catch (err) {
        if (err.roomId) { location.hash = `#/chat/${err.roomId}`; return; }
        toast(err.message); btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------ views: 쪽지함
  async function viewNotes(box = sessionStorageGet('notesBox') || 'inbox') {
    setChrome({ tab: 'notes' });
    const notes = await Backend.notes(box);
    refreshBadges();
    // 보낸 요청이 거절되면 상대에게는 '마감됨'으로 부드럽게 보여 준다
    const statusLabel = { pending: '대기 중', accepted: '수락됨', declined: box === 'sent' ? '마감됨' : '거절함' };
    $app.innerHTML = '';
    $app.append(h(`
      <h1>쪽지함</h1>
      <div class="tabs"><button data-box="inbox" class="${box === 'inbox' ? 'on' : ''}">받은 쪽지</button><button data-box="sent" class="${box === 'sent' ? 'on' : ''}">보낸 쪽지</button></div>
      <div id="noteList">
        ${notes.length ? notes.map((n) => `
          <div class="card" style="margin-bottom:10px" data-id="${n.id}">
            <div class="row">
              ${avatar(n.other.photo)}
              <div style="flex:1;min-width:0">
                <div class="row"><b class="profile-link" data-uid="${n.other.id}" style="cursor:pointer">${esc(n.other.nickname)}</b>
                  <span class="small muted">${esc(n.other.region || '')}</span></div>
                <div class="small muted">${esc(timeLabel(n.createdAt))}</div>
              </div>
              <span class="status ${n.status}">${statusLabel[n.status]}</span>
            </div>
            ${n.post ? `<div class="small note-post">${ic('calendar', 16)}<span><b>${esc(postTitle(n.post))}</b> · ${esc(postWhen(n.post))}
              ${box === 'inbox' && n.post.lift !== 'etc' ? `<br><span class="muted">${LIFT[n.post.lift]} ${n.otherLiftKg ?? '-'}kg ${n.otherLiftVerifiedKg != null && n.otherLiftVerifiedKg >= (n.otherLiftKg ?? 0) ? '영상 인증' : '자기 신고'}${n.post.min1rm ? ` · 조건 ${n.post.min1rm}kg 이상` : ''}</span>` : ''}</span></div>` : ''}
            <div class="note-body">${esc(n.content)}</div>
            ${box === 'inbox' && n.status === 'pending' ? `
              <div class="row"><button class="btn" data-act="decline">거절</button><span class="spacer"></span><button class="btn primary" data-act="accept">수락하고 채팅 시작</button></div>` : ''}
            ${n.status === 'accepted' && n.roomId ? `<a class="btn block" href="#/chat/${n.roomId}">채팅방으로 이동</a>` : ''}
          </div>`).join('') : `<div class="empty"><span class="big">${ic('mail', 32)}</span>${box === 'inbox' ? '받은 쪽지가 없어요.<br>동네 메이트에게 먼저 쪽지를 보내 보세요.' : '보낸 쪽지가 없어요.'}</div>`}
      </div>`));
    $app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { sessionStorageSet('notesBox', b.dataset.box); viewNotes(b.dataset.box); }));
    $app.querySelectorAll('.profile-link').forEach((el) => el.addEventListener('click', () => showProfile(el.dataset.uid).catch((e) => toast(e.message))));
    $app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = Number(b.closest('[data-id]').dataset.id);
      try {
        if (b.dataset.act === 'accept') {
          const roomId = await Backend.acceptNote(id);
          location.hash = `#/chat/${roomId}`;
        } else {
          if (!confirm('이 요청을 거절할까요?\n상대에게는 \'마감됨\'으로 보여요.')) return;
          await Backend.declineNote(id);
          toast('거절했어요');
          viewNotes(box);
        }
      } catch (e) { toast(e.message); }
    }));
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

  // ------------------------------------------------------------ 신고 · 차단
  const safetyDismissed = (roomId) => { try { return localStorage.getItem(`safety:${roomId}`) === '1'; } catch { return false; } };

  function openReport(user, roomId = null) {
    openModal(`
      <h2>${esc(user.nickname)}님 신고하기</h2>
      <form id="reportForm" class="stack">
        <div class="stack report-reasons">
          ${state.config.reportReasons.map((r) => `<label class="row"><input type="radio" name="reason" value="${esc(r)}" required> ${esc(r)}</label>`).join('')}
        </div>
        <label class="field"><span>자세한 내용 (선택, '기타'는 필수)</span><textarea name="detail" maxlength="1000" placeholder="어떤 일이 있었는지 알려주세요"></textarea></label>
        ${roomId ? '<div class="small muted">신고 확인을 위해 이 채팅방의 최근 대화 내용이 운영팀에 함께 전달돼요.</div>' : ''}
        <label class="row small"><input type="checkbox" name="block" checked> 이 사용자 차단하기 (서로 보이지 않고 연락할 수 없어요)</label>
        <button class="btn primary block" type="submit">신고하기</button>
        <button class="btn block" type="button" data-close>취소</button>
      </form>`);
    const form = document.getElementById('reportForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const r = await Backend.report({ targetId: user.id, reason: form.reason.value, detail: form.detail.value, roomId, block: form.block.checked });
        closeModal();
        toast(r.blocked ? '신고가 접수되고 차단되었어요. 운영팀이 확인할게요.' : '신고가 접수되었어요. 운영팀이 확인할게요.');
        if (r.blocked) afterBlock(roomId ? () => { location.hash = '#/chats'; } : null);
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  async function blockUser(user, after) {
    if (!confirm(`${user.nickname}님을 차단할까요?\n서로 프로필이 보이지 않고 쪽지·채팅을 주고받을 수 없어요. 차단은 [내 정보 → 차단 목록]에서 해제할 수 있어요.`)) return;
    try {
      await Backend.block(user.id);
      closeModal();
      toast(`${user.nickname}님을 차단했어요`);
      afterBlock(after);
    } catch (err) { toast(err.message); }
  }
  function afterBlock(after) {
    refreshBadges();
    if (after) after(); else route();
  }

  async function viewBlocks() {
    setChrome({ tab: 'me' });
    const list = await Backend.blocks();
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/me">← 내 정보</a>
      <h1>차단 목록</h1>
      ${list.length ? list.map((u) => `
        <div class="list-item">
          ${avatar(u.photo)}
          <div class="meta"><div class="title">${esc(u.nickname)}</div><div class="sub">${esc(timeLabel(u.blockedAt))} 차단</div></div>
          <button class="btn sm" data-unblock="${u.id}" data-name="${esc(u.nickname)}">차단 해제</button>
        </div>`).join('') : '<div class="empty">차단한 사용자가 없어요.</div>'}`));
    $app.querySelectorAll('[data-unblock]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.name}님의 차단을 해제할까요?`)) return;
      await Backend.unblock(b.dataset.unblock);
      toast('차단을 해제했어요'); viewBlocks();
    }));
  }

  // ------------------------------------------------------------ 관리자: 신고 처리
  async function viewAdmin(tab = 'pending') {
    setChrome({ tab: 'me' });
    if (!state.me.isAdmin) { location.hash = '#/me'; return; }
    const tabs = [['pending', '대기 중'], ['actioned', '조치 완료'], ['dismissed', '기각'], ['suspended', '정지 회원'], ['lifts', '영상 인증']];
    const data = tab === 'suspended' ? await Backend.adminSuspended() : tab === 'lifts' ? await Backend.adminLifts('pending') : await Backend.adminReports(tab);
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/me">← 내 정보</a>
      <h1>신고 관리</h1>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="adminList">${tab === 'suspended' ? suspendedHtml(data) : tab === 'lifts' ? liftsHtml(data) : reportsHtml(data, tab)}</div>`));
    if (tab === 'lifts') bindAdminLifts(data);
    $app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => viewAdmin(b.dataset.tab)));
    $app.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
      const action = b.dataset.resolve;
      let reason = '';
      if (action === 'suspend') {
        reason = prompt('정지 사유 (회원에게 표시돼요)', `운영정책 위반 (${b.dataset.reason})`);
        if (reason === null) return;
      } else if (!confirm('이 신고를 기각할까요?')) return;
      await Backend.adminResolve(Number(b.dataset.id), action, reason);
      toast(action === 'suspend' ? '이용 정지했어요' : '기각했어요'); viewAdmin(tab);
    }));
    $app.querySelectorAll('[data-unsuspend]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.name}님의 정지를 해제할까요?`)) return;
      await Backend.adminUnsuspend(b.dataset.unsuspend);
      toast('정지를 해제했어요'); viewAdmin(tab);
    }));
  }
  function reportsHtml(list, tab) {
    if (!list.length) return '<div class="empty">신고가 없어요.</div>';
    return list.map((r) => `
      <div class="card stack" style="margin-bottom:10px">
        <div class="row wrap">
          <b>${esc(r.target.nickname)}</b>
          <span class="small muted">${esc(r.target.email || '')} ${r.target.deleted ? '(탈퇴)' : ''}</span>
          <span class="spacer"></span>
          <span class="status ${r.target.suspended ? 'declined' : 'pending'}">${r.target.suspended ? '정지됨' : '이용 중'}</span>
        </div>
        <div><span class="tag">${esc(r.reason)}</span> <span class="small muted">누적 신고 ${r.target.reportCount}건</span></div>
        ${r.detail ? `<div class="note-body">${esc(r.detail)}</div>` : ''}
        ${r.evidence ? `
          <details><summary class="small">신고된 대화 (${r.evidence.length}개)</summary>
            <div class="evidence">${r.evidence.map((m) => `<div class="${m.from}"><b>${m.from === 'target' ? esc(r.target.nickname) : esc(r.reporter.nickname)}</b> ${esc(m.content)} <span class="muted">${esc(timeLabel(m.at))}</span></div>`).join('')}</div>
          </details>` : ''}
        ${r.target.suspended ? `<div class="small muted">정지 사유: ${esc(r.target.suspended.reason || '')}</div>` : ''}
        <div class="small muted">신고자 ${esc(r.reporter.nickname)} · ${esc(parseDate(r.createdAt).toLocaleString('ko-KR'))}</div>
        ${tab === 'pending' && !r.target.deleted ? `
          <div class="row"><button class="btn sm" data-resolve="dismiss" data-id="${r.id}">기각</button><span class="spacer"></span>
            <button class="btn sm danger" data-resolve="suspend" data-id="${r.id}" data-reason="${esc(r.reason)}">이용 정지</button></div>` : ''}
        ${tab === 'pending' && r.target.deleted ? `<div class="row"><button class="btn sm" data-resolve="dismiss" data-id="${r.id}">처리 완료 (탈퇴 회원)</button></div>` : ''}
      </div>`).join('');
  }
  function liftsHtml(list) {
    if (!list.length) return '<div class="empty">검토할 영상이 없어요.</div>';
    return list.map((v) => `
      <div class="card stack" style="margin-bottom:10px" data-lift-id="${v.id}">
        <div class="row wrap"><b>${esc(v.user.nickname)}</b><span class="tag">${LIFT_FULL[v.lift]} ${v.weightKg}kg</span>
          <span class="spacer"></span><span class="small muted">코드 <b>${esc(v.code)}</b></span></div>
        <div class="small muted">자기 신고 기록 ${v.user.selfKg ?? '-'}kg · 코드 발급 ${esc(parseDate(v.codeIssuedAt).toLocaleString('ko-KR'))} · 제출 ${esc(parseDate(v.submittedAt).toLocaleString('ko-KR'))}</div>
        <video controls playsinline preload="metadata" class="lift-video"></video>
        <div class="small muted">확인할 것: 원판 무게가 보이는지, 코드 ${esc(v.code)}가 보이는지, 편집 없이 한 번에 찍었는지, 종목 기준을 지켰는지</div>
        <div class="row"><button class="btn sm danger" data-review="reject">반려</button><span class="spacer"></span><button class="btn sm primary" data-review="approve">통과</button></div>
      </div>`).join('');
  }
  function bindAdminLifts(list) {
    list.forEach((v) => {
      const card = $app.querySelector(`[data-lift-id="${v.id}"]`);
      Backend.liftVideoUrl(v.videoPath).then((url) => { card.querySelector('video').src = url; }).catch((e) => toast(e.message));
      card.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', async () => {
        const approve = b.dataset.review === 'approve';
        let reason = '';
        if (!approve) {
          reason = prompt('반려 사유 (회원에게 표시돼요)', '인증 코드가 영상에서 읽히지 않아요. 코드를 카메라 가까이에 두고 다시 찍어 주세요.');
          if (reason === null) return;
        } else if (!confirm(`${v.user.nickname}님의 ${LIFT_FULL[v.lift]} ${v.weightKg}kg을 통과시킬까요?`)) return;
        try { await Backend.adminReviewLift(v.id, approve, reason); toast(approve ? '통과시켰어요' : '반려했어요'); viewAdmin('lifts'); }
        catch (e) { toast(e.message); }
      }));
    });
  }
  function suspendedHtml(list) {
    if (!list.length) return '<div class="empty">정지된 회원이 없어요.</div>';
    return list.map((u) => `
      <div class="list-item">
        <div class="meta"><div class="title">${esc(u.nickname)} <span class="small muted">${esc(u.email || '')}</span></div>
          <div class="sub">${esc(u.reason || '')} · ${esc(timeLabel(u.suspendedAt))}</div></div>
        <button class="btn sm" data-unsuspend="${u.id}" data-name="${esc(u.nickname)}">정지 해제</button>
      </div>`).join('');
  }

  // ------------------------------------------------------------ views: 채팅 목록
  async function viewChats() {
    setChrome({ tab: 'chats' });
    const rooms = await Backend.rooms();
    $app.innerHTML = '';
    $app.append(h(`
      <h1>채팅</h1>
      ${rooms.length ? rooms.map((r) => `
        <a class="list-item" href="#/chat/${r.id}">
          ${avatar(r.other.photo)}
          <div class="meta">
            <div class="row"><span class="title">${esc(r.other.nickname)}</span><span class="small muted">${esc(r.other.region || '')}</span>
              <span class="spacer"></span><span class="small muted">${esc(timeLabel(r.lastAt))}</span></div>
            <div class="row"><span class="sub" style="flex:1">${esc(r.lastMessage || '대화를 시작해 보세요')}</span>
              ${r.unread ? `<b class="badge" style="position:static">${r.unread}</b>` : ''}</div>
          </div>
        </a>`).join('') : `<div class="empty"><span class="big">${ic('message-circle', 32)}</span>아직 채팅방이 없어요.<br>쪽지가 수락되면 여기에서 대화할 수 있어요.</div>`}`));
  }

  // ------------------------------------------------------------ views: 1:1 채팅방
  let lastDay = null;
  const renderedIds = new Set();
  async function viewChat(roomId) {
    roomId = Number(roomId);
    setChrome({ tab: 'chat', full: true });
    const data = await Backend.room(roomId);
    refreshBadges();
    const other = data.room.other;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="chat">
        <div class="chat-head">
          <a href="#/chats" class="btn sm" aria-label="뒤로">←</a>
          ${avatar(other.photo)}
          <div style="flex:1;min-width:0"><b>${esc(other.nickname)}</b><div class="small muted">${esc(other.region || '')}</div></div>
          <button class="btn sm" id="chatMenu" aria-label="메뉴">⋯</button>
        </div>
        <div id="apptBox"></div>
        ${safetyDismissed(roomId) ? '' : `
          <div class="safety-banner" id="safetyBanner">
            ${ic('shield-check', 16)}<span><b>안전 수칙</b> 첫 만남은 헬스장 등 공개된 장소에서 · 금전 요구·외부 링크 주의 · 불쾌한 대화는 ⋯ 메뉴에서 신고해 주세요</span>
            <button type="button" class="link small" id="safetyClose">닫기</button>
          </div>`}
        <div class="chat-msgs" id="msgs"></div>
        <div class="typing" id="typing"></div>
        ${data.room.canSend ? `
        <form class="chat-input" id="chatForm">
          <textarea name="content" placeholder="메시지를 입력하세요" maxlength="1000" rows="1"></textarea>
          <button class="btn primary" type="submit">전송</button>
        </form>` : '<div class="chat-input cannot-send small muted">메시지를 보낼 수 없는 상대예요.</div>'}
      </div>`));
    state.chatRoomId = roomId;
    state.chatRoom = data.room;
    lastDay = null;
    renderedIds.clear();
    renderAppt(data.room.appointment);
    data.messages.forEach(appendMessage);
    if (!data.messages.length) document.getElementById('msgs').innerHTML = '<div class="day-sep">채팅방이 열렸어요. 인사를 건네 보세요.</div>';
    scrollBottom();

    document.getElementById('safetyClose')?.addEventListener('click', () => {
      document.getElementById('safetyBanner').remove();
      try { localStorage.setItem(`safety:${roomId}`, '1'); } catch {}
    });
    document.getElementById('chatMenu').addEventListener('click', () => {
      openModal(`
        <div class="menu-sheet">
          <div class="small muted" style="text-align:center;margin-bottom:8px">${esc(other.nickname)}</div>
          <button class="btn block" data-m="profile">프로필 보기</button>
          <button class="btn block" data-m="report">신고하기</button>
          <button class="btn block danger" data-m="block">차단하기</button>
          <button class="btn block" data-close>취소</button>
        </div>`);
      $modalBody.querySelector('[data-m=profile]').addEventListener('click', () => showProfile(other.id).catch((e) => toast(e.message)));
      $modalBody.querySelector('[data-m=report]').addEventListener('click', () => openReport(other, roomId));
      $modalBody.querySelector('[data-m=block]').addEventListener('click', () => blockUser(other, () => { location.hash = '#/chats'; }));
    });
    const form = document.getElementById('chatForm');
    if (!form) return;
    const typing = Backend.typingChannel(roomId, (p) => { if (p.from !== state.me.id && state.chatRoomId === roomId) showTyping(); });
    const ta = form.content;
    let lastTyping = 0;
    const send = async () => {
      const content = ta.value.trim();
      if (!content) return;
      ta.value = ''; ta.style.height = '';
      try { appendMessage(await Backend.sendMessage(roomId, content)); } catch (e) { toast(e.message); ta.value = content; return; }
      // 전화번호 · 메신저 아이디를 주고받으면 한 번 주의 안내 (내 화면에만 표시)
      if (CONTACT_RE.test(content) && !safetyDismissed(`contact:${roomId}`)) {
        document.getElementById('msgs').append(h(`<div class="sys-msg warn">개인 연락처는 신중하게 공유해 주세요. 약속을 앱 안에서 잡아야 노쇼 기록과 신고가 남아요.</div>`));
        scrollBottom();
        try { localStorage.setItem(`safety:contact:${roomId}`, '1'); } catch {}
      }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); ta.focus(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    ta.addEventListener('input', () => {
      ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      if (Date.now() - lastTyping > 1200) { lastTyping = Date.now(); typing.send({ from: state.me.id }); }
    });
  }

  function appendMessage(m) {
    const box = document.getElementById('msgs');
    if (!box || renderedIds.has(m.id)) return; // 실시간 수신과 전송 결과가 겹치면 한 번만 표시
    renderedIds.add(m.id);
    box.querySelector('.day-sep:only-child')?.remove();
    const d = parseDate(m.createdAt);
    const day = d.toDateString();
    let html = '';
    if (day !== lastDay) { lastDay = day; html += `<div class="day-sep">${d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</div>`; }
    const mine = m.senderId === state.me.id;
    if (m.kind === 'system') html += `<div class="sys-msg">${esc(m.content)}</div>`;
    else html += `<div class="msg ${mine ? 'mine' : ''}"><div class="bubble">${esc(m.content)}</div>
      <div class="time">${mine && !m.readAt ? '<span class="unread">1</span>' : ''}${d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</div></div>`;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.append(h(html));
    document.getElementById('typing').textContent = '';
    if (nearBottom || mine) scrollBottom();
  }
  function scrollBottom() { const b = document.getElementById('msgs'); if (b) b.scrollTop = b.scrollHeight; }

  // ------------------------------------------------------------ 채팅방: 운동 약속 카드
  const CONTACT_RE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}|카톡|카카오\s*아이디|오픈\s*채팅|인스타|텔레그램|전화번호/;
  const GOOD_TAGS = ['시간 약속을 잘 지켜요', '스팟이 정확해요', '고중량 보조에 익숙해요', '자세를 잘 봐줘요', '친절해요'];
  const BAD_TAGS = ['약속 시간에 늦었어요', '스팟이 불안했어요', '운동과 관계없는 대화가 많았어요'];

  async function refreshAppt() {
    const roomId = state.chatRoomId;
    if (!roomId) return;
    try {
      const data = await Backend.room(roomId);
      if (state.chatRoomId === roomId) { state.chatRoom = data.room; renderAppt(data.room.appointment); }
    } catch {}
  }

  function renderAppt(a) {
    const box = document.getElementById('apptBox');
    if (!box) return;
    const canSend = state.chatRoom?.canSend;
    const other = state.chatRoom?.other?.nickname || '상대';
    const active = a && (a.status === 'pending' || a.status === 'confirmed');
    if (!active && !(a && a.status === 'done' && a.canReview)) {
      box.innerHTML = canSend ? `<div class="appt-empty small">
        <span class="muted">${a?.status === 'done' ? `지난 운동 · ${esc(kstLabel(a.meetAt))}${a.myReview ? ' · 후기 남김' : ''}` : a?.status === 'cancelled' ? `약속이 취소됐어요${a.lateCancel ? ' (2시간 이내 취소)' : ''}` : '같이 운동할 시간을 정해 보세요'}</span>
        <button class="btn sm" data-a="propose">${a ? '새 약속 잡기' : '운동 약속 잡기'}</button></div>` : '';
      bindAppt(a);
      return;
    }
    const label = { pending: '확정 대기', confirmed: '확정', done: '완료' }[a.status];
    let body = '';
    if (a.status === 'pending') {
      body = a.proposedByMe
        ? `<div class="small muted">${esc(other)}님이 확정하면 약속이 잡혀요.</div>
           <div class="row"><button class="btn sm" data-a="propose">시간 바꾸기</button><button class="btn sm" data-a="cancel">약속 취소</button></div>`
        : `<div class="row appt-btns"><button class="btn primary" data-a="confirm">약속 확정</button><button class="btn" data-a="propose">시간 변경</button></div>`;
    } else if (a.status === 'confirmed') {
      const state2 = a.myCheckin
        ? `체크인 완료 · ${a.otherCheckin ? `${esc(other)}님도 도착했어요` : `${esc(other)}님이 도착하면 알려드려요`}`
        : a.canCheckin ? '헬스장에 도착하면 체크인해 주세요.' : new Date(a.checkinOpensAt) > new Date() ? `체크인은 ${esc(kstLabel(a.checkinOpensAt))}부터 할 수 있어요.` : '체크인 시간이 지났어요.';
      body = `<div class="small muted">${state2}</div>
        <div class="row appt-btns">
          ${a.canCheckin ? '<button class="btn primary" data-a="checkin">헬스장 도착 체크인</button>' : ''}
          ${a.canReview ? '<button class="btn primary" data-a="review">운동 끝 · 후기 남기기</button>' : ''}
          ${!(a.myCheckin && a.otherCheckin) ? '<button class="btn" data-a="cancel">약속 취소</button>' : ''}
        </div>`;
    } else {
      body = `<div class="row appt-btns"><button class="btn primary" data-a="review">후기 남기기</button></div>`;
    }
    box.innerHTML = `
      <div class="appt">
        <div class="appt-head small"><span class="muted">운동 약속</span><span class="status ${a.status === 'confirmed' ? 'accepted' : 'pending'}">${label}</span></div>
        <div class="appt-title">${esc(kstLabel(a.meetAt))} · ${esc(a.title)}</div>
        ${a.place ? `<div class="small muted">${esc(a.place)}</div>` : ''}
        ${body}
      </div>`;
    bindAppt(a);
  }

  function bindAppt(a) {
    const box = document.getElementById('apptBox');
    const run = (fn, msg) => async (e) => {
      e.target.disabled = true;
      try { renderAppt(await fn()); if (msg) toast(msg); } catch (err) { toast(err.message); e.target.disabled = false; }
    };
    box.querySelector('[data-a=propose]')?.addEventListener('click', () => openPropose(a));
    box.querySelector('[data-a=confirm]')?.addEventListener('click', run(() => Backend.confirmAppointment(a.id), '약속을 확정했어요'));
    box.querySelector('[data-a=checkin]')?.addEventListener('click', run(() => Backend.checkinAppointment(a.id), '체크인했어요'));
    box.querySelector('[data-a=review]')?.addEventListener('click', () => openReview(a));
    box.querySelector('[data-a=cancel]')?.addEventListener('click', (e) => {
      const late = a.status === 'confirmed' && new Date(a.meetAt) - Date.now() < 2 * 3600e3;
      if (!confirm(late ? '약속 2시간 이내 취소는 \'늦은 취소\'로 기록되고 프로필에 보여요. 취소할까요?' : '약속을 취소할까요?')) return;
      run(() => Backend.cancelAppointment(a.id), '약속을 취소했어요')(e);
    });
  }

  function openPropose(a) {
    const active = a && (a.status === 'pending' || a.status === 'confirmed');
    const base = active ? new Date(a.meetAt) : new Date(Date.now() + 864e5);
    const ymd = kstDate(base);
    const dates = [...Array(14)].map((_, i) => kstDate(new Date(Date.now() + i * 864e5)));
    const hm = base.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
    openModal(`
      <h2>${active ? '약속 시간 바꾸기' : '운동 약속 잡기'}</h2>
      <form id="proposeForm" class="stack">
        <div class="grid2">
          <label class="field"><span>날짜</span><select name="date">${dates.map((d, i) => `<option value="${d}" ${d === ymd ? 'selected' : ''}>${i === 0 ? '오늘' : i === 1 ? '내일' : `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`}(${kstDow(d)})</option>`).join('')}</select></label>
          <label class="field"><span>시간</span><select name="time">${TIMES.map((t) => `<option ${t === roundTime(hm) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>무엇을 할까요</span><input type="text" name="title" maxlength="40" value="${esc(active ? a.title : '같이 운동')}" required></label>
        <label class="field"><span>장소</span><input type="text" name="place" maxlength="80" value="${esc(active ? a.place : state.me.gymName || '')}" placeholder="예) 바벨클럽 정자점 벤치 구역"></label>
        <div class="small muted">${esc(state.chatRoom?.other?.nickname || '상대')}님이 확정하면 약속이 잡혀요.</div>
        <button class="btn primary block" type="submit">${active ? '바꾸자고 제안하기' : '약속 제안하기'}</button>
        <button class="btn block" type="button" data-close>취소</button>
      </form>`);
    const form = document.getElementById('proposeForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const meetAt = new Date(`${form.date.value}T${form.time.value}:00+09:00`).toISOString();
        renderAppt(await Backend.proposeAppointment(state.chatRoomId, meetAt, form.title.value, form.place.value));
        closeModal(); toast('약속을 제안했어요');
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }
  const TIMES = [...Array(36)].map((_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`); // 06:00~23:30
  const roundTime = (hm) => { const [hh, mm] = hm.split(':').map(Number); const t = `${String(hh).padStart(2, '0')}:${mm < 30 ? '00' : '30'}`; return TIMES.includes(t) ? t : '19:00'; };

  function openReview(a) {
    const other = state.chatRoom?.other?.nickname || '상대';
    let good = null;
    const tags = new Set();
    openModal(`
      <h2>${esc(other)}님과의 운동 어땠나요?</h2>
      <div class="stack">
        <div class="small muted" style="margin-top:-8px">후기는 상대 프로필에 작성자 이름 없이 보여요.</div>
        <div class="grid2" id="rvGood"><button type="button" class="btn" data-g="1">좋았어요</button><button type="button" class="btn" data-g="0">아쉬웠어요</button></div>
        <div class="chips" id="rvTags"></div>
        <label class="field" id="rvTextWrap" hidden><span>한 줄 후기 (선택)</span><input type="text" id="rvText" maxlength="200" placeholder="예) 스팟이 정확해서 믿고 칠 수 있었어요"></label>
        <button class="btn primary block" id="rvSubmit" disabled>후기 남기기</button>
        ${!a.otherCheckin ? '<button type="button" class="link small muted" id="rvNoshow" style="align-self:center">상대가 오지 않았어요 (노쇼 신고)</button>' : ''}
        <button class="btn block" type="button" data-close>나중에 하기</button>
      </div>`);
    const tagBox = document.getElementById('rvTags');
    document.getElementById('rvGood').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      good = b.dataset.g === '1'; tags.clear();
      document.querySelectorAll('#rvGood .btn').forEach((x) => x.classList.toggle('primary', x === b));
      tagBox.innerHTML = (good ? GOOD_TAGS : BAD_TAGS).map((t) => `<span class="chip" data-t="${esc(t)}">${esc(t)}</span>`).join('');
      document.getElementById('rvTextWrap').hidden = false;
      document.getElementById('rvSubmit').disabled = false;
    });
    tagBox.addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      tags.has(c.dataset.t) ? tags.delete(c.dataset.t) : tags.add(c.dataset.t);
      c.classList.toggle('on');
    });
    const submit = async (body, btn) => {
      btn.disabled = true;
      try { renderAppt(await Backend.reviewAppointment(a.id, body)); closeModal(); toast(body.noshow ? '노쇼 신고를 접수했어요' : '후기를 남겼어요'); }
      catch (err) { toast(err.message); btn.disabled = false; }
    };
    document.getElementById('rvSubmit').addEventListener('click', (e) => submit({ good, tags: [...tags], comment: document.getElementById('rvText').value }, e.target));
    document.getElementById('rvNoshow')?.addEventListener('click', (e) => {
      if (confirm(`${other}님이 약속 장소에 오지 않았나요?\n노쇼로 기록되면 상대 프로필의 노쇼 횟수가 올라가요.`)) submit({ noshow: true }, e.target);
    });
  }

  // ------------------------------------------------------------ views: 구인 글 쓰기
  function viewPostNew() {
    setChrome({ tab: 'home' });
    const me = state.me;
    const d = { lift: 'bench', kind: 'flash', days: [] };
    const dates = [...Array(14)].map((_, i) => kstDate(new Date(Date.now() + i * 864e5)));
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/">← 동네</a>
      <h1>구인 글 쓰기</h1>
      <form class="stack" id="postForm" novalidate>
        <div class="field"><span class="field-label">종목</span>
          <div class="chips" id="liftChips">${['bench', 'squat', 'deadlift', 'etc'].map((l) => `<span class="chip ${l === d.lift ? 'on' : ''}" data-v="${l}">${LIFT_FULL[l]}</span>`).join('')}</div></div>
        <div class="grid2" id="weightRow">
          <label class="field"><span>내 작업 중량</span><div class="suffix"><input type="number" inputmode="numeric" name="workKg" min="1" max="500" value="${me.bench ? Math.round(me.bench * 0.9) : ''}" placeholder="예) 100"><i>kg</i></div></label>
          <label class="field"><span>상대 1RM 조건</span><div class="suffix"><input type="number" inputmode="numeric" name="min1rm" min="0" max="500" placeholder="없으면 비워 두기"><i>kg 이상</i></div></label>
        </div>
        <div class="small muted" id="condHint"></div>
        <label class="row small" id="reqVRow"><input type="checkbox" name="requireVerified"> 영상 인증된 1RM만 받기 <span class="muted">(고중량일수록 권장)</span></label>
        <label class="field"><span>헬스장</span><input type="text" name="gymName" maxlength="50" value="${esc(me.gymName)}" placeholder="예) 바벨클럽 정자점" required></label>
        <div class="field"><span class="field-label">구인 유형</span>
          <div class="tabs" id="kindTabs"><button type="button" data-v="flash" class="on">번개 (이번 한 번)</button><button type="button" data-v="fixed">고정 메이트</button></div></div>
        <div class="grid2">
          <label class="field" id="dateField"><span>날짜</span><select name="date">${dates.map((x, i) => `<option value="${x}">${i === 0 ? '오늘' : i === 1 ? '내일' : `${Number(x.slice(5, 7))}월 ${Number(x.slice(8))}일`}(${kstDow(x)})</option>`).join('')}</select></label>
          <label class="field"><span>시간</span><select name="time">${TIMES.map((t) => `<option ${t === '19:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <div class="field" id="daysField" hidden><span class="field-label">요일 (여러 개 고를 수 있어요)</span>
          <div class="chips" id="dayPick">${state.config.days.map((x) => `<span class="chip" data-v="${x}">${x}</span>`).join('')}</div></div>
        <label class="row small"><input type="checkbox" name="sameGender" ${me.gender ? '' : 'disabled'}> 동성에게만 받기 ${me.gender ? '<span class="muted">(다른 성별에게는 이 글이 보이지 않아요)</span>' : '<span class="muted">(내 정보에서 성별을 입력하면 고를 수 있어요)</span>'}</label>
        <label class="field"><span>한마디 (선택)</span><textarea name="memo" maxlength="200" placeholder="예) 마지막 두 세트만 봐주시면 돼요"></textarea></label>
        <div class="small muted">열려 있는 구인 글은 3개까지 올릴 수 있어요. 번개 글은 약속 시간 1시간 뒤 자동으로 마감돼요.</div>
        <button class="btn primary block" type="submit">구인 글 올리기</button>
      </form>`));
    const form = document.getElementById('postForm');
    const hint = () => {
      const w = Number(form.workKg.value); const c = Number(form.min1rm.value);
      const rec = Math.round((w * 0.8) / 2.5) * 2.5;
      document.getElementById('condHint').textContent = d.lift === 'etc' || !w ? '' : c && c < rec
        ? `스팟을 맡기려면 작업 중량의 80%(${rec}kg) 이상을 권장해요.` : `권장 조건 ${rec}kg 이상 (작업 중량의 80%)`;
    };
    const sync = () => {
      const etc = d.lift === 'etc';
      document.getElementById('weightRow').hidden = etc;
      document.getElementById('reqVRow').hidden = etc;
      document.getElementById('dateField').hidden = d.kind !== 'flash';
      document.getElementById('daysField').hidden = d.kind !== 'fixed';
      if (!etc && !form.workKg.value && me[d.lift]) form.workKg.value = Math.round(me[d.lift] * 0.9);
      hint();
    };
    document.getElementById('liftChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (d.lift !== c.dataset.v && me[c.dataset.v]) form.workKg.value = Math.round(me[c.dataset.v] * 0.9);
      d.lift = c.dataset.v;
      document.querySelectorAll('#liftChips .chip').forEach((x) => x.classList.toggle('on', x === c));
      sync();
    });
    document.getElementById('kindTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      d.kind = b.dataset.v;
      document.querySelectorAll('#kindTabs button').forEach((x) => x.classList.toggle('on', x === b));
      sync();
    });
    document.getElementById('dayPick').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); });
    form.workKg.addEventListener('input', hint);
    form.min1rm.addEventListener('input', hint);
    sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await Backend.createPost({
          lift: d.lift, kind: d.kind, workKg: form.workKg.value, min1rm: form.min1rm.value, requireVerified: form.requireVerified.checked,
          date: form.date.value, time: form.time.value, days: [...document.querySelectorAll('#dayPick .chip.on')].map((x) => x.dataset.v),
          gymName: form.gymName.value, sameGender: form.sameGender.checked, memo: form.memo.value,
        });
        toast('구인 글을 올렸어요. 요청이 오면 쪽지함으로 알려드릴게요');
        sessionStorageSet('homeTab', 'posts');
        location.hash = '#/';
      } catch (err) {
        if (!handleCodeError(err)) toast(err.message);
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------ views: 내 구인 글 · 받은 요청
  async function viewMyPosts() {
    setChrome({ tab: 'me' });
    const posts = await Backend.myPosts();
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/me">← 내 정보</a>
      <div class="row"><h1 style="flex:1">내 구인 글</h1><a class="btn sm" href="#/posts/new">${ic('plus', 16)}새 글</a></div>
      ${posts.length ? posts.map((p) => {
        const pending = p.requests.filter((r) => r.status === 'pending');
        const done = p.requests.filter((r) => r.status !== 'pending');
        return `
        <section class="card stack my-post" data-id="${p.id}">
          <div class="row"><b style="flex:1">${esc(postTitle(p))}</b><span class="status ${p.status === 'open' ? 'pending' : 'declined'}">${p.status === 'open' ? '모집중' : '마감'}</span></div>
          <div class="small muted">${esc([postWhen(p), p.gymName, condText(p), p.kind === 'fixed' ? '고정' : '번개', p.sameGender ? '동성만' : ''].filter(Boolean).join(' · '))}</div>
          ${pending.length ? pending.map((r) => `
            <div class="req-item" data-note="${r.noteId}">
              <div class="row">${avatar(r.other.photo)}<div style="flex:1;min-width:0"><b class="profile-link" data-uid="${r.other.id}" style="cursor:pointer">${esc(r.other.nickname)}</b>
                <div class="small muted">${p.lift !== 'etc' ? `${LIFT[p.lift]} ${r.liftKg ?? '-'}kg ${r.liftVerifiedKg != null && r.liftVerifiedKg >= (r.liftKg ?? 0) ? '영상 인증' : '자기 신고'} · ` : ''}노쇼 ${r.trust.noshow}회</div></div></div>
              <div class="note-body">${esc(r.content)}</div>
              <div class="row"><button class="btn sm" data-act="decline">거절</button><span class="spacer"></span><button class="btn sm primary" data-act="accept">수락하고 채팅</button></div>
            </div>`).join('') : '<div class="small muted">아직 받은 요청이 없어요.</div>'}
          ${done.length ? `<div class="small muted">처리한 요청: ${done.map((r) => `${esc(r.other.nickname)}(${r.status === 'accepted' ? '수락' : '거절'})`).join(', ')}</div>` : ''}
          <div class="row"><button class="btn sm" data-post="${p.status === 'open' ? 'close' : 'open'}">${p.status === 'open' ? '모집 마감하기' : '다시 모집하기'}</button>
            <span class="spacer"></span><button class="btn sm danger" data-post="delete">글 삭제</button></div>
        </section>`;
      }).join('') : `<div class="empty"><span class="big">${ic('calendar', 32)}</span>아직 올린 구인 글이 없어요.<div style="margin-top:16px"><a class="btn sm" href="#/posts/new">구인 글 쓰기</a></div></div>`}`));
    $app.querySelectorAll('.profile-link').forEach((el) => el.addEventListener('click', () => showProfile(el.dataset.uid).catch((e) => toast(e.message))));
    $app.querySelectorAll('.req-item [data-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = Number(b.closest('[data-note]').dataset.note);
      b.disabled = true;
      try {
        if (b.dataset.act === 'accept') { location.hash = `#/chat/${await Backend.acceptNote(id)}`; return; }
        if (!confirm('이 요청을 거절할까요?\n상대에게는 \'마감됨\'으로 보여요.')) { b.disabled = false; return; }
        await Backend.declineNote(id); toast('거절했어요'); viewMyPosts();
      } catch (e) { toast(e.message); b.disabled = false; }
    }));
    $app.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', async () => {
      const id = Number(b.closest('[data-id]').dataset.id);
      try {
        if (b.dataset.post === 'delete') {
          if (!confirm('이 글을 삭제할까요?\n답을 기다리는 요청은 \'마감됨\'으로 바뀌어요.')) return;
          await Backend.deletePost(id); toast('글을 삭제했어요');
        } else {
          await Backend.setPostStatus(id, b.dataset.post === 'close' ? 'closed' : 'open');
          toast(b.dataset.post === 'close' ? '모집을 마감했어요' : '다시 모집해요');
        }
        viewMyPosts();
      } catch (e) { toast(e.message); }
    }));
  }

  // ------------------------------------------------------------ views: 오늘 운동 인증
  async function viewWorkout() {
    setChrome({ tab: 'workout' });
    const [w, me0] = await Promise.all([Backend.myWorkout(), Backend.me()]);
    state.me = me0;
    const tab = sessionStorageGet('recTab') || 'bench';
    const PARTS = ['가슴', '등', '하체', '어깨·팔', '전신'];
    const editing = !w.today || sessionStorageGet('workoutEdit') === '1';
    const weekCount = w.week.filter(Boolean).length;
    const bar = (n) => `<div class="progress"><i style="width:${Math.min(100, (n / w.goal) * 100)}%"></i></div>`;
    const b = w.best[tab];
    const est = b.thisMonth ? epley(b.thisMonth.w, b.thisMonth.r) : null;
    const mine = state.me[tab];
    $app.innerHTML = '';
    $app.append(h(`
      <div class="row"><h1 style="flex:1">오늘 인증</h1><span class="small"><b>${w.streak}일</b> 연속 출석</span></div>
      ${w.today && !editing ? `
        <section class="card stack">
          <div class="workout-photo"><img id="todayPhoto" alt="오늘 올린 운동 사진"></div>
          <div class="row"><span style="flex:1"><b>${esc(w.today.part)}</b>${w.today.lift ? ` · ${LIFT[w.today.lift]} ${Number(w.today.weightKg)}kg × ${w.today.reps}` : ''}</span>
            <button class="btn sm" id="editToday">다시 올리기</button></div>
          <div class="small muted">오늘 인증을 마쳤어요. 채팅 중인 메이트에게 이번 주 인증 횟수가 보여요.</div>
        </section>` : `
        <form class="card stack" id="workoutForm" novalidate>
          <label class="drop" id="dropZone">${ic('camera', 24)}<b>운동 사진 올리기</b><span class="small muted">헬스장에서 찍은 사진 한 장 (5MB 이하)</span>
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
          <div class="field"><span class="field-label">오늘 한 부위</span>
            <div class="chips" id="partChips">${PARTS.map((p, i) => `<span class="chip ${(w.today?.part || '가슴') === p ? 'on' : ''}" data-v="${p}">${p}</span>`).join('')}</div></div>
          <div class="field"><span class="field-label">오늘의 최고 세트 (선택)</span>
            <div class="grid3">
              <select name="lift"><option value="">종목</option>${LIFTS3.map((l) => `<option value="${l}">${LIFT[l]}</option>`).join('')}</select>
              <div class="suffix"><input type="number" inputmode="decimal" step="0.5" name="weightKg" placeholder="중량"><i>kg</i></div>
              <div class="suffix"><input type="number" inputmode="numeric" name="reps" placeholder="횟수"><i>회</i></div>
            </div>
            <div class="small muted" id="estOut" style="margin-top:8px">중량과 횟수를 넣으면 추정 1RM을 계산해요.</div></div>
          <button class="btn primary block" type="submit">오늘 인증 올리기</button>
          ${w.today ? '<button class="btn block" type="button" id="cancelEdit">취소</button>' : ''}
        </form>`}

      <section class="card stack">
        <div class="row"><h2 style="flex:1">이번 주</h2><span class="small muted">목표 주 ${w.goal}회</span></div>
        <div class="week-dots">${['월', '화', '수', '목', '금', '토', '일'].map((d, i) => `<div><span>${d}</span><i class="${w.week[i] ? 'on' : ''} ${i === w.todayIndex && !w.week[i] ? 'today' : ''}">${w.week[i] ? ic('check', 14) : ''}</i></div>`).join('')}</div>
        <div class="row small"><span style="flex:1">나</span><b>${weekCount} / ${w.goal}회</b></div>${bar(weekCount)}
        ${w.mates.map((m) => `
          <div class="row small mate-line"><span style="flex:1" class="ellipsis">${esc(m.nickname)}</span><b>${m.weekCount} / ${w.goal}회</b>
            <button class="btn sm" data-cheer="${m.roomId}" ${m.cheeredToday ? 'disabled' : ''}>${m.cheeredToday ? '응원함' : '응원하기'}</button></div>${bar(m.weekCount)}`).join('')}
        ${w.mates.length ? '' : '<div class="small muted">채팅 중인 메이트가 생기면 서로의 이번 주 인증 횟수가 보여요.</div>'}
      </section>

      <section class="card stack">
        <div class="row"><h2 style="flex:1">최고 기록</h2><div class="chips" id="recTabs">${LIFTS3.map((l) => `<span class="chip ${l === tab ? 'on' : ''}" data-v="${l}">${LIFT[l]}</span>`).join('')}</div></div>
        <dl class="kv rec">
          <dt>이번 달</dt><dd>${b.thisMonth ? `${Number(b.thisMonth.w)}kg × ${b.thisMonth.r}` : '-'}</dd>
          <dt>지난달</dt><dd>${b.lastMonth ? `${Number(b.lastMonth.w)}kg × ${b.lastMonth.r}` : '-'}</dd>
          <dt>추정 1RM</dt><dd>${est != null ? `${est}kg` : '-'}</dd>
          <dt>등록된 1RM</dt><dd>${mine != null ? `${mine}kg · ${liftStatus(state.me, tab)}` : '-'}</dd>
        </dl>
        ${est != null && est > (mine ?? 0) ? `<a class="banner" href="#/lifts/${tab}">${ic('video', 16)}<span>추정 1RM이 등록된 기록보다 높아요. 영상 인증으로 갱신해 보세요.</span></a>` : ''}
      </section>
      <div class="card menu-list"><a href="#/lifts">1RM 영상 인증 <span class="small muted" style="margin-left:auto;margin-right:8px">${LIFTS3.filter((l) => state.me.verified?.[l] != null).length}/3 완료</span></a></div>`));

    if (w.today && !editing) {
      Backend.workoutPhotoUrl(w.today.image).then((url) => { const img = document.getElementById('todayPhoto'); if (img) img.src = url; }).catch(() => {});
      document.getElementById('editToday').addEventListener('click', () => { sessionStorageSet('workoutEdit', '1'); viewWorkout().catch((e) => toast(e.message)); });
    }
    document.getElementById('cancelEdit')?.addEventListener('click', () => { sessionStorageSet('workoutEdit', ''); viewWorkout().catch((e) => toast(e.message)); });
    document.getElementById('recTabs').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      sessionStorageSet('recTab', c.dataset.v); viewWorkout().catch((err) => toast(err.message));
    });
    $app.querySelectorAll('[data-cheer]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await Backend.sendCheer(Number(btn.dataset.cheer)); btn.textContent = '응원함'; toast('응원을 보냈어요. 채팅방에 표시돼요'); }
      catch (e) { toast(e.message); btn.disabled = false; }
    }));
    const form = document.getElementById('workoutForm');
    if (!form) return;
    form.photo.addEventListener('change', () => {
      const f = form.photo.files[0]; if (!f) return;
      const zone = document.getElementById('dropZone');
      zone.classList.add('has-photo');
      zone.querySelector('b').textContent = '사진 바꾸기';
      zone.querySelector('.workout-preview')?.remove();
      zone.prepend(h(`<img class="workout-preview" alt="올릴 운동 사진" src="${URL.createObjectURL(f)}">`));
    });
    document.getElementById('partChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      document.querySelectorAll('#partChips .chip').forEach((x) => x.classList.toggle('on', x === c));
    });
    const showEst = () => {
      const kg = Number(form.weightKg.value); const r = Number(form.reps.value); const l = form.lift.value;
      document.getElementById('estOut').textContent = !kg || !r ? '중량과 횟수를 넣으면 추정 1RM을 계산해요.'
        : r > 12 ? '12회 이하 세트로 넣어야 추정치가 정확해요.'
        : `추정 1RM ${epley(kg, r)}kg${l && state.me[l] != null ? ` · 등록된 ${LIFT[l]} ${state.me[l]}kg` : ''}`;
    };
    ['input', 'change'].forEach((ev) => form.addEventListener(ev, (e) => { if (['weightKg', 'reps', 'lift'].includes(e.target.name)) showEst(); }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.photo.files[0];
      if (!f) return toast('운동 사진을 올려 주세요.');
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = '올리는 중...';
      try {
        const path = await Backend.uploadWorkoutPhoto(state.me.id, f);
        await Backend.logWorkout({ part: document.querySelector('#partChips .chip.on').dataset.v, lift: form.lift.value,
          weightKg: form.weightKg.value, reps: form.reps.value, photo: path });
        sessionStorageSet('workoutEdit', '');
        toast('오늘 인증을 올렸어요');
        viewWorkout().catch((err) => toast(err.message));
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '오늘 인증 올리기'; }
    });
  }

  // ------------------------------------------------------------ views: 1RM 영상 인증
  let codeTimer;
  async function viewLifts(lift) {
    setChrome({ tab: 'workout' });
    clearInterval(codeTimer);
    const [list, me0] = await Promise.all([Backend.myLifts(), Backend.me()]);
    state.me = me0;
    const me = state.me;
    const sel = lift || sessionStorageGet('liftSel') || 'deadlift';
    sessionStorageSet('liftSel', sel);
    const v = list[sel];
    const tileState = (l) => {
      const x = list[l];
      if (x?.status === 'pending') return ['검토 중', `${x.weightKg}`];
      if (me.verified?.[l] != null) return ['인증 완료', `${me.verified[l]}`];
      return ['미인증', `${me[l] ?? '-'}`];
    };
    const codeValid = v?.status === 'code' && new Date(v.codeExpiresAt) > new Date();
    const CRITERIA = {
      bench: '바가 가슴에 닿은 뒤 튕기지 않고 팔을 끝까지 펴요. 엉덩이가 벤치에서 떨어지면 안 돼요.',
      squat: '고관절이 무릎 윗면보다 낮게 내려간 뒤 완전히 일어서요. 측면 영상이 필요해요.',
      deadlift: '무릎과 고관절을 완전히 펴서 락아웃해요. 바닥에서 튕겨 올리는 반복은 인정하지 않아요.',
    };
    let body;
    if (v?.status === 'pending') {
      body = `<div class="banner">${LIFT_FULL[sel]} ${v.weightKg}kg 영상을 검토하고 있어요. 결과가 나오면 이 화면과 프로필에 반영돼요.</div>`;
    } else {
      body = `
        ${v?.status === 'rejected' ? `<div class="banner">${ic('circle-alert', 16)}<span>지난 신청이 반려됐어요: ${esc(v.rejectReason || '')}</span></div>` : ''}
        ${me.verified?.[sel] != null ? `<div class="small muted">${LIFT_FULL[sel]} ${me.verified[sel]}kg 인증 완료. 더 무거운 기록으로 다시 신청할 수 있어요.</div>` : ''}
        ${codeValid ? `
          <div class="code-box"><div class="small"><b>영상 속에 이 코드를 보여 주세요</b><br><span class="muted">종이에 적거나 휴대폰 화면으로</span><br><span class="muted" id="codeLeft"></span></div>
            <div class="code">${esc(v.code)}</div></div>
          <form class="stack" id="liftForm" novalidate>
            <label class="field"><span>${LIFT_FULL[sel]} 중량</span><div class="suffix"><input type="number" inputmode="numeric" name="weight" min="20" max="500" value="${Math.max(me[sel] ?? 0, me.verified?.[sel] ?? 0) || ''}"><i>kg</i></div></label>
            <div class="field"><span class="field-label">촬영 가이드</span>
              <ol class="guide small"><li>원판을 끼우는 장면부터 찍어 중량이 보이게</li><li>인증 코드가 화면 안에 보이게</li><li>편집 없이 한 번에, 측면에서 전신이 나오게</li><li>${esc(CRITERIA[sel])}</li></ol>
              <div class="small muted">스트랩·벨트는 괜찮아요. 슈트·스미스 머신은 인정하지 않아요.</div></div>
            <label class="drop">${ic('video', 24)}<b id="videoName">영상 촬영 또는 업로드</b><span class="small muted">MP4 · MOV · WEBM, 50MB 이하, 1분 이내 권장</span>
              <input type="file" name="video" accept="video/mp4,video/quicktime,video/webm" hidden></label>
            <button class="btn primary block" type="submit">인증 신청하기</button>
            <button class="link small muted" type="button" id="newCode" style="align-self:center">코드 새로 받기</button>
          </form>` : `
          <div class="small muted">인증 코드를 받은 뒤 24시간 안에 코드가 보이도록 영상을 찍어 올려 주세요. 운영팀이 확인하면 프로필에 '영상 인증'이 표시돼요.</div>
          <button class="btn primary block" id="issueCode">${LIFT_FULL[sel]} 인증 코드 받기</button>`}`;
    }
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/workout">← 오늘 인증</a>
      <h1>1RM 영상 인증</h1>
      <div class="lift-tiles">${LIFTS3.map((l) => { const [st, kg] = tileState(l); return `<button type="button" class="${l === sel ? 'on' : ''}" data-l="${l}"><span>${LIFT[l]}</span><b>${kg}<small>kg</small></b><span>${st}</span></button>`; }).join('')}</div>
      <div class="stack" style="margin-top:16px">${body}</div>`));
    $app.querySelectorAll('.lift-tiles button').forEach((b) => b.addEventListener('click', () => { location.hash = `#/lifts/${b.dataset.l}`; }));
    const issue = async (btn) => {
      btn.disabled = true;
      try { await Backend.issueLiftCode(sel); toast('인증 코드를 받았어요. 24시간 안에 영상을 올려 주세요'); viewLifts(sel); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
    document.getElementById('issueCode')?.addEventListener('click', (e) => issue(e.target));
    document.getElementById('newCode')?.addEventListener('click', (e) => { if (confirm('새 코드를 받으면 지금 코드로 찍은 영상은 쓸 수 없어요. 새로 받을까요?')) issue(e.target); });
    if (codeValid) {
      const tick = () => {
        const el = document.getElementById('codeLeft'); if (!el) { clearInterval(codeTimer); return; }
        const left = new Date(v.codeExpiresAt) - Date.now();
        if (left <= 0) { clearInterval(codeTimer); viewLifts(sel); return; }
        el.textContent = `${Math.floor(left / 3600e3)}시간 ${Math.floor((left % 3600e3) / 60e3)}분 남음`;
      };
      tick(); codeTimer = setInterval(tick, 30000);
      const form = document.getElementById('liftForm');
      form.video.addEventListener('change', () => { const f = form.video.files[0]; if (f) document.getElementById('videoName').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)}MB`; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.video.files[0];
        if (!f) return toast('인증 영상을 골라 주세요.');
        const kg = Number(form.weight.value);
        if (!(kg >= 20 && kg <= 500)) return toast('중량을 20~500kg 사이로 입력해 주세요.');
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = '영상 올리는 중...';
        try {
          const path = await Backend.uploadLiftVideo(me.id, f);
          await Backend.submitLiftVideo(v.id, kg, path);
          toast('인증을 신청했어요. 검토가 끝나면 프로필에 반영돼요');
          viewLifts(sel);
        } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '인증 신청하기'; }
      });
    }
  }

  // ------------------------------------------------------------ views: 내 정보 / 프로필 편집
  async function viewMe() {
    state.me = await Backend.me();
    setChrome({ tab: 'me' });
    const me = state.me; const c = state.config; const p = me.prefs;
    const opt = (list, cur, labels = {}, none = '선택 안 함') => `<option value="">${none}</option>` + list.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(labels[v] || v)}</option>`).join('');
    const num = (name, val, min, max, ph = '') => `<input type="number" inputmode="numeric" name="${name}" value="${val ?? ''}" min="${min}" max="${max}" step="1" placeholder="${ph}">`;
    const chips = (id, list, on) => `<div class="chips" id="${id}">${list.map((v) => `<span class="chip ${on.includes(v) ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</span>`).join('')}</div>`;
    $app.innerHTML = '';
    $app.append(h(`
      <h1>내 정보</h1>
      <div class="card stack" style="margin-bottom:14px">
        <div class="row"><div style="flex:1">
          <div class="small muted">인증된 동네</div>
          <div><b>${me.location ? esc(me.location.region) : '미인증'}</b> ${me.location && !me.location.verified ? '<span class="small" style="color:var(--danger)">(만료)</span>' : ''}</div>
        </div><a class="btn sm" href="#/verify">${me.location ? '재인증' : '인증하기'}</a></div>
      </div>
      <div class="card stack" style="margin-bottom:14px">
        <div class="small muted">신뢰 지표 · 다른 회원에게 보여요</div>
        <div class="trust-stats">
          <div><b>${me.trust?.together ?? 0}</b><span>함께한 운동</span></div><div><b>${me.trust?.noshow ?? 0}</b><span>노쇼</span></div>
          <div><b>${me.trust?.lateCancel ?? 0}</b><span>늦은 취소</span></div><div><b>${me.trust?.reviewCount ?? 0}</b><span>받은 후기</span></div>
        </div>
        <div class="small muted">늦은 취소는 확정된 약속을 2시간 이내에 취소한 횟수예요.</div>
      </div>
      <div class="card menu-list" style="margin-bottom:14px">
        <a href="#/posts/mine">내 구인 글 · 받은 요청</a>
        <a href="#/lifts">1RM 영상 인증 <span class="small muted" style="margin-left:auto;margin-right:8px">${LIFTS3.filter((l) => me.verified?.[l] != null).length}/3 완료</span></a>
      </div>
      <form class="stack" id="profileForm" novalidate>
        <section class="card stack">
          <h2>기본 정보</h2>
          <div class="photo-pick">
            <span id="photoPreview">${avatar(me.photo, 'lg')}</span>
            <div class="stack" style="flex:1">
              <label class="btn sm" style="width:fit-content">${ic('plus', 16)} 사진 선택<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
              ${me.photo ? '<label class="small muted"><input type="checkbox" name="removePhoto" value="true"> 사진 삭제</label>' : ''}
            </div>
          </div>
          <label class="field"><span>닉네임</span><input type="text" name="nickname" value="${esc(me.nickname)}" minlength="2" maxlength="20" required></label>
          <div class="grid3">
            <label class="field"><span>성별</span><select name="gender">${opt(['male', 'female'], me.gender, genderLabel)}</select></label>
            <label class="field"><span>나이</span>${num('age', me.age, c.ageMin, c.ageMax, '예) 28')}</label>
            <label class="field"><span>헬스 구력</span><select name="career">${opt(c.careers, me.career)}</select></label>
          </div>
        </section>

        <section class="card stack">
          <h2>3대 운동 1RM <span class="small muted" style="font-weight:400">(kg)</span></h2>
          <div class="grid3">
            <label class="field"><span>벤치프레스</span><div class="suffix">${num('bench', me.bench, 0, c.max1rm, '0')}<i>kg</i></div></label>
            <label class="field"><span>스쿼트</span><div class="suffix">${num('squat', me.squat, 0, c.max1rm, '0')}<i>kg</i></div></label>
            <label class="field"><span>데드리프트</span><div class="suffix">${num('deadlift', me.deadlift, 0, c.max1rm, '0')}<i>kg</i></div></label>
          </div>
          <div class="total-line">3대 합계 <b id="totalOut">-</b></div>
          <div class="small muted">${LIFTS3.some((l) => me.verified?.[l] != null)
            ? `영상 인증: ${LIFTS3.filter((l) => me.verified?.[l] != null).map((l) => `${LIFT[l]} ${me.verified[l]}kg`).join(' · ')}. 인증값보다 높게 고치면 그 종목은 '자기 신고'로 보여요.`
            : '직접 입력한 기록은 \'자기 신고\'로 보여요. <a class="link" href="#/lifts">영상 인증</a>을 받으면 \'영상 인증\'이 붙어요.'}</div>
        </section>

        <section class="card stack">
          <h2>헬스장 · 운동 일정</h2>
          <label class="field"><span>다니는 헬스장</span><input type="text" name="gymName" value="${esc(me.gymName)}" maxlength="50" placeholder="예) 역삼 OO피트니스"></label>
          <div class="field"><span class="field-label">자주 가는 요일</span>${chips('dayChips', c.days, me.workoutDays)}</div>
          <div class="field"><span class="field-label">자주 가는 시간대</span>${chips('timeChips', c.times, me.workoutTimes)}</div>
          <label class="field"><span>자기소개</span><textarea name="bio" maxlength="500" placeholder="예) 주 4회 분할 루틴 하고 있어요. 하체날 서로 스팟 봐주실 분 구합니다!">${esc(me.bio)}</textarea></label>
        </section>

        <section class="card stack">
          <h2>원하는 헬스메이트 조건</h2>
          <div class="grid3">
            <label class="field"><span>성별</span><select name="prefGender">${opt(['male', 'female'], p.gender, genderLabel, '무관')}</select></label>
            <label class="field"><span>나이 (최소)</span>${num('prefAgeMin', p.ageMin, c.ageMin, c.ageMax, '무관')}</label>
            <label class="field"><span>나이 (최대)</span>${num('prefAgeMax', p.ageMax, c.ageMin, c.ageMax, '무관')}</label>
          </div>
          <label class="field"><span>3대 합계 최소</span><div class="suffix">${num('prefMinTotal', p.minTotal, 0, c.max1rm * 3, '무관 (예: 300)')}<i>kg 이상</i></div></label>
          <label class="field"><span>그 밖의 조건</span><input type="text" name="prefNote" value="${esc(p.note)}" maxlength="200" placeholder="예) 주 3회 이상 꾸준히 나오실 분, 스팟 가능하신 분"></label>
          <div class="small muted">설정한 조건에 맞는 사람에게는 목록에서 '내 조건에 맞음' 표시가 붙어요.</div>
        </section>

        <label class="row small card"><input type="checkbox" name="isPublic" ${me.isPublic ? 'checked' : ''}> 짐짝 동네 목록에 내 프로필 공개</label>
        <button class="btn primary block" type="submit">저장하기</button>
      </form>
      <div class="card menu-list" style="margin-top:14px">
        <div class="small muted menu-caption">${esc({ kakao: '카카오 계정으로 로그인됨', google: 'Google 계정으로 로그인됨' }[me.provider] || me.email || '')}</div>
        ${me.isAdmin ? '<a href="#/admin">신고 · 영상 인증 관리 (관리자)<b class="badge inline" id="badgeReports"></b></a>' : ''}
        <a href="#/blocks">차단 목록</a>
        ${me.provider === 'email' ? '<button type="button" id="pwBtn">비밀번호 변경</button>' : ''}
        <button type="button" data-export>내 정보 내려받기</button>
        <a href="#/policy/terms">이용약관</a>
        <a href="#/policy/privacy">개인정보처리방침</a>
        <a href="#/policy/location">위치기반서비스 이용약관</a>
        ${state.config.service.contactEmail ? `<a href="mailto:${esc(state.config.service.contactEmail)}">문의하기</a>` : ''}
        <button type="button" id="logoutBtn">로그아웃</button>
        <button type="button" id="deleteBtn" class="danger-text">회원 탈퇴</button>
      </div>`));

    const form = document.getElementById('profileForm');
    ['dayChips', 'timeChips'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => { const ch = e.target.closest('.chip'); if (ch) ch.classList.toggle('on'); }));
    const updateTotal = () => {
      const v = ['bench', 'squat', 'deadlift'].map((n) => form[n].value);
      document.getElementById('totalOut').textContent = v.every((x) => x !== '') ? `${v.reduce((s, x) => s + Number(x), 0)}kg` : '-';
    };
    ['bench', 'squat', 'deadlift'].forEach((n) => form[n].addEventListener('input', updateTotal));
    updateTotal();
    form.photo.addEventListener('change', () => {
      const f = form.photo.files[0];
      if (f) document.getElementById('photoPreview').innerHTML = avatar(URL.createObjectURL(f), 'lg');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const picked = (id) => [...document.querySelectorAll(`#${id} .chip.on`)].map((x) => x.dataset.v);
      const v = (name) => form[name].value;
      const p = {
        nickname: v('nickname'), gender: v('gender'), age: v('age'), career: v('career'),
        bench: v('bench'), squat: v('squat'), deadlift: v('deadlift'), gymName: v('gymName'),
        workoutDays: picked('dayChips'), workoutTimes: picked('timeChips'), bio: v('bio'),
        prefGender: v('prefGender'), prefAgeMin: v('prefAgeMin'), prefAgeMax: v('prefAgeMax'),
        prefMinTotal: v('prefMinTotal'), prefNote: v('prefNote'), isPublic: form.isPublic.checked,
      };
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      const oldPhoto = me.photoPath;
      let newPhoto = null;
      try {
        if (form.photo.files.length) p.photo = newPhoto = await Backend.uploadPhoto(me.id, form.photo.files[0]);
        else if (form.removePhoto?.checked) p.photo = null;
        await Backend.updateProfile(p);
        if ('photo' in p && oldPhoto) Backend.removePhoto(oldPhoto); // 바뀐 사진의 이전 파일 삭제
        await loadMe();
        toast('프로필이 저장되었어요');
        location.hash = '#/';
      } catch (err) {
        if (newPhoto) Backend.removePhoto(newPhoto);
        if (!handleCodeError(err)) toast(err.message);
        btn.disabled = false;
      }
    });
    bindExport($app);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('deleteBtn').addEventListener('click', openDeleteAccount);
    document.getElementById('pwBtn')?.addEventListener('click', openChangePassword);
    if (me.isAdmin) Backend.badges().then((b) => { document.getElementById('badgeReports').textContent = (b.reports || 0) + (b.lifts || 0) || ''; }).catch(() => {});
  }

  function openChangePassword() {
    openModal(`
      <h2>비밀번호 변경</h2>
      <form id="pwForm" class="stack">
        <label class="field"><span>현재 비밀번호</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>새 비밀번호 (8자 이상)</span><input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary block" type="submit">변경하기</button>
        <button class="btn block" type="button" data-close>취소</button>
      </form>`);
    const form = document.getElementById('pwForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Backend.changePassword(state.me.email, form.current.value, form.next.value);
        closeModal(); toast('비밀번호를 변경했어요');
      } catch (err) { toast(err.message); }
    });
  }

  function openDeleteAccount() {
    const email = state.me.provider === 'email';
    openModal(`
      <h2>회원 탈퇴</h2>
      <div class="stack">
        <div class="banner small" style="display:block">탈퇴하면 프로필, 사진, 동네 인증, 쪽지, 채팅 내용이 <b>즉시 삭제되고 복구할 수 없어요.</b>
          상대방 채팅방에서도 대화가 사라져요.${state.me.suspended ? '<br>이용 정지 상태에서 탈퇴하면 같은 이메일로 다시 가입할 수 없어요.' : ''}</div>
        <button type="button" class="link small" data-export style="text-align:left">탈퇴 전에 내 정보 내려받기</button>
        <form id="delForm" class="stack">
          ${email ? '<label class="field"><span>비밀번호 확인</span><input type="password" name="password" required autocomplete="current-password"></label>'
            : "<label class=\"field\"><span>확인을 위해 '탈퇴'를 입력해 주세요</span><input type=\"text\" name=\"confirm\" required></label>"}
          <button class="btn block danger" type="submit">탈퇴하기</button>
          <button class="btn block" type="button" data-close>취소</button>
        </form>
      </div>`);
    bindExport($modalBody);
    const form = document.getElementById('delForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        disconnectLive();
        await Backend.deleteAccount(state.me, email ? { password: form.password.value } : { confirm: form.confirm.value });
        state.me = null;
        closeModal(); toast('탈퇴가 완료되었어요. 그동안 짐짝을 이용해 주셔서 감사해요.');
        location.hash = '#/login';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------ boot
  // 서버 연결 실패 시 화면. 개발자용 설명(Supabase, SQL 등)은 사용자에게 보이지 않게 콘솔에만 남긴다.
  function showSetupError(err) {
    console.error('[짐짝] 서버 연결 실패', err);
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card card stack" role="alert">
        <h2>잠시 연결이 원활하지 않아요</h2>
        <div class="small muted">인터넷 연결을 확인한 뒤 다시 시도해 주세요. 문제가 계속되면 잠시 후 다시 접속해 주세요.</div>
        <button class="btn primary block" type="button" id="retryBtn">다시 시도</button>
      </div></div>`));
    document.getElementById('retryBtn').addEventListener('click', () => location.reload());
  }

  (async () => {
    const C = window.GYMJJAK_CONFIG;
    let settings;
    try {
      if (typeof Backend === 'undefined') throw new Error('Backend not loaded');
      settings = await Backend.settings();
    } catch (e) { showSetupError(e); return; }
    state.config = {
      days: ['월', '화', '수', '목', '금', '토', '일'],
      times: ['새벽', '오전', '점심', '오후', '저녁', '밤'],
      careers: ['6개월 미만', '6개월~1년', '1~2년', '2~3년', '3~5년', '5년 이상'],
      ageMin: 14, ageMax: 99, max1rm: 500,
      allowManualLocation: settings.allowManualLocation,
      verifyValidDays: settings.verifyValidDays,
      kakaoJsKey: C.kakaoJsKey || '',
      loginProviders: C.authProviders || [],
      emailLogin: C.emailLogin !== false,
      reportReasons: ['부적절한 사진·프로필', '욕설·비하·혐오 표현', '성희롱·불쾌한 연락', '스팸·광고·영업', '사기·금전 요구', '미성년자 의심', '기타'],
      service: { ...C.service, termsVersion: settings.termsVersion, geocoder: C.kakaoJsKey ? 'kakao' : 'osm',
                 locationLogKeepDays: 183, reportKeepDays: 365, verifyValidDays: settings.verifyValidDays },
    };

    // 이메일 인증 링크 / 소셜 로그인에서 돌아온 경우 (?code=... 또는 ?error_description=...)
    const q = new URLSearchParams(location.search);
    if (q.has('code') || q.has('error') || q.has('error_description')) {
      const session = await Backend.session();
      if (q.has('error_description')) setTimeout(() => toast(q.get('error_description')), 300);
      else if (!session) setTimeout(() => toast('이메일 인증이 완료되었어요. 로그인해 주세요.'), 300);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    Backend.onAuthChange((event) => {
      if (event === 'SIGNED_OUT' && state.me) { disconnectLive(); state.me = null; location.hash = '#/login'; }
    });
    route();
  })();
})();
