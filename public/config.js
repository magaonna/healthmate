/* 짐짝(GYMJJAK) 설정 – 이 파일만 고치면 됩니다.
 * 여기 들어가는 값은 모두 브라우저에 공개되는 값입니다.
 * ⚠️ Supabase 의 secret 키(service_role)는 절대 여기에 넣지 마세요.
 */
window.GYMJJAK_CONFIG = {
  // Supabase 대시보드 → Project Settings → API
  supabaseUrl: 'https://oyjujpezcruxphcsnobf.supabase.co',
  supabaseKey: 'sb_publishable_kdMUokZT2UybeBPgqdto5A_Hg30dM3q',

  // (선택) 카카오 JavaScript 키. 넣으면 동네 이름을 카카오 기준으로 변환, 비워두면 OpenStreetMap 사용
  kakaoJsKey: '',

  // 로그인 방법. Supabase 대시보드 → Authentication → Sign In / Providers 에서 켠 것만 넣으세요: 'kakao', 'google'
  // 10/28: 카카오 로그인 오류로 잠시 끔. 고친 뒤 ['kakao'] 로 되돌린다.
  authProviders: [],
  // 이메일 회원가입/로그인 화면 사용 여부 (false = 카카오 로그인만)
  emailLogin: true,

  // 운영 정보 – 이용약관 · 개인정보처리방침 · 정지 안내에 표시 (출시 전 꼭 채우세요)
  service: {
    name: '짐짝(GYMJJAK)',
    operator: '',        // 운영자(상호)
    contactEmail: '',    // 고객 문의 이메일
    privacyOfficer: '',  // 개인정보 보호책임자 (이름 / 연락처)
  },
};
