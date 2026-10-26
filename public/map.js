/* 지도 어댑터: KAKAO_JS_KEY 가 있으면 카카오맵, 없으면 OpenStreetMap(Leaflet)으로 대체한다.
 * 화면 코드는 이 파일의 MateMap API 만 사용한다.
 *   await MateMap.load(config)
 *   const m = MateMap.create(el, { center: [lat, lng], zoom })   // zoom 은 Leaflet 기준(클수록 확대)
 *   m.setView(latlng, zoom) / m.showRadius(center, km) / m.setMe(latlng) / m.setPin(latlng)
 *   m.setMates([{ lat, lng, html, label, onClick }]) / m.onClick(({ lat, lng }) => ...) / m.destroy()
 */
(() => {
  let provider = null;
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`지도 스크립트를 불러오지 못했어요: ${src}`));
      document.head.append(s);
    });
  }

  function load(config) {
    if (loading) return loading;
    loading = (async () => {
      if (config.kakaoJsKey) {
        try {
          await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoJsKey)}&autoload=false`);
          await new Promise((resolve) => kakao.maps.load(resolve));
          provider = 'kakao';
          return;
        } catch (e) {
          console.error('카카오맵 로드 실패, OpenStreetMap 으로 대체합니다.', e);
        }
      } else {
        console.warn('KAKAO_JS_KEY 가 없어 OpenStreetMap 지도를 사용합니다.');
      }
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
      document.head.append(css);
      await loadScript('/vendor/leaflet/leaflet.js');
      provider = 'leaflet';
    })();
    return loading;
  }

  const mateEl = (m) => {
    const el = document.createElement('div');
    el.className = 'mate-pin';
    el.innerHTML = `<div class="mate-marker">${m.html}</div><span class="mate-label"></span>`;
    el.querySelector('.mate-label').textContent = m.label;
    return el;
  };

  // ---------------------------------------------------------------- 카카오맵
  function createKakao(el, { center, zoom }) {
    const K = kakao.maps;
    const ll = ([lat, lng]) => new K.LatLng(lat, lng);
    const level = (z) => Math.min(Math.max(19 - z, 1), 14); // Leaflet zoom → 카카오 level
    const map = new K.Map(el, { center: ll(center), level: level(zoom) });
    map.addControl(new K.ZoomControl(), K.ControlPosition.RIGHT);
    let circle = null; let me = null; let pin = null; let mates = [];

    return {
      setView(c, z) { map.setLevel(level(z)); map.setCenter(ll(c)); },
      showRadius(c, km) {
        if (circle) circle.setMap(null);
        circle = new K.Circle({ center: ll(c), radius: km * 1000, strokeWeight: 1, strokeColor: '#16a34a', strokeOpacity: 0.9, fillColor: '#16a34a', fillOpacity: 0.06 });
        circle.setMap(map);
        map.setBounds(circle.getBounds());
      },
      setMe(c) {
        if (me) me.setMap(null);
        const d = document.createElement('div'); d.className = 'me-marker';
        me = new K.CustomOverlay({ position: ll(c), content: d, xAnchor: 0.5, yAnchor: 0.5, zIndex: 1 });
        me.setMap(map);
      },
      setPin(c) {
        if (pin) pin.setPosition(ll(c));
        else { pin = new K.Marker({ position: ll(c) }); pin.setMap(map); }
      },
      setMates(list) {
        mates.forEach((o) => o.setMap(null));
        mates = list.map((m) => {
          const content = mateEl(m);
          content.addEventListener('click', m.onClick);
          const o = new K.CustomOverlay({ position: ll([m.lat, m.lng]), content, xAnchor: 0.5, yAnchor: 0.5, clickable: true, zIndex: 2 });
          o.setMap(map);
          return o;
        });
      },
      onClick(cb) { K.event.addListener(map, 'click', (e) => cb({ lat: e.latLng.getLat(), lng: e.latLng.getLng() })); },
      destroy() { mates.forEach((o) => o.setMap(null)); el.innerHTML = ''; },
    };
  }

  // ---------------------------------------------------------------- OpenStreetMap (대체)
  function createLeaflet(el, { center, zoom }) {
    const map = L.map(el).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const mateLayer = L.layerGroup().addTo(map);
    let circle = null; let me = null; let pin = null;

    return {
      setView(c, z) { map.setView(c, z); },
      showRadius(c, km) {
        if (circle) circle.remove();
        circle = L.circle(c, { radius: km * 1000, color: '#16a34a', weight: 1, fillOpacity: 0.05 }).addTo(map);
        map.fitBounds(circle.getBounds(), { padding: [10, 10], animate: false }); // 애니메이션 중 화면 이동 시 Leaflet 오류 방지
      },
      setMe(c) {
        if (me) me.remove();
        me = L.marker(c, { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16] }), interactive: false, zIndexOffset: -100 }).addTo(map);
      },
      setPin(c) { if (pin) pin.setLatLng(c); else pin = L.marker(c).addTo(map); },
      setMates(list) {
        mateLayer.clearLayers();
        list.forEach((m) => {
          L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: mateEl(m), iconSize: [34, 34] }) })
            .addTo(mateLayer).on('click', m.onClick);
        });
      },
      onClick(cb) { map.on('click', (e) => cb({ lat: e.latlng.lat, lng: e.latlng.lng })); },
      destroy() { map.remove(); },
    };
  }

  window.MateMap = {
    load,
    get provider() { return provider; },
    create: (el, opts) => (provider === 'kakao' ? createKakao(el, opts) : createLeaflet(el, opts)),
  };
})();
