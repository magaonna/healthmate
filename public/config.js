/* 짐짝(GYMJJAK) 설정 – 이 파일만 고치면 됩니다.
 * 여기 들어가는 값은 모두 브라우저에 공개되는 값입니다.
 * ⚠️ Supabase 의 secret 키(service_role)는 절대 여기에 넣지 마세요.
 */
window.GYMJJAK_CONFIG = {
  // Supabase 대시보드 → Project Settings → API
  supabaseUrl: 'https://oyjujpezcruxphcsnobf.supabase.co',
  supabaseKey: 'sb_publishable_kdMUokZT2UybeBPgqdto5A_Hg30dM3q',

  // (선택) 카카오맵 JavaScript 키. 비워두면 OpenStreetMap 지도 사용
  kakaoJsKey: '',

  // (선택) Supabase 대시보드 → Authentication → Providers 에서 켠 소셜 로그인: 'kakao', 'google'
  authProviders: [],

  // 운영 정보 – 이용약관 · 개인정보처리방침 · 정지 안내에 표시 (출시 전 꼭 채우세요)
  service: {
    name: '짐짝(GYMJJAK)',
    operator: '',        // 운영자(상호)
    contactEmail: '',    // 고객 문의 이메일
    privacyOfficer: '',  // 개인정보 보호책임자 (이름 / 연락처)
  },
};
