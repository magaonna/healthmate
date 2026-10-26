const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const { db, DATA_DIR } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const VERIFY_VALID_DAYS = 30;          // 동네 인증 유효기간
const DEFAULT_RADIUS_KM = 3;
const MAX_RADIUS_KM = 10;
const MAX_GPS_ACCURACY_M = 1000;       // 이보다 부정확한 위치는 인증 거부
const ALLOW_MANUAL_LOCATION = process.env.ALLOW_MANUAL_LOCATION === 'true'; // 개발용: 지도 클릭으로 위치 지정 허용
const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY || '';
const ALLOW_EMAIL_LOGIN = process.env.ALLOW_EMAIL_LOGIN === 'true';     // 개발용: 이메일 회원가입/로그인 허용 (데모 계정)
const KAKAO_JS_KEY = process.env.KAKAO_JS_KEY || ''; // 카카오맵 JavaScript 키 (브라우저에 노출되는 키, 카카오 콘솔에서 도메인 제한)

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
})();

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const TIMES = ['새벽', '오전', '점심', '오후', '저녁', '밤'];
const CAREERS = ['6개월 미만', '6개월~1년', '1~2년', '2~3년', '3~5년', '5년 이상'];
const GENDERS = ['male', 'female'];
const AGE_MIN = 14;
const AGE_MAX = 99;
const MAX_1RM_KG = 500;

// ---------------------------------------------------------------- helpers

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 다른 유저에게 정확한 위치를 노출하지 않도록 약 300m 격자에 맞추고, 유저별 고정 오프셋을 더한다.
function approximate(lat, lng, userId) {
  const grid = 0.003;
  const h = crypto.createHash('sha256').update(`${userId}:${JWT_SECRET}`).digest();
  const offLat = (h[0] / 255 - 0.5) * grid * 0.8;
  const offLng = (h[1] / 255 - 0.5) * grid * 0.8;
  return {
    lat: Math.round(lat / grid) * grid + offLat,
    lng: Math.round(lng / grid) * grid + offLng,
  };
}

function isVerified(loc) {
  if (!loc) return false;
  const verified = new Date(loc.verified_at.replace(' ', 'T') + 'Z');
  return Date.now() - verified.getTime() < VERIFY_VALID_DAYS * 86400 * 1000;
}

