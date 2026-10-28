/* 짐짝(GYMJJAK) – SPA (vanilla JS) */
(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $modalBody = document.getElementById('modalBody');
  const state = { me: null, config: null, live: false, poller: null, nearby: null, filter: { radius: 3, gender: null, minTotal: null, days: [], matchOnly: false }, chatRoomId: null };

  // ------------------------------------------------------------ utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Lucide 선형 아이콘 (ISC 라이선스). 이모지 대신 이것만 쓴다 — 디자인 시스템 5장
  const ICONS = {"map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /> <circle cx=\"12\" cy=\"10\" r=\"3\" />", "mail": "<rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\" /> <path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\" />", "message-circle": "<path d=\"M7.9 20A9 9 0 1 0 4 16.1L2 22Z\" />", "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /> <circle cx=\"12\" cy=\"7\" r=\"4\" />", "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />", "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /> <path d=\"m9 12 2 2 4-4\" />", "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" /> <path d=\"m21 21-4.3-4.3\" />", "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />", "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />", "bell": "<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\" /> <path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" />"};
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
        if (state.chatRoomId === msg.roomId) { appendMessage(msg); if (msg.senderId !== state.me.id) Backend.markRead(msg.roomId); }
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
        data.messages.forEach((m) => { if (!renderedIds.has(m.id)) appendMessage(m); });
        if (data.messages.some((m) => m.senderId === state.me.id) && data.messages.filter((m) => m.senderId === state.me.id).every((m) => m.readAt)) markAllRead();
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
    $app.innerHTML = '';
    $app.append(h(`
      <div class="home">
        <div class="home-controls stack">
          ${!state.me.profileComplete ? '<a href="#/me" class="banner">성별·나이·구력·운동 요일을 채우면 메이트들이 나를 알아볼 수 있어요. <b class="link">작성하기</b></a>' : ''}
          <div class="row">
            <select id="radiusSel" class="sm-select">
              ${[1, 3, 5, 10].map((r) => `<option value="${r}" ${r === f.radius ? 'selected' : ''}>반경 ${r}km</option>`).join('')}
            </select>
            <select id="genderSel" class="sm-select">
              <option value="">성별 전체</option>
              <option value="male" ${f.gender === 'male' ? 'selected' : ''}>남성</option>
              <option value="female" ${f.gender === 'female' ? 'selected' : ''}>여성</option>
            </select>
            <select id="totalSel" class="sm-select">
              <option value="">3대 전체</option>
              ${[200, 300, 400, 500, 600].map((t) => `<option value="${t}" ${f.minTotal === t ? 'selected' : ''}>3대 ${t}+</option>`).join('')}
            </select>
          </div>
          <div class="chips" id="filterChips">
            <span class="chip ${f.matchOnly ? 'on' : ''}" data-match>조건 맞는 사람만</span>
            ${days.map((d) => `<span class="chip ${f.days.includes(d) ? 'on' : ''}" data-day="${esc(d)}">${esc(d)}</span>`).join('')}
          </div>
        </div>
        <div class="home-list" id="mateList"><div class="empty">불러오는 중...</div></div>
      </div>`));

    document.getElementById('radiusSel').addEventListener('change', (e) => { f.radius = Number(e.target.value); load(); });
    document.getElementById('genderSel').addEventListener('change', (e) => { f.gender = e.target.value || null; render(); });
    document.getElementById('totalSel').addEventListener('change', (e) => { f.minTotal = Number(e.target.value) || null; render(); });
    document.getElementById('filterChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.hasAttribute('data-match')) f.matchOnly = !f.matchOnly;
      else f.days = f.days.includes(c.dataset.day) ? f.days.filter((d) => d !== c.dataset.day) : [...f.days, c.dataset.day];
      c.classList.toggle('on');
      render();
    });

    async function load() {
      try {
        state.nearby = await Backend.nearby(f.radius);
        state.nearby.users.forEach((u) => decorate(u));
      } catch (e) {
        if (handleCodeError(e)) return;
        throw e;
      }
      if (!document.getElementById('mateList')) return;
      render();
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

  async function showProfile(id) {
    const u = decorate(await Backend.profile(id));
    let action;
    if (u.roomId) action = `<a class="btn primary block" href="#/chat/${u.roomId}">채팅방으로 이동</a>`;
    else if (u.pendingNote) action = `<button class="btn block" disabled>쪽지를 보냈어요 · 답장을 기다리는 중</button>`;
    else action = `
      ${u.iMeetTheirPrefs === false ? '<div class="banner small">상대가 원하는 메이트 조건과 맞지 않아요. 그래도 쪽지는 보낼 수 있어요.</div>' : ''}
      <form id="noteForm" class="stack">
        <label class="field"><span>쪽지 보내기</span>
          <textarea name="content" maxlength="300" required placeholder="안녕하세요! ${u.workoutDays.length ? `저도 ${esc(u.workoutDays.join('·'))}에 운동해요.` : ''} 같이 운동하실래요?"></textarea></label>
        <button class="btn primary block" type="submit">쪽지 보내기</button>
        <div class="small muted">상대방이 쪽지를 수락하면 1:1 채팅이 열려요.<br>처음 만날 땐 헬스장 등 공개된 장소에서 만나고, 돈이나 개인정보를 요구하면 신고해 주세요.</div>
      </form>`;
    const prefs = prefsLines(u.prefs);
    openModal(`
      <div class="profile-head">
        ${avatar(u.photo, 'lg')}
        <div>
          <div class="name">${esc(u.nickname)}</div>
          <div class="muted small">${esc(personLine(u))}</div>
          <div class="small" style="margin-top:4px">${esc(u.region || '')} ${u.distanceKm != null ? `· ${distLabel(u.distanceKm)}` : ''}</div>
        </div>
      </div>
      <div class="stack">
        <div class="lifts">
          <div><span>벤치프레스</span><b>${u.bench ?? '-'}</b></div>
          <div><span>스쿼트</span><b>${u.squat ?? '-'}</b></div>
          <div><span>데드리프트</span><b>${u.deadlift ?? '-'}</b></div>
          <div class="total"><span>3대 합계</span><b>${u.total ?? '-'}</b></div>
        </div>
        ${matchTags(u)}
        <dl class="kv">
          <dt>헬스장</dt><dd>${esc(u.gymName || '-')}</dd>
          <dt>운동 요일</dt><dd>${esc(u.workoutDays.join(' · ') || '-')}</dd>
          <dt>시간대</dt><dd>${esc(u.workoutTimes.join(' · ') || '-')}</dd>
        </dl>
        ${u.bio ? `<div class="note-body">${esc(u.bio)}</div>` : ''}
        <div class="pref-box">
          <div class="small" style="font-weight:700;margin-bottom:6px">이런 헬스메이트를 찾아요</div>
          ${prefs.length || u.prefs.note ? `
            ${prefs.length ? `<div class="chips">${prefs.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div>` : ''}
            ${u.prefs.note ? `<div class="small" style="margin-top:6px;white-space:pre-wrap">${esc(u.prefs.note)}</div>` : ''}`
          : '<div class="small muted">특별한 조건 없음 · 누구나 환영!</div>'}
        </div>
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
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        await Backend.sendNote(u.id, form.content.value);
        toast('쪽지를 보냈어요! 상대방이 수락하면 알려드릴게요');
        closeModal();
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
    const statusLabel = { pending: '대기 중', accepted: '수락됨', declined: '거절됨' };
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
          if (!confirm('이 쪽지를 거절할까요?')) return;
          await Backend.declineNote(id);
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
    const tabs = [['pending', '대기 중'], ['actioned', '조치 완료'], ['dismissed', '기각'], ['suspended', '정지 회원']];
    const data = tab === 'suspended' ? await Backend.adminSuspended() : await Backend.adminReports(tab);
    $app.innerHTML = '';
    $app.append(h(`
      <a class="link small" href="#/me">← 내 정보</a>
      <h1>신고 관리</h1>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="adminList">${tab === 'suspended' ? suspendedHtml(data) : reportsHtml(data, tab)}</div>`));
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
    lastDay = null;
    renderedIds.clear();
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
      try { appendMessage(await Backend.sendMessage(roomId, content)); } catch (e) { toast(e.message); ta.value = content; }
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
    html += `<div class="msg ${mine ? 'mine' : ''}"><div class="bubble">${esc(m.content)}</div>
      <div class="time">${mine && !m.readAt ? '<span class="unread">1</span>' : ''}${d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</div></div>`;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.append(h(html));
    document.getElementById('typing').textContent = '';
    if (nearBottom || mine) scrollBottom();
  }
  function scrollBottom() { const b = document.getElementById('msgs'); if (b) b.scrollTop = b.scrollHeight; }

  // ------------------------------------------------------------ views: 내 정보 / 프로필 편집
  function viewMe() {
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
        ${me.isAdmin ? '<a href="#/admin">신고 관리 (관리자)<b class="badge inline" id="badgeReports"></b></a>' : ''}
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
    if (me.isAdmin) Backend.badges().then((b) => { document.getElementById('badgeReports').textContent = b.reports || ''; }).catch(() => {});
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
