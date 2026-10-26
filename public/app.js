/* 동네 헬스메이트 – SPA (vanilla JS) */
(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $modalBody = document.getElementById('modalBody');
  const state = { me: null, config: null, socket: null, map: null, nearby: null, filter: { workout: null, radius: 3 }, chatRoomId: null };

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

  const genderLabel = { male: '남성', female: '여성', other: '기타' };
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
    if (state.map && !document.getElementById('map')) { state.map.remove(); state.map = null; }
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
  function viewAuth(mode) {
    setChrome({ bars: false });
    const signup = mode === 'signup';
    $app.innerHTML = '';
    $app.append(h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero">
          <div class="logo">🏋️</div>
          <h1>동네 헬스메이트</h1>
          <div class="muted">우리 동네에서 같이 운동할 친구를 찾아보세요</div>
        </div>
        <form class="card stack" id="authForm">
          <label class="field"><span>이메일</span><input type="email" name="email" required autocomplete="email"></label>
          <label class="field"><span>비밀번호${signup ? ' (8자 이상)' : ''}</span><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
          ${signup ? '<label class="field"><span>닉네임</span><input type="text" name="nickname" required minlength="2" maxlength="20"></label>' : ''}
          <button class="btn primary block" type="submit">${signup ? '회원가입' : '로그인'}</button>
          <div class="small muted" style="text-align:center">
            ${signup ? '이미 계정이 있나요? <a class="link" href="#/login">로그인</a>' : '처음이신가요? <a class="link" href="#/signup">회원가입</a>'}
          </div>
        </form>
      </div></div>`));
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        await api(`/api/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        await loadMe();
        location.hash = state.me.location?.verified ? '#/' : '#/verify';
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------ views: 동네 인증
  function viewVerify() {
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
    const map = state.map = L.map('verifyMap').setView(start, state.me.lat != null ? 15 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    let marker = state.me.lat != null ? L.marker(start).addTo(map) : null;
    let picked = null;
    const setMarker = (latlng) => { if (marker) marker.setLatLng(latlng); else marker = L.marker(latlng).addTo(map); };

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
          setMarker([lat, lng]); map.setView([lat, lng], 15);
          submit({ lat, lng, accuracy });
        },
        (err) => { document.getElementById('verifyResult').textContent = '❌ 위치 정보를 가져올 수 없어요: ' + (err.code === 1 ? '위치 권한을 허용해 주세요.' : err.message); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    if (manual) {
      const mb = document.getElementById('manualBtn');
      map.on('click', (e) => { picked = e.latlng; setMarker(picked); mb.disabled = false; });
      mb.addEventListener('click', () => picked && submit({ lat: picked.lat, lng: picked.lng, manual: true }));
    }
  }

  // ------------------------------------------------------------ views: 홈 (지도 + 목록)
  async function viewHome() {
    setChrome({ tab: 'home', full: true });
    const { workouts } = state.config;
    $app.innerHTML = '';
    $app.append(h(`
      <div class="home">
        <div class="home-controls stack">
          ${!state.me.profileComplete ? '<a href="#/me" class="banner">✍️ 프로필을 완성하면 다른 메이트에게 내 프로필이 보여요. <b>작성하기 →</b></a>' : ''}
          <div class="row">
            <select id="radiusSel" style="width:auto;padding:6px 10px">
              ${[1, 3, 5, 10].map((r) => `<option value="${r}" ${r === state.filter.radius ? 'selected' : ''}>반경 ${r}km</option>`).join('')}
            </select>
            <div class="chips" id="workoutChips">
              <span class="chip ${!state.filter.workout ? 'on' : ''}" data-w="">전체</span>
              ${workouts.map((w) => `<span class="chip ${state.filter.workout === w ? 'on' : ''}" data-w="${esc(w)}">${esc(w)}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="home-body">
          <div id="map"></div>
          <div class="home-list" id="mateList"><div class="empty">불러오는 중...</div></div>
        </div>
      </div>`));

    const map = state.map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    let circle = null;

    document.getElementById('radiusSel').addEventListener('change', (e) => { state.filter.radius = Number(e.target.value); load(); });
    document.getElementById('workoutChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      state.filter.workout = c.dataset.w || null;
      document.querySelectorAll('#workoutChips .chip').forEach((x) => x.classList.toggle('on', x === c));
      render();
    });

    async function load() {
      try {
        state.nearby = await api(`/api/profiles/nearby?radius=${state.filter.radius}`);
      } catch (e) {
        if (e.code === 'NEED_VERIFY') { location.hash = '#/verify'; return; }
        throw e;
      }
      const me = [state.me.lat, state.me.lng];
      map.setView(me, 14);
      if (circle) circle.remove();
      markers.clearLayers();
      circle = L.circle(me, { radius: state.nearby.radius * 1000, color: '#16a34a', weight: 1, fillOpacity: 0.05 }).addTo(map);
      L.marker(me, { icon: L.divIcon({ className: 'me-marker', iconSize: [16, 16] }), interactive: false }).addTo(markers);
      map.fitBounds(circle.getBounds(), { padding: [10, 10] });
      render();
    }

    function render() {
      const users = state.nearby.users.filter((u) => !state.filter.workout || u.workouts.includes(state.filter.workout));
      markers.eachLayer((l) => { if (l.options.userId) markers.removeLayer(l); });
      users.forEach((u) => {
        const icon = L.divIcon({ className: 'mate-marker', html: u.photo ? `<img src="${esc(u.photo)}" alt="">` : '💪', iconSize: [34, 34] });
        L.marker([u.lat, u.lng], { icon, userId: u.id }).addTo(markers)
          .bindTooltip(esc(u.nickname), { direction: 'top', offset: [0, -16] })
          .on('click', () => showProfile(u.id));
      });
      const list = document.getElementById('mateList');
      if (!users.length) {
        list.innerHTML = `<div class="empty"><span class="big">🏃</span>반경 ${state.nearby.radius}km 안에 ${state.filter.workout ? `'${esc(state.filter.workout)}' ` : ''}메이트가 아직 없어요.<br>반경을 넓혀 보세요!</div>`;
        return;
      }
      list.innerHTML = `<div class="small muted" style="margin-bottom:8px">${esc(state.nearby.region)} 근처 메이트 <b>${users.length}</b>명</div>` + users.map((u) => `
        <div class="user-card" data-id="${u.id}">
          ${avatar(u.photo)}
          <div class="meta">
            <div class="row"><span class="name">${esc(u.nickname)}</span>
              <span class="small muted">${[genderLabel[u.gender], u.ageGroup].filter(Boolean).map(esc).join(' · ')}</span>
              <span class="spacer"></span><span class="small muted">${distLabel(u.distanceKm)}</span></div>
            <div class="bio">${esc(u.bio) || '<i>소개가 없어요</i>'}</div>
            <div class="tags">
              ${u.workouts.map((w) => `<span class="tag">${esc(w)}</span>`).join('')}
              ${u.preferredTime ? `<span class="tag gray">⏰ ${esc(u.preferredTime)}</span>` : ''}
              ${u.level ? `<span class="tag gray">${esc(u.level)}</span>` : ''}
            </div>
          </div>
        </div>`).join('');
      list.querySelectorAll('.user-card').forEach((el) => el.addEventListener('click', () => showProfile(Number(el.dataset.id))));
    }

    await load();
  }

  async function showProfile(id) {
    const u = await api(`/api/profiles/${id}`);
    let action;
    if (u.roomId) action = `<a class="btn primary block" href="#/chat/${u.roomId}">💬 채팅방으로 이동</a>`;
    else if (u.pendingNote) action = `<button class="btn block" disabled>✉️ 쪽지를 보냈어요 · 답장을 기다리는 중</button>`;
    else action = `
      <form id="noteForm" class="stack">
        <label class="field"><span>쪽지 보내기</span>
          <textarea name="content" maxlength="300" required placeholder="안녕하세요! 저도 ${esc(u.workouts[0] || '운동')} 좋아해요. 같이 운동하실래요? 🙌"></textarea></label>
        <button class="btn primary block" type="submit">✉️ 쪽지 보내기</button>
        <div class="small muted">상대방이 쪽지를 수락하면 1:1 채팅이 열려요.</div>
      </form>`;
    openModal(`
      <div class="profile-head">
        ${avatar(u.photo, 'lg')}
        <div>
          <div class="name">${esc(u.nickname)}</div>
          <div class="muted small">${[genderLabel[u.gender], u.ageGroup].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="small" style="margin-top:4px">📍 ${esc(u.region || '')} ${u.distanceKm != null ? `· ${distLabel(u.distanceKm)}` : ''}</div>
        </div>
      </div>
      <div class="stack">
        ${u.bio ? `<div class="note-body">${esc(u.bio)}</div>` : ''}
        <dl class="kv">
          <dt>운동</dt><dd><div class="chips">${u.workouts.map((w) => `<span class="tag">${esc(w)}</span>`).join('') || '-'}</div></dd>
          <dt>선호 시간</dt><dd>${esc(u.preferredTime || '-')}</dd>
          <dt>운동 레벨</dt><dd>${esc(u.level || '-')}</dd>
          <dt>헬스장</dt><dd>${esc(u.gymName || '-')}</dd>
        </dl>
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
    const me = state.me; const c = state.config;
    const opt = (list, cur, labels = {}) => `<option value="">선택 안 함</option>` + list.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(labels[v] || v)}</option>`).join('');
    $app.innerHTML = '';
    $app.append(h(`
      <h1>내 정보</h1>
      <div class="card stack" style="margin-bottom:14px">
        <div class="row"><div style="flex:1">
          <div class="small muted">인증된 동네</div>
          <div><b>${me.location ? esc(me.location.region) : '미인증'}</b> ${me.location && !me.location.verified ? '<span class="small" style="color:var(--danger)">(만료)</span>' : ''}</div>
        </div><a class="btn sm" href="#/verify">${me.location ? '재인증' : '인증하기'}</a></div>
      </div>
      <form class="card stack" id="profileForm">
        <h2>프로필</h2>
        <div class="photo-pick">
          <span id="photoPreview">${avatar(me.photo, 'lg')}</span>
          <div class="stack" style="flex:1">
            <label class="btn sm" style="width:fit-content">📷 사진 선택<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
            ${me.photo ? '<label class="small muted"><input type="checkbox" name="removePhoto" value="true"> 사진 삭제</label>' : ''}
          </div>
        </div>
        <label class="field"><span>닉네임</span><input type="text" name="nickname" value="${esc(me.nickname)}" minlength="2" maxlength="20" required></label>
        <div class="row">
          <label class="field" style="flex:1"><span>성별</span><select name="gender">${opt(['male', 'female', 'other'], me.gender, genderLabel)}</select></label>
          <label class="field" style="flex:1"><span>연령대</span><select name="ageGroup">${opt(c.ageGroups, me.ageGroup)}</select></label>
        </div>
        <div class="field"><span class="small muted" style="font-weight:600;display:block;margin-bottom:6px">관심 운동 (여러 개 선택)</span>
          <div class="chips" id="wChips">${c.workouts.map((w) => `<span class="chip ${me.workouts.includes(w) ? 'on' : ''}" data-w="${esc(w)}">${esc(w)}</span>`).join('')}</div></div>
        <div class="row">
          <label class="field" style="flex:1"><span>선호 시간대</span><select name="preferredTime">${opt(c.times, me.preferredTime)}</select></label>
          <label class="field" style="flex:1"><span>운동 레벨</span><select name="level">${opt(c.levels, me.level)}</select></label>
        </div>
        <label class="field"><span>다니는 헬스장 / 운동 장소</span><input type="text" name="gymName" value="${esc(me.gymName)}" maxlength="50" placeholder="예) 역삼 OO피트니스, 양재천"></label>
        <label class="field"><span>자기소개</span><textarea name="bio" maxlength="500" placeholder="어떤 메이트를 찾고 있는지 적어주세요. 예) 주 3회 저녁에 같이 하체 하실 분! 3대 300 목표입니다.">${esc(me.bio)}</textarea></label>
        <label class="row small"><input type="checkbox" name="isPublic" ${me.isPublic ? 'checked' : ''}> 동네 메이트 목록에 내 프로필 공개</label>
        <button class="btn primary block" type="submit">저장하기</button>
      </form>
      <div class="row" style="margin-top:16px"><span class="small muted">${esc(me.email)}</span><span class="spacer"></span><button class="btn sm danger" id="logoutBtn">로그아웃</button></div>`));

    const form = document.getElementById('profileForm');
    document.getElementById('wChips').addEventListener('click', (e) => { const ch = e.target.closest('.chip'); if (ch) ch.classList.toggle('on'); });
    form.photo.addEventListener('change', () => {
      const f = form.photo.files[0];
      if (f) document.getElementById('photoPreview').innerHTML = avatar(URL.createObjectURL(f), 'lg');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      fd.set('workouts', [...document.querySelectorAll('#wChips .chip.on')].map((x) => x.dataset.w).join(','));
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
    route();
  })();
})();