async function reverseGeocode(lat, lng) {
  // 1순위: 카카오 로컬 API (행정동 단위, 키가 있을 때)
  if (KAKAO_REST_KEY) {
    try {
      const r = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const j = await r.json();
        const doc = j.documents.find((d) => d.region_type === 'H') || j.documents[0];
        if (doc) return { region: doc.region_3depth_name || doc.region_2depth_name, district: `${doc.region_1depth_name} ${doc.region_2depth_name}`.trim() };
      }
    } catch (e) { console.warn('kakao reverse geocode failed:', e.message); }
  }
  // 2순위: OpenStreetMap Nominatim
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=ko`, {
      headers: { 'User-Agent': 'healthmate-local/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const a = (await r.json()).address || {};
      const region = a.quarter || a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.borough;
      const district = [a.city || a.province || a.state, a.borough || a.city_district || a.county].filter(Boolean).join(' ');
      if (region) return { region, district };
    }
  } catch (e) { console.warn('nominatim reverse geocode failed:', e.message); }
  return null;
}

const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = (v, allowed) => (allowed.includes(v) ? v : null);

const splitList = (s, allowed) => (s ? s.split(',').filter((v) => allowed.includes(v)) : []);

// 3대 합계: 세 종목을 모두 입력했을 때만 계산
function totalOf(row) {
  return row.bench != null && row.squat != null && row.deadlift != null ? row.bench + row.squat + row.deadlift : null;
}

// candidate 가 owner 가 원하는 헬스메이트 조건을 만족하는지
function meetsPrefs(candidate, owner) {
  if (owner.pref_gender && candidate.gender !== owner.pref_gender) return false;
  if (owner.pref_age_min != null && !(candidate.age >= owner.pref_age_min)) return false;
  if (owner.pref_age_max != null && !(candidate.age <= owner.pref_age_max)) return false;
  if (owner.pref_min_total != null && !(totalOf(candidate) >= owner.pref_min_total)) return false;
  return true;
}

// viewer: 보는 사람의 userWithProfile 행 (거리·조건 일치 여부 계산용)
function publicUser(row, viewer) {
  const out = {
    id: row.id,
    nickname: row.nickname,
    gender: row.gender,
    age: row.age,
    career: row.career,
    bench: row.bench,
    squat: row.squat,
    deadlift: row.deadlift,
    total: totalOf(row),
    gymName: row.gym_name || '',
    workoutDays: splitList(row.workout_days, DAYS),
    workoutTimes: splitList(row.workout_times, TIMES),
    bio: row.bio || '',
    prefs: {
      gender: row.pref_gender,
      ageMin: row.pref_age_min,
      ageMax: row.pref_age_max,
      minTotal: row.pref_min_total,
      note: row.pref_note || '',
    },
    photo: row.photo ? `/uploads/${row.photo}` : null,
    region: row.region || null,
  };
  if (row.lat != null) {
    Object.assign(out, approximate(row.lat, row.lng, row.id));
    if (viewer?.lat != null) out.distanceKm = Math.round(haversineKm(viewer.lat, viewer.lng, row.lat, row.lng) * 10) / 10;
  }
  if (viewer && viewer.id !== row.id) {
    out.meetsMyPrefs = meetsPrefs(row, viewer);     // 상대가 내 조건에 맞는지
    out.iMeetTheirPrefs = meetsPrefs(viewer, row);  // 내가 상대 조건에 맞는지
    out.sameGym = !!(row.gym_name && viewer.gym_name && row.gym_name.replace(/\s/g, '') === viewer.gym_name.replace(/\s/g, ''));
    out.commonDays = out.workoutDays.filter((d) => splitList(viewer.workout_days, DAYS).includes(d));
  }
  return out;
}

const getLocation = (userId) => db.prepare('SELECT * FROM locations WHERE user_id = ?').get(userId);
const userWithProfile = db.prepare(`
  SELECT u.id, u.nickname, p.*, l.lat, l.lng, l.region, l.verified_at
  FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id
  LEFT JOIN locations l ON l.user_id = u.id
  WHERE u.id = ?`);

function roomFor(a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return db.prepare('SELECT * FROM rooms WHERE user_a = ? AND user_b = ?').get(x, y);
}

// ---------------------------------------------------------------- app

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist'), { maxAge: '30d' }));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'uploads'),
    filename: (req, file, cb) => cb(null, `${req.user.id}-${Date.now()}${{ 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400 * 1000 };

function issueToken(res, userId) {
  res.cookie('token', jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '30d' }), COOKIE_OPTS);
}

function auth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.token || '', JWT_SECRET);
    const user = db.prepare('SELECT id, provider, email, nickname FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: '로그인이 필요합니다.' });
  }
}

