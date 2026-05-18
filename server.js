require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'tabara-community-secret-2026';
const FIELD_KEY = crypto.scryptSync(process.env.FIELD_SECRET || 'cc-field-enc-2026-tabara', 'cc-salt-v1', 32);

const db = new Database(path.join(__dirname, 'tabara.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function encryptField(value) {
  if (value == null || value === '') return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', FIELD_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return 'enc:' + iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptField(value) {
  if (!value || !String(value).startsWith('enc:')) return value;
  try {
    const parts = String(value).slice(4).split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const enc = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', FIELD_KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch { return value; }
}

const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) if (now > rec.resetAt) loginAttempts.delete(ip);
}, 10 * 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const limit = 12;
  let rec = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + windowMs };
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > limit;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS camps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    admin_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    materials TEXT,
    duration TEXT,
    max_participants INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    vote_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(idea_id, user_id)
  );
`);

addColumn('users', 'full_name', 'TEXT');
addColumn('users', 'email', 'TEXT');
addColumn('users', 'phone', 'TEXT');
addColumn('users', 'camp_id', 'TEXT');
addColumn('users', 'camp_code', 'TEXT');
addColumn('ideas', 'camp_code', 'TEXT');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_camp_code ON users(camp_code);
  CREATE INDEX IF NOT EXISTS idx_ideas_camp_code ON ideas(camp_code);
  CREATE INDEX IF NOT EXISTS idx_votes_idea_user ON votes(idea_id, user_id);
`);

function ensureLegacyCampForExistingUsers() {
  const usersWithoutCamp = db.prepare("SELECT COUNT(*) AS c FROM users WHERE camp_code IS NULL OR camp_code = ''").get().c;
  if (!usersWithoutCamp) return;

  let camp = db.prepare('SELECT * FROM camps WHERE code = ?').get('GENERAL');
  if (!camp) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO camps(id, name, code) VALUES(?, ?, ?)').run(id, 'Tabara existenta', 'GENERAL');
    camp = { id, code: 'GENERAL' };
  }

  db.prepare("UPDATE users SET camp_id = ?, camp_code = ? WHERE camp_code IS NULL OR camp_code = ''")
    .run(camp.id, camp.code);
  db.prepare("UPDATE ideas SET camp_code = ? WHERE camp_code IS NULL OR camp_code = ''").run(camp.code);
}
ensureLegacyCampForExistingUsers();

app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'media')));

const generateId = () => crypto.randomUUID();

function normalizeCampCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '-');
}

function publicUserRow(user, camp) {
  return {
    id: user.id,
    name: user.name,
    full_name: decryptField(user.full_name),
    email: decryptField(user.email),
    phone: decryptField(user.phone),
    role: user.role,
    camp_code: user.camp_code,
    camp_name: camp ? camp.name : null,
    created_at: user.created_at,
  };
}

function signUser(user) {
  const camp = db.prepare('SELECT * FROM camps WHERE code = ?').get(user.camp_code);
  const publicUser = publicUserRow(user, camp);
  const token = jwt.sign({
    id: user.id,
    name: user.name,
    role: user.role,
    camp_code: user.camp_code,
  }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: publicUser };
}

function validateLeaderPin(pin) {
  return typeof pin === 'string' && /^\d{4,}$/.test(pin);
}

function validateAdminPin(pin) {
  return typeof pin === 'string'
    && pin.length >= 8
    && /[A-Za-z]/.test(pin)
    && /\d/.test(pin)
    && /[^A-Za-z0-9]/.test(pin);
}

function validateCampCode(code) {
  return /^[A-Z0-9_-]{3,24}$/.test(code);
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Trebuie sa fii autentificat.' });
  }

  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Contul nu mai exista.' });
    const camp = db.prepare('SELECT * FROM camps WHERE code = ?').get(user.camp_code);
    req.user = publicUserRow(user, camp);
    next();
  } catch {
    res.status(401).json({ error: 'Sesiune invalida sau expirata.' });
  }
}

function campAdminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'camp_admin') {
      return res.status(403).json({ error: 'Acces restrictionat administratorilor de tabara.' });
    }
    next();
  });
}

