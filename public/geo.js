/* 좌표 → 동네 이름 변환. 지도는 보여 주지 않는다.
 * KAKAO_JS_KEY 가 있으면 카카오 주소 변환, 없거나 실패하면 OpenStreetMap(Nominatim)으로 대체한다.
 *   await Geo.reverseGeocode(config, lat, lng) → { region, district, providedTo }
 */
(() => {
  let kakaoLoading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`스크립트를 불러오지 못했어요: ${src}`));
      document.head.append(s);
    });
  }

  // 카카오 주소 변환(services)만 불러온다. 실패하면 다음 호출 때 다시 시도
  function loadKakao(key) {
    if (!kakaoLoading) {
      kakaoLoading = (async () => {
        await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`);
        await new Promise((resolve) => kakao.maps.load(resolve));
      })().catch((e) => { kakaoLoading = null; throw e; });
    }
    return kakaoLoading;
  }

  function kakaoRegion(lat, lng) {
    return new Promise((resolve) => {
      try {
        new kakao.maps.services.Geocoder().coord2RegionCode(lng, lat, (docs, status) => {
          if (status !== kakao.maps.services.Status.OK || !docs.length) return resolve(null);
          const d = docs.find((x) => x.region_type === 'H') || docs[0]; // 행정동 우선
          resolve({ region: d.region_3depth_name || d.region_2depth_name, district: `${d.region_1depth_name} ${d.region_2depth_name}`.trim() });
        });
      } catch { resolve(null); }
    });
  }
  async function osmRegion(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=ko`,
        { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const a = (await r.json()).address || {};
      const region = a.quarter || a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.borough;
      return region ? { region, district: [a.city || a.province || a.state, a.borough || a.city_district || a.county].filter(Boolean).join(' ') } : null;
    } catch { return null; }
  }

  async function reverseGeocode(config, lat, lng) {
    const providedTo = [];
    let geo = null;
    if (config.kakaoJsKey) {
      try {
        await loadKakao(config.kakaoJsKey);
        providedTo.push('카카오');
        geo = await kakaoRegion(lat, lng);
      } catch (e) {
        console.error('카카오 주소 변환을 불러오지 못해 OpenStreetMap 으로 대체합니다.', e);
      }
    }
    if (!geo) { providedTo.push('OpenStreetMap Foundation'); geo = await osmRegion(lat, lng); }
    return { region: geo?.region || '', district: geo?.district || '', providedTo: providedTo.join(', ') };
  }

  window.Geo = { reverseGeocode };
})();