function requireVerified(req, res, next) {
  const loc = getLocation(req.user.id);
  if (!isVerified(loc)) return res.status(403).json({ error: '동네 인증이 필요합니다.', code: 'NEED_VERIFY' });
  req.loc = loc;
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- 소셜 로그인 (카카오 · 구글, OAuth 2.0 authorization code)

const OAUTH = {
  kakao: {
    clientId: KAKAO_REST_KEY,
    clientSecret: process.env.KAKAO_CLIENT_SECRET || '', // 카카오 콘솔에서 Client Secret 을 켰을 때만
    authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    scope: '',
    async profile(accessToken) {
      const me = await fetchJson('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      return { id: String(me.id), nickname: me.kakao_account?.profile?.nickname || me.properties?.nickname };
    },
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
    extraParams: { prompt: 'select_account' },
    async profile(accessToken) {
      const me = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
      return { id: String(me.sub), nickname: me.given_name || me.name };
    },
  },
};
const enabledProviders = () => Object.keys(OAUTH).filter((p) => OAUTH[p].clientId && (p !== 'google' || OAUTH[p].clientSecret));
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const callbackUrl = (provider) => `${BASE_URL}/auth/${provider}/callback`;

async function fetchJson(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}

app.get('/auth/:provider', (req, res) => {
  const provider = req.params.provider;
  if (!enabledProviders().includes(provider)) return res.redirect('/?auth_error=disabled#/login');
  const cfg = OAUTH[provider];
  const state = crypto.randomBytes(16).toString('hex');
  // CSRF 방지: state 를 쿠키에 저장해 두고 콜백에서 비교
  res.cookie(`oauth_state_${provider}`, state, { httpOnly: true, sameSite: 'lax', secure: COOKIE_OPTS.secure, maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: callbackUrl(provider), response_type: 'code', state, ...cfg.extraParams });
  if (cfg.scope) params.set('scope', cfg.scope);
  res.redirect(`${cfg.authorizeUrl}?${params}`);
});

app.get('/auth/:provider/callback', wrap(async (req, res) => {
  const provider = req.params.provider;
  if (!enabledProviders().includes(provider)) return res.redirect('/?auth_error=disabled#/login');
  const cfg = OAUTH[provider];
  const expected = req.cookies[`oauth_state_${provider}`];
  res.clearCookie(`oauth_state_${provider}`);
  if (req.query.error) return res.redirect('/?auth_error=cancelled#/login');        // 사용자가 동의 화면에서 취소
  if (!expected || req.query.state !== expected || !req.query.code) return res.redirect('/?auth_error=state#/login');

  let profile;
  try {
    const token = await fetchJson(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: cfg.clientId, redirect_uri: callbackUrl(provider), code: String(req.query.code),
        ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
      }),
    });
    profile = await cfg.profile(token.access_token);
  } catch (e) {
    console.error(`${provider} login failed:`, e.message);
    return res.redirect('/?auth_error=provider#/login');
  }

  let user = db.prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?').get(provider, profile.id);
  let isNew = false;
  if (!user) {
    const nickname = clean(profile.nickname || '', 20).length >= 2 ? clean(profile.nickname, 20) : `헬스메이트${crypto.randomInt(1000, 10000)}`;
    const { lastInsertRowid } = db.prepare('INSERT INTO users (provider, provider_id, nickname) VALUES (?, ?, ?)').run(provider, profile.id, nickname);
    db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(lastInsertRowid);
    user = { id: Number(lastInsertRowid) };
    isNew = true;
  }
  issueToken(res, user.id);
  res.redirect(isNew ? '/#/welcome' : '/#/');
}));

// ---- 이메일 로그인 (개발·테스트용, ALLOW_EMAIL_LOGIN=true 일 때만)

function emailLoginOnly(req, res, next) {
  if (!ALLOW_EMAIL_LOGIN) return res.status(404).json({ error: '이메일 로그인은 지원하지 않습니다. 카카오 또는 구글로 로그인해 주세요.' });
  next();
}

app.post('/api/auth/signup', emailLoginOnly, wrap(async (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nickname = clean(req.body.nickname, 20);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '올바른 이메일을 입력해 주세요.' });
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
  if (nickname.length < 2) return res.status(400).json({ error: '닉네임은 2자 이상이어야 합니다.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });

  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)').run(email, hash, nickname);
  db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(lastInsertRowid);
  issueToken(res, Number(lastInsertRowid));
  res.json({ ok: true });
}));

app.post('/api/auth/login', emailLoginOnly, wrap(async (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user?.password_hash || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  issueToken(res, user.id);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    days: DAYS, times: TIMES, careers: CAREERS, ageMin: AGE_MIN, ageMax: AGE_MAX, max1rm: MAX_1RM_KG,
    allowManualLocation: ALLOW_MANUAL_LOCATION, verifyValidDays: VERIFY_VALID_DAYS, kakaoJsKey: KAKAO_JS_KEY,
    loginProviders: enabledProviders(), allowEmailLogin: ALLOW_EMAIL_LOGIN,
  });
});

app.get('/api/me', auth, (req, res) => {
  const row = userWithProfile.get(req.user.id);
  const loc = getLocation(req.user.id);
  const me = publicUser(row, row);
  // 본인에게는 정확한 좌표를 돌려준다
  if (loc) { me.lat = loc.lat; me.lng = loc.lng; }
  res.json({
    ...me,
    email: req.user.email,
    provider: req.user.provider,
    isPublic: !!row.is_public,
    location: loc ? { region: loc.region, district: loc.district, verifiedAt: loc.verified_at, verified: isVerified(loc) } : null,
    profileComplete: !!(row.gender && row.age && row.career && row.workout_days),
  });
});