app.post('/api/auth/register', (req, res) => {
  if (checkRateLimit(req.ip)) {
    return res.status(429).json({ error: 'Prea multe încercări. Încearcă din nou în 15 minute.' });
  }
  const name = String(req.body.name || '').trim();
  const pin = String(req.body.pin || '');
  const campCode = normalizeCampCode(req.body.camp_code);

  if (!name || !pin || !campCode) {
    return res.status(400).json({ error: 'Numele, PIN-ul si codul taberei sunt obligatorii.' });
  }
  if (name.length < 2) {
    return res.status(400).json({ error: 'Numele trebuie sa aiba cel putin 2 caractere.' });
  }
  if (!validateLeaderPin(pin)) {
    return res.status(400).json({ error: 'PIN-ul liderului trebuie sa contina minim 4 cifre.' });
  }

  const camp = db.prepare('SELECT * FROM camps WHERE code = ?').get(campCode);
  if (!camp) return res.status(404).json({ error: 'Codul taberei nu exista.' });

  if (db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)').get(name)) {
    return res.status(409).json({ error: 'Acest nume de utilizator este deja folosit.' });
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO users(id, name, pin_hash, role, camp_id, camp_code)
    VALUES(?, ?, ?, 'member', ?, ?)
  `).run(id, name, bcrypt.hashSync(pin, 10), camp.id, camp.code);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(signUser(user));
});

app.post('/api/auth/login', (req, res) => {
  if (checkRateLimit(req.ip)) {
    return res.status(429).json({ error: 'Prea multe încercări. Încearcă din nou în 15 minute.' });
  }
  const name = String(req.body.name || '').trim();
  const pin = String(req.body.pin || '');

  if (!name || !pin) return res.status(400).json({ error: 'Numele si PIN-ul sunt obligatorii.' });

  const user = db.prepare('SELECT * FROM users WHERE LOWER(name) = LOWER(?)').get(name);
  if (!user) return res.status(401).json({ error: 'Numele nu a fost gasit.' });
  if (!bcrypt.compareSync(pin, user.pin_hash)) return res.status(401).json({ error: 'Cod PIN incorect.' });

  res.json(signUser(user));
});

app.post('/api/admin/register-camp', (req, res) => {
  if (checkRateLimit(req.ip)) {
    return res.status(429).json({ error: 'Prea multe încercări. Încearcă din nou în 15 minute.' });
  }
  const campName = String(req.body.camp_name || '').trim();
  const campCode = normalizeCampCode(req.body.camp_code);
  const name = String(req.body.name || '').trim();
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const pin = String(req.body.pin || '');

  if (!campName || !campCode || !name || !fullName || !email || !phone || !pin) {
    return res.status(400).json({ error: 'Completeaza toate campurile pentru contul taberei.' });
  }
  if (!validateCampCode(campCode)) {
    return res.status(400).json({ error: 'Codul taberei poate avea 3-24 caractere: litere, cifre, - sau _.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresa de email nu este valida.' });
  }
  if (!validateAdminPin(pin)) {
    return res.status(400).json({ error: 'PIN-ul administratorului trebuie sa aiba minim 8 caractere, o cifra si un simbol.' });
  }
  if (db.prepare('SELECT id FROM camps WHERE code = ?').get(campCode)) {
    return res.status(409).json({ error: 'Acest cod de tabara exista deja.' });
  }
  if (db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)').get(name)) {
    return res.status(409).json({ error: 'Acest nume de utilizator este deja folosit.' });
  }

  const createCamp = db.transaction(() => {
    const campId = generateId();
    const userId = generateId();
    db.prepare('INSERT INTO camps(id, name, code, admin_user_id) VALUES(?, ?, ?, ?)')
      .run(campId, campName, campCode, userId);
    db.prepare(`
      INSERT INTO users(id, name, full_name, email, phone, pin_hash, role, camp_id, camp_code)
      VALUES(?, ?, ?, ?, ?, ?, 'camp_admin', ?, ?)
    `).run(userId, name, encryptField(fullName), encryptField(email), encryptField(phone), bcrypt.hashSync(pin, 10), campId, campCode);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  });

  res.status(201).json(signUser(createCamp()));
});

app.get('/api/ideas', authMiddleware, (req, res) => {
  let q = 'SELECT * FROM ideas WHERE camp_code = ?';
  const p = [req.user.camp_code];
  if (req.query.category && req.query.category !== 'toate') {
    q += ' AND category = ?';
    p.push(req.query.category);
  }
  q += req.query.sort === 'new' ? ' ORDER BY created_at DESC' : ' ORDER BY vote_count DESC, created_at DESC';
  res.json(db.prepare(q).all(...p));
});

app.get('/api/ideas/:id', authMiddleware, (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ? AND camp_code = ?').get(req.params.id, req.user.camp_code);
  if (!idea) return res.status(404).json({ error: 'Ideea nu a fost gasita in tabara ta.' });
  res.json(idea);
});

app.post('/api/ideas', authMiddleware, (req, res) => {
  const { title, description, category, materials, duration, max_participants } = req.body;
  if (!title || !description || !category) {
    return res.status(400).json({ error: 'Titlul, descrierea si categoria sunt obligatorii.' });
  }
  if (!['spiritual', 'jocuri', 'ateliere', 'sport', 'muzica', 'altele'].includes(category)) {
    return res.status(400).json({ error: 'Categoria este invalida.' });
  }
  if (String(title).trim().length < 3) {
    return res.status(400).json({ error: 'Titlul trebuie sa aiba cel putin 3 caractere.' });
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO ideas(id, user_id, user_name, title, description, category, materials, duration, max_participants, camp_code)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.user.id,
    req.user.name,
    String(title).trim(),
    String(description).trim(),
    category,
    materials || null,
    duration || null,
    max_participants ? parseInt(max_participants, 10) : null,
    req.user.camp_code,
  );

  res.status(201).json(db.prepare('SELECT * FROM ideas WHERE id = ?').get(id));
});

app.post('/api/ideas/:id/vote', authMiddleware, (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ? AND camp_code = ?').get(req.params.id, req.user.camp_code);
  if (!idea) return res.status(404).json({ error: 'Ideea nu a fost gasita in tabara ta.' });

  const existingVote = db.prepare('SELECT id FROM votes WHERE idea_id = ? AND user_id = ?').get(idea.id, req.user.id);
  if (existingVote) {
    db.prepare('DELETE FROM votes WHERE idea_id = ? AND user_id = ?').run(idea.id, req.user.id);
    db.prepare('UPDATE ideas SET vote_count = MAX(vote_count - 1, 0) WHERE id = ?').run(idea.id);
    return res.json({
      voted: false,
      vote_count: db.prepare('SELECT vote_count FROM ideas WHERE id = ?').get(idea.id).vote_count,
    });
  }

  db.prepare('INSERT INTO votes(id, idea_id, user_id) VALUES(?, ?, ?)').run(generateId(), idea.id, req.user.id);
  db.prepare('UPDATE ideas SET vote_count = vote_count + 1 WHERE id = ?').run(idea.id);
  res.json({
    voted: true,
    vote_count: db.prepare('SELECT vote_count FROM ideas WHERE id = ?').get(idea.id).vote_count,
  });
});

app.get('/api/admin/stats', campAdminMiddleware, (req, res) => {
  res.json({
    camp_code: req.user.camp_code,
    camp_name: req.user.camp_name,
    total_users: db.prepare('SELECT COUNT(*) AS c FROM users WHERE camp_code = ?').get(req.user.camp_code).c,
    leaders: db.prepare("SELECT COUNT(*) AS c FROM users WHERE camp_code = ? AND role = 'member'").get(req.user.camp_code).c,
    admins: db.prepare("SELECT COUNT(*) AS c FROM users WHERE camp_code = ? AND role = 'camp_admin'").get(req.user.camp_code).c,
    total_ideas: db.prepare('SELECT COUNT(*) AS c FROM ideas WHERE camp_code = ?').get(req.user.camp_code).c,
    selected: db.prepare("SELECT COUNT(*) AS c FROM ideas WHERE camp_code = ? AND status = 'selected'").get(req.user.camp_code).c,
    total_votes: db.prepare('SELECT SUM(vote_count) AS s FROM ideas WHERE camp_code = ?').get(req.user.camp_code).s || 0,
  });
});

app.get('/api/admin/users', campAdminMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, full_name, email, phone, role, camp_code, created_at
    FROM users
    WHERE camp_code = ?
    ORDER BY role DESC, datetime(created_at) DESC
  `).all(req.user.camp_code).map((u) => ({
    ...u,
    full_name: decryptField(u.full_name),
    email: decryptField(u.email),
    phone: decryptField(u.phone),
  }));
  res.json(users);
});

