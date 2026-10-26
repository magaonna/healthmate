# 🏋️ 짐짝 (GYMJJAK)

우리 동네에서 같이 운동할 헬스메이트를 찾는 지도 기반 웹 서비스입니다.

**흐름:** 카카오 로그인 → GPS 동네 인증 → 헬스 프로필 작성 → 지도/목록에서 동네 메이트 탐색 → 쪽지 보내기 → 상대가 수락하면 1:1 실시간 채팅

**구조:** 화면(`public/`) + **Supabase** (로그인 · 데이터베이스 · 사진 저장 · 실시간). 별도 서버가 필요 없어서 `public/` 폴더만 정적 호스팅에 올리면 됩니다.

```
public/
  index.html      화면 뼈대
  config.js       ⚙️ 설정 (Supabase 주소·공개키, 카카오맵 키, 운영 정보) ← 이 파일만 고치면 됨
  backend.js      Supabase 연결 (로그인, RPC 호출, 사진 업로드, 실시간)
  app.js          화면 (vanilla JS SPA)
  map.js          지도 (카카오맵 / OpenStreetMap) + 좌표 → 동네 이름 변환
  policies.js     이용약관 · 개인정보처리방침 · 위치기반서비스 이용약관
  style.css
supabase/
  schema.sql      DB 테이블 · 보안 규칙(RLS) · 함수 · 사진 저장소 · 실시간 설정
server.js         로컬 미리보기용 정적 서버 (의존성 없음)
```

## 1. Supabase 준비 (처음 한 번)

1. **DB 만들기** – Supabase 대시보드 → **SQL Editor** → New query → `supabase/schema.sql` 내용을 **전부** 붙여넣고 **Run**
   (여러 번 실행해도 안전합니다. 나중에 schema.sql 이 바뀌면 다시 실행하세요.)
2. **주소 등록** – **Authentication → URL Configuration**
   - Site URL: 서비스 주소 (예: `https://gymjjak.vercel.app`, 로컬 테스트는 `http://localhost:3000`)
   - Redirect URLs: `http://localhost:3000` 과 배포 주소를 모두 추가 (가입 인증 메일의 링크가 여기로 돌아옵니다)
3. **이메일 인증** – Supabase 는 기본으로 가입 시 **인증 메일**을 보냅니다 (아무 메일로 가짜 계정 만드는 것 방지).
   - ⚠️ Supabase 기본 메일 발송은 **시간당 발송 수가 매우 적고 테스트용**입니다. 실제 출시 전에 **Authentication → Emails → SMTP Settings** 에서 메일 발송 서비스(Resend, AWS SES, 네이버 웍스 등)를 연결하세요.
   - 혼자 테스트할 때 메일 없이 바로 가입되게 하려면: **Authentication → Sign In / Providers → Email → Confirm email** 끄기
4. **관리자 지정** – 가입한 뒤 SQL Editor 에서 실행 (카카오 계정은 아래 '카카오 로그인 설정' 참고):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = '관리자@이메일.com';
   ```
   → 그 계정으로 로그인하면 [내 정보 → 🛡️ 신고 관리] 메뉴가 생깁니다.

## 카카오 로그인 설정

지금 `config.js` 는 **카카오 로그인만** 쓰도록 되어 있습니다 (`authProviders: ['kakao']`, `emailLogin: false`).
처음 카카오로 로그인하면 자동 가입 → 닉네임 확인 · 약관 동의 → 동네 인증 순서로 진행됩니다.

**① 카카오 개발자 콘솔** ([developers.kakao.com](https://developers.kakao.com/console/app))
1. **애플리케이션 추가하기** → 앱 이름 `짐짝`
2. **앱 설정 → 플랫폼 → Web 플랫폼 등록** → 사이트 도메인: Vercel 주소 (예: `https://gymjjak.vercel.app`), `http://localhost:3000`
3. **제품 설정 → 카카오 로그인** → **활성화 ON**
4. 같은 화면 **Redirect URI** 등록 → `https://oyjujpezcruxphcsnobf.supabase.co/auth/v1/callback`
   (사이트 주소가 아니라 **Supabase 주소**입니다)
5. **카카오 로그인 → 동의항목**
   - 닉네임(profile_nickname): **필수 동의**
   - 프로필 사진(profile_image): 선택 동의 (선택)
   - 카카오계정(이메일)(account_email): **선택 동의** – 이 항목은 **비즈 앱** 전환이 필요합니다. [앱 설정 → 비즈니스] 에서 **개인 개발자 비즈 앱** 으로 전환(본인인증만 하면 됨)한 뒤 설정하세요.
6. **카카오 로그인 → 보안 → Client Secret** → 코드 생성 → **활성화 상태: 사용함**
7. **앱 설정 → 앱 키** 에서 **REST API 키** 확인