app.put('/api/me/nickname', auth, (req, res) => {
  const nickname = clean(req.body.nickname, 20);
  if (nickname.length < 2) return res.status(400).json({ error: '닉네임은 2~20자로 입력해 주세요.' });
  db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.user.id);
  res.json({ ok: true });
});

// ---- 동네 인증

app.post('/api/location/verify', auth, wrap(async (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const accuracy = Number(req.body.accuracy);
  const manual = req.body.manual === true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: '위치 정보가 올바르지 않습니다.' });
  }
  if (manual && !ALLOW_MANUAL_LOCATION) return res.status(400).json({ error: '수동 위치 지정은 허용되지 않습니다. GPS로 인증해 주세요.' });
  if (!manual && (!Number.isFinite(accuracy) || accuracy > MAX_GPS_ACCURACY_M)) {
    return res.status(400).json({ error: `위치 정확도가 너무 낮습니다(${Math.round(accuracy) || '?'}m). 실외에서 다시 시도해 주세요.` });
  }

  const geo = await reverseGeocode(lat, lng);
  const region = geo?.region || `${lat.toFixed(3)}, ${lng.toFixed(3)} 부근`;
  const district = geo?.district || '';
  db.prepare(`
    INSERT INTO locations (user_id, lat, lng, region, district, verified_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, region = excluded.region,
      district = excluded.district, verified_at = excluded.verified_at`).run(req.user.id, lat, lng, region, district);
  res.json({ ok: true, region, district });
}));

// ---- 프로필

