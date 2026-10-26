# 🏋️ 동네 헬스메이트

지도 기반으로 우리 동네에서 같이 운동할 사람을 찾는 웹 서비스입니다.

**흐름:** 회원가입 → GPS 동네 인증 → 프로필 작성 → 지도/목록에서 동네 메이트 탐색 → 쪽지 보내기 → 상대가 수락하면 1:1 실시간 채팅

## 실행

```bash
npm install
npm run seed      # (선택) 강남역 주변 데모 유저 8명 생성: demo1~8@healthmate.local / test1234
npm start         # http://localhost:3000
npm run dev       # 개발 모드: 지도 클릭으로 동네 인증 가능 + 파일 변경 시 자동 재시작
```

Node.js 22.13 이상이 필요합니다(내장 `node:sqlite` 사용, 별도 DB 설치 불필요).

> 브라우저 위치 정보(Geolocation)는 **HTTPS 또는 localhost** 에서만 동작합니다. 휴대폰으로 테스트하려면 HTTPS로 배포하거나 ngrok 등을 이용하세요.

## 환경 변수

| 변수 | 설명 |
| --- | --- |
| `PORT` | 서버 포트 (기본 3000) |
| `JWT_SECRET` | 로그인 토큰 서명 키. 없으면 `data/.jwt_secret` 에 자동 생성 |
| `KAKAO_JS_KEY` | **카카오맵 JavaScript 키.** 설정하면 지도가 카카오맵으로 표시됨. 없으면 OpenStreetMap으로 대체 |
| `KAKAO_REST_KEY` | 카카오 REST API 키. 설정하면 행정동 이름을 카카오 로컬 API로 조회(국내에선 권장). 없으면 OpenStreetMap Nominatim 사용 |
| `ALLOW_MANUAL_LOCATION` | `true` 면 GPS 없이 지도 클릭으로 인증 허용 (개발/테스트용, 운영에선 끄세요) |
| `DATA_DIR` | DB와 업로드 사진 저장 위치 (기본 `./data`) |
| `NODE_ENV=production` | 쿠키에 `Secure` 플래그 적용 (HTTPS 필수) |

## 카카오맵 설정

1. [카카오 개발자 콘솔](https://developers.kakao.com/console/app)에서 애플리케이션 추가
2. **앱 설정 → 플랫폼 → Web** 에 서비스 도메인 등록 (예: `http://localhost:3000`, `https://내도메인.com`)
3. **카카오맵** 사용 설정을 활성화 (앱 설정 → 제품 설정 → 카카오맵)
4. **앱 키** 에서 키를 복사해 환경 변수로 지정

```bash
KAKAO_JS_KEY=JavaScript키 KAKAO_REST_KEY=REST_API키 npm start
```

- `KAKAO_JS_KEY` – 지도 표시용 (브라우저에 노출되는 키라 도메인 등록으로 보호됨)
- `KAKAO_REST_KEY` – 동네 인증 시 좌표 → 행정동 이름 변환용 (서버에서만 사용)

키가 없거나 카카오맵 로딩에 실패하면 자동으로 OpenStreetMap 지도로 대체됩니다.

## 주요 기능

- **회원가입/로그인** – 이메일 + 비밀번호(bcrypt), httpOnly JWT 쿠키
- **동네 인증** – 브라우저 GPS(정확도 1km 이내만 인정) → 역지오코딩으로 동네 이름 확정, 30일간 유효
- **위치 프라이버시** – 정확한 좌표는 서버에만 저장, 다른 유저에게는 약 300m 격자 + 고정 오프셋을 적용한 근사 좌표만 노출
- **헬스 프로필** – 사진, 닉네임, 성별, 나이, 헬스 구력, 3대 1RM(벤치프레스·스쿼트·데드리프트, 합계 자동 계산), 다니는 헬스장, 자주 가는 요일·시간대, 자기소개, 공개 여부
- **원하는 헬스메이트 조건** – 성별, 나이 범위, 3대 합계 최소 kg, 기타 조건(자유 입력)
- **조건 매칭** – 목록·프로필에 `✅ 내 조건에 맞음` / `🤝 서로 조건 맞음` / `🏢 같은 헬스장` / `📅 겹치는 요일` 표시, 상대 조건에 안 맞으면 쪽지 전 안내
- **동네 탐색** – 카카오맵 + 목록, 반경(1/3/5/10km)·성별·3대 합계·요일·'내 조건에 맞는 메이트만' 필터, 거리순 정렬
- **쪽지** – 받은/보낸 쪽지함, 수락/거절, 같은 상대 중복 발송 방지, 하루 20통 제한, 실시간 알림
- **1:1 채팅** – Socket.IO 실시간 메시지, 읽음 표시(1), 입력 중 표시, 안 읽은 메시지 배지. 수락된 쪽지가 첫 메시지로 들어감

## 구조

```
server.js        Express API + Socket.IO
db.js            SQLite 스키마 (users, profiles, locations, notes, rooms, messages)
seed.js          데모 데이터
public/          프론트엔드 (vanilla JS SPA)
public/map.js    지도 어댑터 (카카오맵 / OpenStreetMap 대체)
data/            DB · 업로드 사진 (git 제외)
```

## 다음 단계로 고려할 것

- 차단/신고 기능, 이메일 인증, 비밀번호 재설정
- 로그인 시도 rate limit, 이미지 리사이즈, 푸시 알림
- 트래픽이 늘면 PostgreSQL(PostGIS) + Redis 어댑터(Socket.IO 멀티 인스턴스)로 이전