app.delete('/api/admin/users/:id', campAdminMiddleware, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ? AND camp_code = ?').get(req.params.id, req.user.camp_code);
  if (!target) return res.status(404).json({ error: 'Contul nu a fost gasit in tabara ta.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Nu poti sterge contul cu care esti autentificat.' });

  const deleteUser = db.transaction(() => {
    const ideaIds = db.prepare('SELECT id FROM ideas WHERE user_id = ?').all(target.id).map((row) => row.id);
    db.prepare('DELETE FROM votes WHERE user_id = ?').run(target.id);
    for (const ideaId of ideaIds) db.prepare('DELETE FROM votes WHERE idea_id = ?').run(ideaId);
    db.prepare('DELETE FROM ideas WHERE user_id = ?').run(target.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  });

  deleteUser();
  res.json({ ok: true });
});

app.get('/api/admin/ideas', campAdminMiddleware, (req, res) => {
  let q = 'SELECT * FROM ideas WHERE camp_code = ?';
  const p = [req.user.camp_code];
  if (req.query.status && req.query.status !== 'toate') {
    q += ' AND status = ?';
    p.push(req.query.status);
  }
  q += ' ORDER BY vote_count DESC, created_at DESC';
  res.json(db.prepare(q).all(...p));
});

app.patch('/api/admin/ideas/:id', campAdminMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'selected', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status invalid.' });
  }
  const idea = db.prepare('SELECT id FROM ideas WHERE id = ? AND camp_code = ?').get(req.params.id, req.user.camp_code);
  if (!idea) return res.status(404).json({ error: 'Ideea nu a fost gasita in tabara ta.' });
  db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json(db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id));
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/propune', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'propune.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  console.log('\nCAMP COMMUNITY — Server pornit\n');
  console.log('  Local:    http://localhost:' + PORT);
  ips.forEach(ip => console.log('  Retea:    http://' + ip + ':' + PORT));
  console.log('');
});
