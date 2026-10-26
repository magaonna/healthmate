const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'healthmate.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL DEFAULT 'email', -- kakao | google | email(개발용)
  provider_id   TEXT,                          -- 카카오 회원번호 / 구글 sub
  email         TEXT UNIQUE,                   -- email 계정만 사용 (소셜 계정은 NULL)
  password_hash TEXT,                          -- email 계정만 사용
  nickname      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gender         TEXT,             -- male | female
  age            INTEGER,
  career         TEXT,             -- 헬스 구력: 6개월 미만 | 6개월~1년 | ...
  bench          INTEGER,          -- 3대 1RM (kg)
  squat          INTEGER,
  deadlift       INTEGER,
  gym_name       TEXT,
  workout_days   TEXT,             -- 쉼표로 구분: 월,수,금
  workout_times  TEXT,             -- 쉼표로 구분: 저녁,밤
  bio            TEXT,
  -- 원하는 헬스메이트 조건
  pref_gender    TEXT,             -- male | female | NULL(무관)
  pref_age_min   INTEGER,
  pref_age_max   INTEGER,
  pref_min_total INTEGER,          -- 3대 합계 최소 (kg)
  pref_note      TEXT,             -- 그 밖의 조건 (자유 입력)
  photo          TEXT,
  is_public      INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 동네 인증 정보 (정확한 좌표는 서버에만 저장, 다른 유저에게는 근사 좌표만 노출)
CREATE TABLE IF NOT EXISTS locations (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  region      TEXT NOT NULL,      -- 예: 역삼동
  district    TEXT,               -- 예: 서울특별시 강남구
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 쪽지: 첫 연락 수단. 수락되면 채팅방이 생성된다.
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  room_id    INTEGER REFERENCES rooms(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_to ON notes(to_id, status);
CREATE INDEX IF NOT EXISTS idx_notes_from ON notes(from_id);

-- 1:1 채팅방 (user_a < user_b 로 정규화)
CREATE TABLE IF NOT EXISTS rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);
`);

// 이전 버전 DB: users 테이블에 소셜 로그인 컬럼이 없으면 테이블을 다시 만든다 (NOT NULL 제약 변경은 재생성만 가능)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'provider')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE users_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT NOT NULL DEFAULT 'email',
      provider_id   TEXT,
      email         TEXT UNIQUE,
      password_hash TEXT,
      nickname      TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, provider_id)
    );
    INSERT INTO users_new (id, provider, email, password_hash, nickname, created_at)
      SELECT id, 'email', email, password_hash, nickname, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;
    PRAGMA foreign_keys = ON;`);
}

// 이전 버전 DB에 없는 프로필 컬럼 추가
const profileCols = new Set(db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name));
for (const [col, type] of [
  ['age', 'INTEGER'], ['career', 'TEXT'], ['bench', 'INTEGER'], ['squat', 'INTEGER'], ['deadlift', 'INTEGER'],
  ['workout_days', 'TEXT'], ['workout_times', 'TEXT'], ['pref_gender', 'TEXT'], ['pref_age_min', 'INTEGER'],
  ['pref_age_max', 'INTEGER'], ['pref_min_total', 'INTEGER'], ['pref_note', 'TEXT'],
]) {
  if (!profileCols.has(col)) db.exec(`ALTER TABLE profiles ADD COLUMN ${col} ${type}`);
}

module.exports = { db, DATA_DIR };