// 빈 값은 null, 범위를 벗어나면 에러 메시지를 errors 에 담는다
function optInt(v, min, max, label, errors) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label}: ${min}~${max} 사이 숫자로 입력해 주세요.`); return null; }
  return n;
}
const listOf = (v, allowed) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => x.trim()).filter((x) => allowed.includes(x));

app.put('/api/profile', auth, upload.single('photo'), (req, res) => {
  const b = req.body;
  const nickname = clean(b.nickname, 20);
  const errors = [];
  const age = optInt(b.age, AGE_MIN, AGE_MAX, '나이', errors);
  const bench = optInt(b.bench, 0, MAX_1RM_KG, '벤치프레스 1RM', errors);
  const squat = optInt(b.squat, 0, MAX_1RM_KG, '스쿼트 1RM', errors);
  const deadlift = optInt(b.deadlift, 0, MAX_1RM_KG, '데드리프트 1RM', errors);
  const prefAgeMin = optInt(b.prefAgeMin, AGE_MIN, AGE_MAX, '원하는 최소 나이', errors);
  const prefAgeMax = optInt(b.prefAgeMax, AGE_MIN, AGE_MAX, '원하는 최대 나이', errors);
  const prefMinTotal = optInt(b.prefMinTotal, 0, MAX_1RM_KG * 3, '원하는 3대 합계', errors);
  if (prefAgeMin != null && prefAgeMax != null && prefAgeMin > prefAgeMax) errors.push('원하는 나이의 최소값이 최대값보다 클 수 없어요.');
  if (errors.length) {
    if (req.file) fs.rm(req.file.path, () => {});
    return res.status(400).json({ error: errors[0] });
  }

  const prev = db.prepare('SELECT photo FROM profiles WHERE user_id = ?').get(req.user.id);
  let photo = prev?.photo || null;
  if (req.file) {
    if (photo) fs.rm(path.join(DATA_DIR, 'uploads', photo), () => {});
    photo = req.file.filename;
  } else if (b.removePhoto === 'true' && photo) {
    fs.rm(path.join(DATA_DIR, 'uploads', photo), () => {});
    photo = null;
  }

  if (nickname.length >= 2) db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.user.id);
  db.prepare(`
    INSERT INTO profiles (user_id, gender, age, career, bench, squat, deadlift, gym_name, workout_days, workout_times, bio,
      pref_gender, pref_age_min, pref_age_max, pref_min_total, pref_note, photo, is_public, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET gender = excluded.gender, age = excluded.age, career = excluded.career,
      bench = excluded.bench, squat = excluded.squat, deadlift = excluded.deadlift, gym_name = excluded.gym_name,
      workout_days = excluded.workout_days, workout_times = excluded.workout_times, bio = excluded.bio,
      pref_gender = excluded.pref_gender, pref_age_min = excluded.pref_age_min, pref_age_max = excluded.pref_age_max,
      pref_min_total = excluded.pref_min_total, pref_note = excluded.pref_note,
      photo = excluded.photo, is_public = excluded.is_public, updated_at = excluded.updated_at`).run(
    req.user.id,
    pick(b.gender, GENDERS), age, pick(b.career, CAREERS), bench, squat, deadlift, clean(b.gymName, 50),
    DAYS.filter((d) => listOf(b.workoutDays, DAYS).includes(d)).join(','),
    TIMES.filter((t) => listOf(b.workoutTimes, TIMES).includes(t)).join(','),
    clean(b.bio, 500),
    pick(b.prefGender, GENDERS), prefAgeMin, prefAgeMax, prefMinTotal, clean(b.prefNote, 200),
    photo, b.isPublic === 'false' ? 0 : 1,
  );
  res.json({ ok: true });
});

app.get('/api/profiles/nearby', auth, requireVerified, (req, res) => {
  const radius = Math.min(Math.max(Number(req.query.radius) || DEFAULT_RADIUS_KM, 0.5), MAX_RADIUS_KM);
  const { lat, lng } = req.loc;
  const dLat = radius / 111;
  const dLng = radius / (111 * Math.cos((lat * Math.PI) / 180));
  const rows = db.prepare(`
    SELECT u.id, u.nickname, p.*, l.lat, l.lng, l.region, l.verified_at
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    JOIN locations l ON l.user_id = u.id
    WHERE u.id != ? AND p.is_public = 1
      AND l.verified_at > datetime('now', ?)
      AND l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?`).all(
    req.user.id, `-${VERIFY_VALID_DAYS} days`, lat - dLat, lat + dLat, lng - dLng, lng + dLng);

  const viewer = userWithProfile.get(req.user.id);
  const list = rows
    .filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radius)
    .map((r) => publicUser(r, viewer))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  res.json({ radius, center: approximate(lat, lng, req.user.id), region: req.loc.region, users: list });
});

app.get('/api/profiles/:id', auth, requireVerified, (req, res) => {
  const row = userWithProfile.get(Number(req.params.id));
  if (!row || (!row.is_public && row.id !== req.user.id)) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });
  const user = publicUser(row, userWithProfile.get(req.user.id));
  const room = roomFor(req.user.id, row.id);
  const pending = db.prepare(`SELECT id FROM notes WHERE from_id = ? AND to_id = ? AND status = 'pending'`).get(req.user.id, row.id);
  res.json({ ...user, roomId: room?.id || null, pendingNote: !!pending });
});

// ---- 쪽지

app.post('/api/notes', auth, requireVerified, (req, res) => {
  const toId = Number(req.body.toId);
  const content = clean(req.body.content, 300);
  if (!content) return res.status(400).json({ error: '쪽지 내용을 입력해 주세요.' });
  if (toId === req.user.id) return res.status(400).json({ error: '자기 자신에게는 보낼 수 없습니다.' });
  const target = db.prepare('SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? AND p.is_public = 1').get(toId);
  if (!target) return res.status(404).json({ error: '상대방을 찾을 수 없습니다.' });

  const room = roomFor(req.user.id, toId);
  if (room) return res.status(409).json({ error: '이미 채팅 중인 상대입니다.', roomId: room.id });
  if (db.prepare(`SELECT 1 FROM notes WHERE from_id = ? AND to_id = ? AND status = 'pending'`).get(req.user.id, toId)) {
    return res.status(409).json({ error: '이미 보낸 쪽지가 답변을 기다리고 있습니다.' });
  }
  const recent = db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE from_id = ? AND created_at > datetime('now', '-1 day')`).get(req.user.id).c;
  if (recent >= 20) return res.status(429).json({ error: '하루에 보낼 수 있는 쪽지 수(20개)를 초과했습니다.' });

  const { lastInsertRowid } = db.prepare('INSERT INTO notes (from_id, to_id, content) VALUES (?, ?, ?)').run(req.user.id, toId, content);
  io.to(`user:${toId}`).emit('note:new', { id: Number(lastInsertRowid), from: req.user.nickname });
  res.json({ ok: true, id: Number(lastInsertRowid) });
});

