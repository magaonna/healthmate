// 데모 데이터: 강남역 주변에 헬스메이트 8명을 생성한다. (비밀번호: test1234)
// 사용법: npm run seed  [-- 위도 경도 동네이름]
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const [lat0 = 37.4979, lng0 = 127.0276, region = '역삼동'] = process.argv.slice(2).map((v, i) => (i < 2 ? Number(v) : v));
const hash = bcrypt.hashSync('test1234', 10);

// [닉네임, 성별, 나이, 구력, 벤치, 스쿼트, 데드, 헬스장, 요일, 시간대, 소개, 원하는 성별, 최소나이, 최대나이, 3대 최소, 기타 조건]
const people = [
  ['근육곰', 'male', 32, '5년 이상', 140, 180, 210, '역삼 짐박스', '월,수,금', '저녁', '하체 같이 조지실 분 구해요. 자세 봐드릴 수 있어요!', 'male', 20, 40, 400, '스팟 가능하신 분'],
  ['아침형헬스인', 'female', 27, '1~2년', 45, 80, 100, '강남 스포애니', '화,목,토', '새벽,오전', '출근 전 6시 운동파! 같이 꾸준히 나오실 분~', 'female', null, null, null, '새벽 운동 가능하신 분'],
  ['헬린이탈출', 'male', 24, '6개월 미만', 60, 80, 100, '역삼 짐박스', '월,화,수,목,금', '저녁,밤', '헬스 시작한 지 3개월! 같이 성장할 메이트 찾아요.', null, null, null, null, ''],
  ['스쿼트요정', 'female', 31, '3~5년', 55, 110, 120, '선릉 에이블짐', '월,수,토', '오전,점심', '하체 위주 루틴이에요. 주말 오전에 같이 하실 분!', null, 25, 40, 200, ''],
  ['벤치머신', 'male', 29, '2~3년', 130, 150, 180, '강남 스포애니', '화,목', '밤', '퇴근 후 밤 운동. 가슴/어깨 같이 하실 분 구해요.', 'male', null, null, 350, ''],
  ['꾸준히가자', 'male', 41, '1~2년', 80, 110, 140, '역삼 OO피트니스', '월,수,금,일', '오전', '오전 시간대 자유로운 자영업자입니다. 편하게 연락주세요.', null, 30, 50, null, ''],
  ['데드리프트장인', 'female', 26, '3~5년', 60, 120, 150, '선릉 에이블짐', '화,목,토', '오후,저녁', '여성 웨이트 메이트 구해요. 등/하체 분할합니다.', 'female', null, null, 250, '분할 루틴 하시는 분'],
  ['파워리프터J', 'male', 35, '5년 이상', 160, 220, 250, '역삼 짐박스', '월,화,목,금', '저녁', '파워리프팅 대회 준비 중. 고중량 같이 치실 분!', 'male', null, null, 500, '대회 준비하시는 분 환영'],
];

const insUser = db.prepare('INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)');
const insProfile = db.prepare(`INSERT INTO profiles (user_id, gender, age, career, bench, squat, deadlift, gym_name, workout_days, workout_times, bio,
  pref_gender, pref_age_min, pref_age_max, pref_min_total, pref_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insLoc = db.prepare('INSERT INTO locations (user_id, lat, lng, region, district) VALUES (?, ?, ?, ?, ?)');

people.forEach(([nickname, ...p], i) => {
  const email = `demo${i + 1}@healthmate.local`;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  const { lastInsertRowid: id } = insUser.run(email, hash, nickname);
  insProfile.run(id, ...p);
  const angle = (i / people.length) * Math.PI * 2;
  const dist = 0.004 + (i % 4) * 0.005; // 약 0.4 ~ 2km
  insLoc.run(id, lat0 + Math.sin(angle) * dist, lng0 + Math.cos(angle) * dist, region, '');
});
console.log(`✅ 데모 유저 ${people.length}명 생성 완료 (demo1~${people.length}@healthmate.local / test1234)`);
