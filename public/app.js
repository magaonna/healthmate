/* 동네 헬스메이트 – SPA (vanilla JS) */
(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $modalBody = document.getElementById('modalBody');
  const state = { me: null, config: null, socket: null, map: null, nearby: null, filter: { radius: 3, gender: null, minTotal: null, days: [], matchOnly: false }, chatRoomId: null };

  // ------------------------------------------------------------ utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '요청에 실패했습니다.');
      Object.assign(err, data, { status: res.status });
      if (res.status === 401 && !path.startsWith('/api/auth') && path !== '/api/me') { state.me = null; location.hash = '#/login'; }
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  const genderLabel = { male: '남성', female: '여성' };
  const avatar = (photo, cls = '') => `<span class="avatar ${cls}">${photo ? `<img src="${esc(photo)}" alt="">` : '💪'}</span>`;
  const distLabel = (km) => (km == null ? '' : km < 0.5 ? '500m 이내' : `${km}km`);
  const parseDate = (s) => new Date(s.replace(' ', 'T') + 'Z');
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
    document.getElementById('topRegion').textContent = state.me?.location?.region ? `📍 ${state.me.location.region}` : '';
    if (state.map) { state.map.destroy(); state.map = null; }
  }

  // ------------------------------------------------------------ socket & badges
  function connectSocket() {
    if (state.socket) return;
    state.socket = io();
    state.socket.on('note:new', ({ from }) => { toast(`✉️ ${from}님이 쪽지를 보냈어요`); refreshBadges(); if (location.hash.startsWith('#/notes')) route(); });
    state.socket.on('note:accepted', ({ by }) => { toast(`🎉 ${by}님이 쪽지를 수락했어요! 채팅을 시작해 보세요`); refreshBadges(); });
    state.socket.on('chat:message', (msg) => {
      if (state.chatRoomId === msg.roomId) { appendMessage(msg); if (msg.senderId !== state.me.id) state.socket.emit('chat:read', { roomId: msg.roomId }); }
      else if (msg.senderId !== state.me.id) { refreshBadges(); if (location.hash === '#/chats') route(); }
    });
    state.socket.on('chat:read', ({ roomId }) => {
      if (state.chatRoomId === roomId) document.querySelectorAll('.msg.mine .unread').forEach((el) => el.remove());
    });
    let typingTimer;
    state.socket.on('chat:typing', ({ roomId }) => {
      const el = document.getElementById('typing');
      if (state.chatRoomId !== roomId || !el) return;
      el.textContent = '상대방이 입력 중...';
      clearTimeout(typingTimer); typingTimer = setTimeout(() => { el.textContent = ''; }, 2000);
    });
  }

  async function refreshBadges() {
    if (!state.me) return;
    try {
      const b = await api('/api/badges');
      document.getElementById('badgeNotes').textContent = b.notes || '';
      document.getElementById('badgeChats').textContent = b.chats || '';
    } catch {}
  }

  async function loadMe() {
    try { state.me = await api('/api/me'); } catch { state.me = null; }
    return state.me;
  }

  // ------------------------------------------------------------ router
  const routes = [
    [/^#\/login$/, viewAuth.bind(null, 'login'), { public: true }],
    [/^#\/signup$/, viewAuth.bind(null, 'signup'), { public: true }],
    [/^#\/welcome$/, viewWelcome, { noVerify: true }],
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
    if (!opts.public) {
      if (!state.me && !(await loadMe())) { location.hash = '#/login'; return; }
      connectSocket(); refreshBadges();
      if (!opts.noVerify && !state.me.location?.verified) { location.hash = '#/verify'; return; }
    } else if (state.me || await loadMe()) { location.hash = '#/'; return; }
    const params = hash.match(re)?.slice(1) || [];
    try { await fn(...params); } catch (e) { console.error(e); toast(e.message); }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------ views: auth
  const KAKAO_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.27 4.66 6.67-.2.75-.74 2.72-.85 3.14-.13.52.19.51.4.37.17-.11 2.65-1.8 3.72-2.53.67.1 1.36.15 2.07.15 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg>';
  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const AUTH_ERRORS = {
    cancelled: '로그인이 취소되었어요.',
    state: '로그인 요청이 만료되었어요. 다시 시도해 주세요.',
    provider: '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    disabled: '지원하지 않는 로그인 방식이에요.',
  };

  function viewAuth(mode) {
    setChrome({ bars: false });
    const { loginProviders: providers, allowEmailLogin } = state.config;
    const signup = mode === 'signup' && allowEmailLogin;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero">
          <div class="logo">🏋️</div>
          <h1>동네 헬스메이트</h1>
          <div class="muted">우리 동네에서 같이 운동할 헬스메이트를 찾아보세요</div>
        </div>
        <div class="card stack">
          ${providers.includes('kakao') ? `<a class="btn block social kakao" href="/auth/kakao">${KAKAO_ICON}카카오로 시작하기</a>` : ''}
          ${providers.includes('google') ? `<a class="btn block social google" href="/auth/google">${GOOGLE_ICON}Google로 시작하기</a>` : ''}
          ${providers.length ? '<div class="small muted" style="text-align:center">처음이면 자동으로 가입돼요. 별도 비밀번호가 필요 없어요.</div>'
            : '<div class="banner small">로그인 수단이 설정되지 않았어요. 서버에 KAKAO_REST_KEY 또는 GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET 을 설정해 주세요.</div>'}
        </div>
        ${allowEmailLogin ? `
          <details class="dev-login" ${signup || !providers.length ? 'open' : ''}>
            <summary class="small muted">개발 모드 · 이메일로 ${signup ? '가입' : '로그인'}</summary>
            <form class="card stack" id="authForm">
              <label class="field"><span>이메일</span><input type="email" name="email" required autocomplete="email"></label>
              <label class="field"><span>비밀번호${signup ? ' (8자 이상)' : ''}</span><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
              ${signup ? '<label class="field"><span>닉네임</span><input type="text" name="nickname" required minlength="2" maxlength="20"></label>' : ''}
              <button class="btn primary block" type="submit">${signup ? '회원가입' : '로그인'}</button>
              <div class="small muted" style="text-align:center">
                ${signup ? '<a class="link" href="#/login">로그인으로</a>' : '<a class="link" href="#/signup">이메일로 가입</a>'}
              </div>
            </form>
          </details>` : ''}
      </div></div>`));
    document.getElementById('authForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        await loadMe();
        location.hash = state.me.location?.verified ? '#/' : '#/verify';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // 소셜 로그인으로 처음 가입한 사람: 닉네임 확인 후 동네 인증으로
  function viewWelcome() {
    setChrome({ bars: false });
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero">
          <div class="logo">👋</div>
          <h1>환영해요!</h1>
          <div class="muted">동네 헬스메이트에서 사용할 닉네임을 정해 주세요</div>
        </div>
        <form class="card stack" id="welcomeForm">
          <label class="field"><span>닉네임</span><input type="text" name="nickname" value="${esc(state.me.nickname)}" required minlength="2" maxlength="20"></label>
          <button class="btn primary block" type="submit">다음 · 동네 인증하기</button>
        </form>
      </div></div>`));
    document.getElementById('welcomeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        await api('/api/me/nickname', { method: 'PUT', body: { nickname: e.target.nickname.value } });
        await loadMe();
        location.hash = '#/verify';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

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
        🔒 다른 사람에게는 정확한 위치가 아닌 대략적인 위치(약 300m 오차)만 보여요.</p>
        <div id="verifyMap"></div>
        <div id="verifyResult" class="small"></div>
        <button class="btn primary block" id="gpsBtn">📍 현재 위치로 동네 인증하기</button>
        ${manual ? '<button class="btn block" id="manualBtn" disabled>🗺️ 지도에서 선택한 위치로 인증 (개발 모드)</button><div class="small muted">개발 모드: 지도를 클릭해 위치를 선택할 수 있어요.</div>' : ''}
      </div>`));

    const start = state.me.lat != null ? [state.me.lat, state.me.lng] : [37.5665, 126.978];
    await MateMap.load(state.config);
    const map = state.map = MateMap.create(document.getElementById('verifyMap'), { center: start, zoom: state.me.lat != null ? 15 : 12 });
    if (state.me.lat != null) map.setPin(start);
    let picked = null;

    async function submit(body) {
      const r = document.getElementById('verifyResult');
      r.textContent = '동네를 확인하는 중...';
      try {
        const res = await api('/api/location/verify', { method: 'POST', body });
        await loadMe();
        r.innerHTML = `✅ <b>${esc(res.region)}</b> 인증 완료!`;
        toast(`${res.region} 인증이 완료되었어요`);
        setTimeout(() => { location.hash = state.me.profileComplete ? '#/' : '#/me'; }, 800);
      } catch (e) { r.textContent = '❌ ' + e.message; }
    }

    document.getElementById('gpsBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않아요.');
      document.getElementById('verifyResult').textContent = '현재 위치를 가져오는 중...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          map.setPin([lat, lng]); map.setView([lat, lng], 15);
          submit({ lat, lng, accuracy });
        },
        (err) => { document.getElementById('verifyResult').textContent = '❌ 위치 정보를 가져올 수 없어요: ' + (err.code === 1 ? '위치 권한을 허용해 주세요.' : err.message); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    if (manual) {
      const mb = document.getElementById('manualBtn');
      map.onClick((latlng) => { picked = latlng; map.setPin([latlng.lat, latlng.lng]); mb.disabled = false; });
      mb.addEventListener('click', () => picked && submit({ lat: picked.lat, lng: picked.lng, manual: true }));
    }
  }

  // ------------------------------------------------------------ views: 홈 (지도 + 목록)
  async function viewHome() {
    setChrome({ tab: 'home', full: true });
    const { days } = state.config;
    const f = state.filter;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="home">
        <div class="home-controls stack">
          ${!state.me.profileComplete ? '<a href="#/me" class="banner">✍️ 성별·나이·구력·운동 요일을 채워야 메이트들이 나를 알아볼 수 있어요. <b>작성하기 →</b></a>' : ''}
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
            <span class="chip ${f.matchOnly ? 'on' : ''}" data-match>✅ 내 조건에 맞는 메이트</span>
            ${days.map((d) => `<span class="chip ${f.days.includes(d) ? 'on' : ''}" data-day="${esc(d)}">${esc(d)}</span>`).join('')}
          </div>
        </div>
        <div class="home-body">
          <div id="map"></div>
          <div class="home-list" id="mateList"><div class="empty">불러오는 중...</div></div>
        </div>
      </div>`));

    await MateMap.load(state.config);
    const me = [state.me.lat, state.me.lng];
    const map = state.map = MateMap.create(document.getElementById('map'), { center: me, zoom: 14 });

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
        state.nearby = await api(`/api/profiles/nearby?radius=${f.radius}`);
      } catch (e) {
        if (e.code === 'NEED_VERIFY') { location.hash = '#/verify'; return; }
        throw e;
      }
      map.setMe(me);
      map.showRadius(me, state.nearby.radius);
      render();
    }

    function render() {
      const users = state.nearby.users.filter((u) =>
        (!f.gender || u.gender === f.gender)
        && (!f.minTotal || u.total >= f.minTotal)
        && (!f.days.length || f.days.some((d) => u.workoutDays.includes(d)))
        && (!f.matchOnly || u.meetsMyPrefs));
      map.setMates(users.map((u) => ({
        lat: u.lat,
        lng: u.lng,
        html: u.photo ? `<img src="${esc(u.photo)}" alt="">` : '🏋️',
        label: u.nickname + (u.total ? ` · 3대 ${u.total}` : ''),
        onClick: () => showProfile(u.id).catch((e) => toast(e.message)),
      })));
      const list = document.getElementById('mateList');
      if (!users.length) {
        list.innerHTML = `<div class="empty"><span class="big">🏋️</span>반경 ${state.nearby.radius}km 안에 조건에 맞는 헬스메이트가 아직 없어요.<br>필터를 줄이거나 반경을 넓혀 보세요!</div>`;
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
              ${u.workoutDays.length ? `<span class="tag gray">📅 ${esc(u.workoutDays.join('·'))}</span>` : ''}
              ${u.workoutTimes.length ? `<span class="tag gray">⏰ ${esc(u.workoutTimes.join('·'))}</span>` : ''}
              ${u.gymName ? `<span class="tag gray">📍 ${esc(u.gymName)}</span>` : ''}
            </div>
            ${matchTags(u)}
          </div>
        </div>`).join('');
      list.querySelectorAll('.user-card').forEach((el) => el.addEventListener('click', () => showProfile(Number(el.dataset.id))));
    }

    await load();
  }

  // ------------------------------------------------------------ 프로필 표시 helpers
  const personLine = (u) => [genderLabel[u.gender], u.age ? `${u.age}세` : '', u.career ? `구력 ${u.career}` : ''].filter(Boolean).join(' · ');
  function liftLine(u) {
    if (u.bench == null && u.squat == null && u.deadlift == null) return '<span class="muted small">3대 기록 미입력</span>';
    const kg = (v) => (v == null ? '-' : v);
    return `${u.total != null ? `<b>3대 ${u.total}kg</b> ` : ''}<span class="muted small">B ${kg(u.bench)} · S ${kg(u.squat)} · D ${kg(u.deadlift)}</span>`;
  }
  function matchTags(u) {
    const t = [];
    if (u.meetsMyPrefs && u.iMeetTheirPrefs) t.push('<span class="tag">🤝 서로 조건 맞음</span>');
    else if (u.meetsMyPrefs) t.push('<span class="tag">✅ 내 조건에 맞음</span>');
    if (u.sameGym) t.push('<span class="tag">🏢 같은 헬스장</span>');
    if (u.commonDays?.length) t.push(`<span class="tag">📅 ${esc(u.commonDays.join('·'))} 겹침</span>`);
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
    const u = await api(`/api/profiles/${id}`);
    let action;
    if (u.roomId) action = `<a class="btn primary block" href="#/chat/${u.roomId}">💬 채팅방으로 이동</a>`;
    else if (u.pendingNote) action = `<button class="btn block" disabled>✉️ 쪽지를 보냈어요 · 답장을 기다리는 중</button>`;
    else action = `
      ${u.iMeetTheirPrefs === false ? '<div class="banner small">⚠️ 상대가 원하는 메이트 조건과 맞지 않아요. 그래도 쪽지는 보낼 수 있어요.</div>' : ''}
      <form id="noteForm" class="stack">
        <label class="field"><span>쪽지 보내기</span>
          <textarea name="content" maxlength="300" required placeholder="안녕하세요! ${u.workoutDays.length ? `저도 ${esc(u.workoutDays.join('·'))}에 운동해요.` : ''} 같이 운동하실래요? 💪"></textarea></label>
        <button class="btn primary block" type="submit">✉️ 쪽지 보내기</button>
        <div class="small muted">상대방이 쪽지를 수락하면 1:1 채팅이 열려요.</div>
      </form>`;
    const prefs = prefsLines(u.prefs);
    openModal(`
      <div class="profile-head">
        ${avatar(u.photo, 'lg')}
        <div>
          <div class="name">${esc(u.nickname)}</div>
          <div class="muted small">${esc(personLine(u))}</div>
          <div class="small" style="margin-top:4px">📍 ${esc(u.region || '')} ${u.distanceKm != null ? `· ${distLabel(u.distanceKm)}` : ''}</div>
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
          <div class="small" style="font-weight:700;margin-bottom:6px">🔎 이런 헬스메이트를 찾아요</div>
          ${prefs.length || u.prefs.note ? `
            ${prefs.length ? `<div class="chips">${prefs.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div>` : ''}
            ${u.prefs.note ? `<div class="small" style="margin-top:6px;white-space:pre-wrap">${esc(u.prefs.note)}</div>` : ''}`
          : '<div class="small muted">특별한 조건 없음 · 누구나 환영!</div>'}
        </div>
        ${action}
        <button class="btn block" data-close>닫기</button>
      </div>`);
    const form = document.getElementById('noteForm');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        await api('/api/notes', { method: 'POST', body: { toId: u.id, content: form.content.value } });
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
    const notes = await api(`/api/notes?box=${box}`);
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
            ${n.status === 'accepted' && n.roomId ? `<a class="btn block" href="#/chat/${n.roomId}">💬 채팅방으로 이동</a>` : ''}
          </div>`).join('') : `<div class="empty"><span class="big">✉️</span>${box === 'inbox' ? '받은 쪽지가 없어요.<br>동네 메이트에게 먼저 쪽지를 보내보세요!' : '보낸 쪽지가 없어요.'}</div>`}
      </div>`));
    $app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { sessionStorageSet('notesBox', b.dataset.box); viewNotes(b.dataset.box); }));
    $app.querySelectorAll('.profile-link').forEach((el) => el.addEventListener('click', () => showProfile(Number(el.dataset.uid)).catch((e) => toast(e.message))));
    $app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-id]').dataset.id;
      try {
        if (b.dataset.act === 'accept') {
          const r = await api(`/api/notes/${id}/accept`, { method: 'POST' });
          location.hash = `#/chat/${r.roomId}`;
        } else {
          if (!confirm('이 쪽지를 거절할까요?')) return;
          await api(`/api/notes/${id}/decline`, { method: 'POST' });
          viewNotes(box);
        }
      } catch (e) { toast(e.message); }
    }));
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

  // ------------------------------------------------------------ views: 채팅 목록
  async function viewChats() {
    setChrome({ tab: 'chats' });
    const rooms = await api('/api/rooms');
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
        </a>`).join('') : '<div class="empty"><span class="big">💬</span>아직 채팅방이 없어요.<br>쪽지가 수락되면 여기에서 대화할 수 있어요.</div>'}`));
  }

  // ------------------------------------------------------------ views: 1:1 채팅방
  let lastDay = null;
  async function viewChat(roomId) {
    roomId = Number(roomId);
    setChrome({ tab: 'chat', full: true });
    const data = await api(`/api/rooms/${roomId}/messages`);
    refreshBadges();
    const other = data.room.other;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="chat">
        <div class="chat-head">
          <a href="#/chats" class="btn sm" aria-label="뒤로">←</a>
          ${avatar(other.photo)}
          <div style="flex:1;min-width:0"><b>${esc(other.nickname)}</b><div class="small muted">${esc(other.region || '')}</div></div>
          <button class="btn sm" id="viewProfile">프로필</button>
        </div>
        <div class="chat-msgs" id="msgs"></div>
        <div class="typing" id="typing"></div>
        <form class="chat-input" id="chatForm">
          <textarea name="content" placeholder="메시지를 입력하세요" maxlength="1000" rows="1"></textarea>
          <button class="btn primary" type="submit">전송</button>
        </form>
      </div>`));
    state.chatRoomId = roomId;
    lastDay = null;
    data.messages.forEach(appendMessage);
    if (!data.messages.length) document.getElementById('msgs').innerHTML = '<div class="day-sep">채팅방이 열렸어요. 인사를 건네 보세요 👋</div>';
    scrollBottom();

    document.getElementById('viewProfile').addEventListener('click', () => showProfile(other.id).catch((e) => toast(e.message)));
    const form = document.getElementById('chatForm');
    const ta = form.content;
    let lastTyping = 0;
    const send = () => {
      const content = ta.value.trim();
      if (!content) return;
      state.socket.emit('chat:send', { roomId, content }, (res) => { if (res?.error) toast(res.error); });
      ta.value = ''; ta.style.height = '';
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); ta.focus(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    ta.addEventListener('input', () => {
      ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      if (Date.now() - lastTyping > 1200) { lastTyping = Date.now(); state.socket.emit('chat:typing', { roomId }); }
    });
  }

  function appendMessage(m) {
    const box = document.getElementById('msgs');
    if (!box) return;
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
              <label class="btn sm" style="width:fit-content">📷 사진 선택<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
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
          <div class="small muted">설정한 조건에 맞는 사람에게는 목록에서 '✅ 내 조건에 맞음' 표시가 붙어요.</div>
        </section>

        <label class="row small card"><input type="checkbox" name="isPublic" ${me.isPublic ? 'checked' : ''}> 동네 헬스메이트 목록에 내 프로필 공개</label>
        <button class="btn primary block" type="submit">저장하기</button>
      </form>
      <div class="row" style="margin-top:16px"><span class="small muted">${esc({ kakao: '카카오 계정으로 로그인됨', google: 'Google 계정으로 로그인됨' }[me.provider] || me.email || '')}</span><span class="spacer"></span><button class="btn sm danger" id="logoutBtn">로그아웃</button></div>`));

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
      const fd = new FormData(form);
      const picked = (id) => [...document.querySelectorAll(`#${id} .chip.on`)].map((x) => x.dataset.v).join(',');
      fd.set('workoutDays', picked('dayChips'));
      fd.set('workoutTimes', picked('timeChips'));
      fd.set('isPublic', form.isPublic.checked ? 'true' : 'false');
      if (!form.photo.files.length) fd.delete('photo');
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await api('/api/profile', { method: 'PUT', body: fd });
        await loadMe();
        toast('프로필이 저장되었어요');
        location.hash = '#/';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.me = null; state.socket?.disconnect(); state.socket = null;
      location.hash = '#/login';
    });
  }

  // ------------------------------------------------------------ boot
  (async () => {
    state.config = await api('/api/config');
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (authError) {
      history.replaceState(null, '', '/' + location.hash);
      setTimeout(() => toast(AUTH_ERRORS[authError] || AUTH_ERRORS.provider), 300);
    }
    route();
  })();
})();