app.get('/api/notes', auth, (req, res) => {
  const sent = req.query.box === 'sent';
  const rows = db.prepare(`
    SELECT n.*, u.nickname, p.photo, l.region
    FROM notes n
    JOIN users u ON u.id = ${sent ? 'n.to_id' : 'n.from_id'}
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN locations l ON l.user_id = u.id
    WHERE ${sent ? 'n.from_id' : 'n.to_id'} = ?
    ORDER BY n.id DESC LIMIT 100`).all(req.user.id);
  if (!sent) db.prepare('UPDATE notes SET read_at = datetime(\'now\') WHERE to_id = ? AND read_at IS NULL').run(req.user.id);
  res.json(rows.map((n) => ({
    id: n.id, content: n.content, status: n.status, roomId: n.room_id, createdAt: n.created_at,
    other: { id: sent ? n.to_id : n.from_id, nickname: n.nickname, photo: n.photo ? `/uploads/${n.photo}` : null, region: n.region },
  })));
});

function getOwnPendingNote(req, res) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND to_id = ?').get(Number(req.params.id), req.user.id);
  if (!note) { res.status(404).json({ error: '쪽지를 찾을 수 없습니다.' }); return null; }
  if (note.status !== 'pending') { res.status(409).json({ error: '이미 처리된 쪽지입니다.', roomId: note.room_id }); return null; }
  return note;
}

app.post('/api/notes/:id/accept', auth, (req, res) => {
  const note = getOwnPendingNote(req, res);
  if (!note) return;
  const [a, b] = note.from_id < note.to_id ? [note.from_id, note.to_id] : [note.to_id, note.from_id];
  db.prepare('INSERT OR IGNORE INTO rooms (user_a, user_b) VALUES (?, ?)').run(a, b);
  const room = roomFor(a, b);
  // 쪽지 내용을 채팅방의 첫 메시지로 옮긴다
  db.prepare('INSERT INTO messages (room_id, sender_id, content, created_at) VALUES (?, ?, ?, ?)').run(room.id, note.from_id, note.content, note.created_at);
  db.prepare(`UPDATE notes SET status = 'accepted', room_id = ? WHERE id = ?`).run(room.id, note.id);
  // 서로 주고받은 다른 대기 쪽지도 함께 정리
  db.prepare(`UPDATE notes SET status = 'accepted', room_id = ? WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`)
    .run(room.id, note.from_id, note.to_id, note.to_id, note.from_id);
  io.to(`user:${note.from_id}`).emit('note:accepted', { roomId: room.id, by: req.user.nickname });
  res.json({ ok: true, roomId: room.id });
});

app.post('/api/notes/:id/decline', auth, (req, res) => {
  const note = getOwnPendingNote(req, res);
  if (!note) return;
  db.prepare(`UPDATE notes SET status = 'declined' WHERE id = ?`).run(note.id);
  res.json({ ok: true });
});

// ---- 채팅

function getRoomForUser(roomId, userId) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room || (room.user_a !== userId && room.user_b !== userId)) return null;
  room.otherId = room.user_a === userId ? room.user_b : room.user_a;
  return room;
}