**② Supabase 대시보드**
1. **Authentication → Sign In / Providers → Kakao** → Enable
   - **REST API Key** 칸: ①-7 의 REST API 키
   - **Client Secret Code** 칸: ①-6 의 Client Secret
   - (화면에 **Allow users without an email** 옵션이 있으면 켜 두세요 – 이메일 동의를 안 한 사용자도 가입 가능)
2. **Authentication → URL Configuration**
   - Site URL: Vercel 주소
   - Redirect URLs: Vercel 주소와 `http://localhost:3000` 추가 (로그인 후 이 주소로 돌아옵니다)

**관리자 지정** (카카오 계정은 이메일이 없을 수 있으므로 닉네임으로):
```sql
insert into public.admins (user_id) select id from public.profiles where nickname = '내 닉네임';
```

> 이메일 가입을 다시 쓰려면 `config.js` 에서 `emailLogin: true` 로 바꾸면 됩니다.

## 인증 메일을 한글 · '짐짝' 이름으로 보내기

**① 보내는 사람 이름 "짐짝"** – Supabase 기본 메일은 보내는 사람이 `Supabase Auth` 로 고정이라, **SMTP(메일 발송 서비스)를 연결**해야 바꿀 수 있습니다.
**Authentication → Emails → SMTP Settings** → Enable custom SMTP

| 항목 | 네이버 메일로 보낼 때 (도메인 없이 바로 가능) | 내 도메인이 있을 때 (Resend 등, 권장) |
| --- | --- | --- |
| Sender email | `내아이디@naver.com` | `noreply@내도메인.com` |
| Sender name | `짐짝` | `짐짝` |
| Host / Port | `smtp.naver.com` / `465` | `smtp.resend.com` / `465` |
| Username | 네이버 아이디 | `resend` |
| Password | 네이버 비밀번호 (2단계 인증 사용 시 **애플리케이션 비밀번호**) | Resend API 키 |

- 네이버: 메일 → 환경설정 → **POP3/IMAP 설정** 에서 **IMAP/SMTP 사용** 을 켜야 합니다. 개인 메일 계정은 하루 발송량이 제한되므로 사용자가 많아지면 도메인 + Resend 같은 서비스로 옮기세요.
- SMTP 를 연결하면 **Authentication → Rate Limits** 에서 시간당 메일 발송 수도 늘릴 수 있습니다.

**② 메일 내용 한글** – **Authentication → Emails → Templates** 에서 템플릿별로 제목과 내용(Source)을 바꿉니다. 각 파일 맨 위 주석에 제목이 있습니다.

| 템플릿 | 파일 | 제목 |
| --- | --- | --- |
| Confirm signup | `supabase/email-templates/confirm-signup.html` | [짐짝] 이메일 인증을 완료해 주세요 |
| Reset password | `supabase/email-templates/reset-password.html` | [짐짝] 비밀번호 재설정 안내 |
| Change email address | `supabase/email-templates/change-email.html` | [짐짝] 이메일 주소 변경 확인 |

## 2. 설정 (`public/config.js`)

| 항목 | 설명 |
| --- | --- |
| `supabaseUrl` / `supabaseKey` | Supabase **Project URL** 과 **Publishable key** (이미 입력됨). ⚠️ secret / service_role 키는 절대 넣지 마세요 |
| `kakaoJsKey` | (선택) 카카오맵 JavaScript 키. 넣으면 지도와 동네 이름이 카카오 기준. 비우면 OpenStreetMap |
| `authProviders` | 로그인 버튼: `['kakao']` (현재), `['kakao', 'google']` 등 – Supabase **Authentication → Providers** 에서 켠 것만 |
| `emailLogin` | `false` 면 이메일 가입/로그인 화면을 숨기고 소셜 로그인만 사용 (현재 false) |
| `service` | 운영자(상호) · 문의 이메일 · 개인정보 보호책임자 – 약관/개인정보처리방침에 표시. **출시 전 꼭 채우기** |

DB 쪽 설정은 SQL 로 바꿉니다:

```sql
update public.app_settings set allow_manual_location = true;  -- 개발용: GPS 없이 지도 클릭으로 동네 인증 (출시 땐 false)
update public.app_settings set terms_version = '2027-01-01';  -- 약관을 바꿨을 때: 기존 회원에게 다음 접속 시 재동의 받기
update public.app_settings set auto_suspend_reporters = 3;     -- 30일 내 서로 다른 N명 신고 시 자동 정지
```

## 3. 실행 · 배포

```bash
npm start        # http://localhost:3000 (설치할 패키지 없음)
```

> 브라우저 위치 정보(GPS)는 **HTTPS 또는 localhost** 에서만 동작합니다.

**배포** – `public/` 폴더를 정적 호스팅에 올리면 끝입니다.
- **Vercel**: GitHub 저장소 연결 → 그대로 Deploy (`vercel.json` 이 `public` 폴더를 배포하도록 설정되어 있음)
- **Netlify**: Publish directory: `public` (또는 public 폴더를 드래그 앤 드롭)

