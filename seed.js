// 데모 데이터: 강남역 주변에 헬스메이트 8명을 생성한다. (비밀번호: test1234)
// 사용법: npm run seed  [-- 위도 경도 동네이름]
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const [lat0 = 37.4979, lng0 = 127.0276, region = '역삼동'] = process.argv.slice(2).map((v, i) => (i < 2 ? Number(v) : v));
const hash = bcrypt.hashSync('test1234', 10);

const people = [
  ['근육곰', 'male', '30대', '웨이트,크로스핏', '저녁', '고급', '3대 450. 하체 같이 조지실 분 구해요. 자세 봐드릴 수 있어요!'],
  ['아침형인간', 'female', '20대', '러닝,요가', '새벽', '중급', '출근 전 6시에 양재천 5km 같이 뛰어요 🏃‍♀️'],
  ['헬린이탈출', 'male', '20대', '웨이트', '저녁', '입문', '헬스 시작한 지 한 달! 같이 성장할 메이트 찾아요.'],
  ['필라덕후', 'female', '30대', '필라테스,요가', '오전', '중급', '주말 오전에 같이 운동하고 브런치 하실 분~'],
  ['클라이머K', 'male', '30대', '클라이밍,등산', '밤', '중급', '퇴근 후 볼더링 같이 가요. 주말엔 등산도 좋아요.'],
  ['수영하는곰돌이', 'other', '40대', '수영,자전거', '오전', '초급', '자유형 연습 중입니다. 같이 수영장 다녀요.'],
  ['데드리프트장인', 'female', '20대', '웨이트,홈트', '오후', '고급', '여성 웨이트 메이트 구해요. 등/하체 분할합니다.'],
  ['한강라이더', 'male', '40대', '자전거,러닝', '저녁', '중급', '주 2회 한강 라이딩 40km. 초보도 환영!'],
];

people.forEach(([nickname, gender, age, workouts, time, level, bio], i) => {
  const email = `demo${i + 1}@healthmate.local`;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  const { lastInsertRowid: id } = db.prepare('INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)').run(email, hash, nickname);
  db.prepare(`INSERT INTO profiles (user_id, gender, age_group, bio, workouts, preferred_time, level, gym_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, gender, age, bio, workouts, time, level, `${region} 피트니스`);
  const angle = (i / people.length) * Math.PI * 2;
  const dist = 0.004 + (i % 4) * 0.005; // 약 0.4 ~ 2km
  db.prepare('INSERT INTO locations (user_id, lat, lng, region, district) VALUES (?, ?, ?, ?, ?)')
    .run(id, lat0 + Math.sin(angle) * dist, lng0 + Math.cos(angle) * dist, region, '');
});
console.log(`✅ 데모 유저 ${people.length}명 생성 완료 (demo1~${people.length}@healthmate.local / test1234)`);