app.get('/api/rooms', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, u.id AS other_id, u.nickname, p.photo, l.region,
      (SELECT content FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND sender_id != ? AND read_at IS NULL) AS unread
    FROM rooms r
    JOIN users u ON u.id = CASE WHEN r.user_a = ? THEN r.user_b ELSE r.user_a END
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN locations l ON l.user_id = u.id
    WHERE r.user_a = ? OR r.user_b = ?
    ORDER BY COALESCE(last_at, r.created_at) DESC`).all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(rows.map((r) => ({
    id: r.id, lastMessage: r.last_message, lastAt: r.last_at, unread: r.unread,
    other: { id: r.other_id, nickname: r.nickname, photo: r.photo ? `/uploads/${r.photo}` : null, region: r.region },
  })));
});

app.get('/api/rooms/:id/messages', auth, (req, res) => {
  const room = getRoomForUser(Number(req.params.id), req.user.id);
  if (!room) return res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const messages = db.prepare(`
    SELECT id, sender_id AS senderId, content, created_at AS createdAt, read_at AS readAt
    FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT 50`).all(room.id, before).reverse();
  markRead(room, req.user.id);
  const other = userWithProfile.get(room.otherId);
  res.json({ room: { id: room.id, other: publicUser(other) }, messages });
});

function markRead(room, userId) {
  const { changes } = db.prepare(`UPDATE messages SET read_at = datetime('now') WHERE room_id = ? AND sender_id != ? AND read_at IS NULL`).run(room.id, userId);
  if (changes) io.to(`user:${room.otherId}`).emit('chat:read', { roomId: room.id });
}

app.get('/api/badges', auth, (req, res) => {
  const notes = db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE to_id = ? AND status = 'pending' AND read_at IS NULL`).get(req.user.id).c;
  const chats = db.prepare(`
    SELECT COUNT(*) AS c FROM messages m JOIN rooms r ON r.id = m.room_id
    WHERE (r.user_a = ? OR r.user_b = ?) AND m.sender_id != ? AND m.read_at IS NULL`).get(req.user.id, req.user.id, req.user.id).c;
  res.json({ notes, chats });
});

// SPA fallback
app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: '사진은 5MB 이하만 올릴 수 있습니다.' });
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ---------------------------------------------------------------- socket.io (실시간 채팅)

const server = http.createServer(app);
const io = new Server(server);

io.use((socket, next) => {
  const cookies = Object.fromEntries((socket.handshake.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
  try {
    socket.userId = jwt.verify(cookies.token || '', JWT_SECRET).uid;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);

  socket.on('chat:send', ({ roomId, content } = {}, ack = () => {}) => {
    const room = getRoomForUser(Number(roomId), socket.userId);
    const text = clean(content, 1000);
    if (!room) return ack({ error: '채팅방을 찾을 수 없습니다.' });
    if (!text) return ack({ error: '메시지를 입력해 주세요.' });
    const { lastInsertRowid } = db.prepare('INSERT INTO messages (room_id, sender_id, content) VALUES (?, ?, ?)').run(room.id, socket.userId, text);
    const msg = db.prepare('SELECT id, room_id AS roomId, sender_id AS senderId, content, created_at AS createdAt, read_at AS readAt FROM messages WHERE id = ?').get(lastInsertRowid);
    io.to(`user:${room.user_a}`).to(`user:${room.user_b}`).emit('chat:message', msg);
    ack({ ok: true, message: msg });
  });

  socket.on('chat:read', ({ roomId } = {}) => {
    const room = getRoomForUser(Number(roomId), socket.userId);
    if (room) markRead(room, socket.userId);
  });

  socket.on('chat:typing', ({ roomId } = {}) => {
    const room = getRoomForUser(Number(roomId), socket.userId);
    if (room) io.to(`user:${room.otherId}`).emit('chat:typing', { roomId: room.id });
  });
});

server.listen(PORT, () => {
  console.log(`🏋️  동네 헬스메이트 running at http://localhost:${PORT}`);
  if (ALLOW_MANUAL_LOCATION) console.log('   (개발 모드: 지도 클릭으로 동네 인증 허용)');
  if (ALLOW_EMAIL_LOGIN) console.log('   (개발 모드: 이메일 회원가입/로그인 허용)');
  const providers = enabledProviders();
  console.log(`   소셜 로그인: ${providers.length ? providers.join(', ') : '없음 (KAKAO_REST_KEY / GOOGLE_CLIENT_ID·SECRET 설정 필요)'}`);
  providers.forEach((p) => console.log(`     ${p} Redirect URI: ${callbackUrl(p)}`));
});