배포 후 할 일: Supabase **URL Configuration** 에 배포 주소 추가, 카카오맵을 쓰면 카카오 개발자 콘솔 **플랫폼 → Web** 에 배포 도메인 추가.

## 카카오맵 (선택)

1. [카카오 개발자 콘솔](https://developers.kakao.com/console/app) → 애플리케이션 추가
2. **플랫폼 → Web** 에 사이트 도메인 등록 (`http://localhost:3000`, 배포 주소)
3. **카카오맵** 사용 설정 켜기
4. **JavaScript 키**를 `config.js` 의 `kakaoJsKey` 에 입력 (브라우저용 키라 공개돼도 등록한 도메인에서만 동작)

## 회원가입이 안 될 때

화면에 뜨는 안내 문구로 원인을 알 수 있습니다. (자세한 원인은 브라우저 개발자 도구 → Console 의 `[Supabase]` 줄)

| 안내 문구 | 원인 · 해결 |
| --- | --- |
| 인증 메일을 보낼 수 없는 주소예요 | Supabase 기본 메일은 **프로젝트 팀원 이메일로만** 발송됩니다. **Authentication → Emails → SMTP Settings** 에서 메일 서비스를 연결하거나, 테스트 중에는 **Confirm email** 을 끄세요 |
| 인증 메일 발송 한도를 넘었어요 / 발송에 실패했어요 | 기본 메일은 시간당 발송 수가 매우 적습니다. SMTP 연결 필요 |
| 지금은 회원가입이 꺼져 있어요 | **Authentication → Sign In / Providers** 에서 **Allow new users to sign up** 켜기 |
| 메일의 인증 링크가 localhost 로 열림 | **Authentication → URL Configuration** 의 **Site URL** 을 Vercel 주소로 바꾸고 Redirect URLs 에도 추가 |
| Supabase 설정이 필요해요 (화면 전체) | `supabase/schema.sql` 을 SQL Editor 에서 실행 |

## 보안 구조

- 브라우저는 **공개키**로 Supabase 에 접속하고, 테이블에 직접 쓰는 것은 **모두 막혀 있습니다** (RLS).
- 프로필 저장 · 쪽지 · 채팅 · 차단 · 신고 같은 모든 동작은 `schema.sql` 의 **함수(RPC)** 로만 가능하며, 함수 안에서 로그인 여부 · 약관 동의 · 정지 여부 · 차단 관계 · 입력값을 검사합니다.
- 다른 회원의 **정확한 좌표는 조회할 수 없고**, 약 300m 범위로 흐린 위치와 거리만 받습니다.
- 사진은 `avatars` 저장소의 **본인 폴더**에만 올릴 수 있습니다.

## 기능

- **회원가입/로그인** – Supabase Auth (이메일 인증 · 비밀번호 bcrypt · 로그인 시도 제한). (선택) 카카오·구글 소셜 로그인
- **동네 인증** – GPS(정확도 1km 이내) → 지도 API 로 동네 이름 변환, 30일 유효
- **헬스 프로필** – 사진, 닉네임, 성별, 나이, 헬스 구력, 3대 1RM(합계 자동), 헬스장, 운동 요일·시간대, 자기소개, 공개 여부
- **원하는 헬스메이트 조건** – 성별, 나이 범위, 3대 합계 최소, 기타 → `✅ 내 조건에 맞음` / `🤝 서로 조건 맞음` / `🏢 같은 헬스장` / `📅 겹치는 요일` 표시
- **동네 탐색** – 지도 + 목록, 반경 · 성별 · 3대 합계 · 요일 · 조건 필터
- **쪽지** – 수락 시 1:1 채팅 개설, 중복 방지, 하루 20통 제한
- **1:1 채팅** – Supabase Realtime 실시간 메시지 · 읽음 표시 · 입력 중 표시 (실시간 연결이 안 되면 4초마다 자동 확인)
- **신고 · 차단** – 신고 사유 + 채팅 증거 첨부, 차단 시 서로 숨김, 30일 내 3명 신고 시 자동 정지, 관리자 신고 관리 화면
- **약관 · 개인정보** – 가입 시 필수 동의(만 14세 이상 포함), 약관 변경 시 재동의, 회원 탈퇴(즉시 삭제), 내 정보 내려받기, 비밀번호 변경, 위치 이용 기록 6개월 보관

> ⚠️ **출시 전 꼭 확인하세요**
> - 약관·개인정보처리방침은 **템플릿**입니다. 실제 운영 형태에 맞게 법률 전문가 검토를 받으세요. (`[... 미설정]` 으로 빨갛게 보이는 곳 채우기)
> - 위치정보를 이용하는 서비스는 **위치기반서비스사업 신고**(방송통신위원회) 대상일 수 있습니다.
> - Supabase **이메일 발송(SMTP)** 을 실제 서비스용으로 연결하세요.
