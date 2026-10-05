import express from 'express'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit';
import pg from 'pg'; import argon2 from 'argon2'; import crypto from 'crypto'; import path from 'path';
import { createServer } from 'http'; import { Server } from 'socket.io'; import { fileURLToPath } from 'url';
const { PORT = 3000, DATABASE_URL, OWNER_USERNAME, OWNER_PASSWORD, ORIGIN, NODE_ENV } = process.env;
const prod = NODE_ENV === 'production', GB = 2 ** 30, dir = path.dirname(fileURLToPath(import.meta.url));
const db = new pg.Pool({ connectionString: DATABASE_URL });
const q = (s, p) => db.query(s, p).then(r => r.rows);
const E = (status, m) => Object.assign(new Error(m), { status });
const RESERVED = new Set('admin administrator support help official letterly system owner root api security moderator sanzwm'.split(' '));
const norm = s => String(s ?? '').trim().toLowerCase(), validName = n => /^[a-z0-9_.]{3,20}$/.test(n);
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const tok = h => /(?:^|;\s*)sid=([^;]+)/.exec(h || '')?.[1];
async function tx(fn) { const c = await db.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }

// Username ownership: names are never recycled. UNIQUE(normalized_username) on users AND username_history
// is the final arbiter; a concurrent loser gets 23505 -> "Username already taken."
async function claim(c, uid, raw, force) {
  const n = norm(raw); if (!validName(n)) throw E(400, 'Use 3-20 letters, numbers, _ or .');
  if (RESERVED.has(n) && !force) throw E(409, 'Username already taken.');
  const { rows: [h] } = await c.query('SELECT user_id FROM username_history WHERE normalized_username=$1', [n]);
  if (h && h.user_id !== uid) throw E(409, 'Username already taken.');
  if (h) await c.query("UPDATE username_history SET status='active',released_at=NULL WHERE normalized_username=$1", [n]);
  else await c.query('INSERT INTO username_history(user_id,username,normalized_username) VALUES($1,$2,$3)', [uid, String(raw).trim(), n]);
  return n;
}
// Owner is provisioned from env (no default password); the DB role is the source of truth afterwards.
async function provisionOwner() {
  if (!OWNER_USERNAME || !OWNER_PASSWORD || (await q("SELECT 1 FROM users WHERE role='owner'")).length) return;
  const n = norm(OWNER_USERNAME), pw = await argon2.hash(OWNER_PASSWORD);
  await tx(async c => {
    const { rows: [u] } = await c.query("INSERT INTO users(username,normalized_username,display_name,password_hash,role,is_verified,verified_at,premium_granted,storage_quota) VALUES($1,$1,$2,$3,'owner',true,now(),true,$4) RETURNING id", [n, n.toUpperCase(), pw, 50 * GB]);
    await claim(c, u.id, n, true);
  });
}
const badges = u => { const o = u.role === 'owner'; return { owner: o && u.owner_badge_visible, verified: u.is_verified && (!o || u.verified_badge_visible), premium: (u.premium_granted || o) && (!o || u.premium_badge_visible) }; };
const pub = u => ({ id: u.id, username: u.username, display_name: u.display_name, bio: u.bio, avatar_type: u.avatar_type, avatar_url: u.avatar_url, character_config: u.character_config, badges: badges(u), joined: u.created_at });
const me = u => ({ ...pub(u), role: u.role, storage: { used: +u.storage_used, quota: +u.storage_quota }, badge_settings: u.role === 'owner' ? { owner: u.owner_badge_visible, verified: u.verified_badge_visible, premium: u.premium_badge_visible } : undefined });
const userFromToken = async t => t ? (await q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(t)]))[0] : null;
const auth = async (req, res, next) => { req.user = await userFromToken(tok(req.headers.cookie)); req.user ? next() : res.status(401).json({ error: 'Please log in.' }); };
async function session(req, res, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  await q("INSERT INTO sessions(token_hash,user_id,ip,user_agent,expires_at) VALUES($1,$2,$3,$4,now()+interval '14 days')", [hash(t), uid, req.ip, req.get('user-agent')]);
  res.cookie('sid', t, { httpOnly: true, secure: prod, sameSite: 'strict', maxAge: 14 * 864e5 });
}
const lim = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false });
const app = express(); app.set('trust proxy', 1);
app.use(helmet(), express.json({ limit: '100kb' }), (req, res, next) => { req.body ??= {}; next(); });
app.use('/api', lim(6e4, 300), (req, res, next) => ['GET', 'HEAD'].includes(req.method) || req.get('x-letterly') === '1' ? next() : res.status(403).json({ error: 'Bad request.' })); // CSRF: SameSite=Strict + custom header
const authLimit = lim(9e5, 30);

app.post('/api/register', authLimit, async (req, res) => {
  const { username, display_name, password } = req.body;
  if (String(password || '').length < 8) throw E(400, 'Password needs 8+ characters.');
  const pw = await argon2.hash(password), n = norm(username);
  const u = await tx(async c => {
    if (!validName(n)) throw E(400, 'Use 3-20 letters, numbers, _ or .');
    const { rows: [u] } = await c.query('INSERT INTO users(username,normalized_username,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING *', [String(username).trim(), n, String(display_name || username).trim().slice(0, 40), pw]);
    await claim(c, u.id, username); return u;
  });
  await session(req, res, u.id); res.json(me(u));
});
app.post('/api/login', authLimit, async (req, res) => {
  const [u] = await q('SELECT * FROM users WHERE normalized_username=$1', [norm(req.body.username)]);
  if (!(u && await argon2.verify(u.password_hash, String(req.body.password || '')))) throw E(401, 'Wrong username or password.');
  await session(req, res, u.id); res.json(me(u));
});
app.post('/api/logout', auth, async (req, res) => { await q('DELETE FROM sessions WHERE token_hash=$1', [hash(tok(req.headers.cookie))]); res.clearCookie('sid'); res.json({ ok: true }); });
app.post('/api/logout-all', auth, async (req, res) => { await q('DELETE FROM sessions WHERE user_id=$1', [req.user.id]); res.clearCookie('sid'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(me(req.user)));
app.patch('/api/me/username', auth, async (req, res) => {
  const n = await tx(async c => {
    await c.query("UPDATE username_history SET status='reserved',released_at=now() WHERE user_id=$1 AND status='active'", [req.user.id]); // old name stays reserved forever
    const n = await claim(c, req.user.id, req.body.username);
    await c.query('UPDATE users SET username=$2,normalized_username=$3,updated_at=now() WHERE id=$1', [req.user.id, String(req.body.username).trim(), n]); return n;
  });
  res.json({ username: String(req.body.username).trim(), normalized: n });
});
app.get('/api/search', auth, async (req, res) => res.json((await q('SELECT * FROM users WHERE normalized_username LIKE $1 ORDER BY normalized_username LIMIT 10', [norm(req.query.q).replace(/^@/, '').replace(/[\\%_]/g, '\\$&') + '%'])).map(pub)));
app.get('/api/u/:username', auth, async (req, res) => {
  const n = norm(req.params.username.replace(/^@/, '')), [u] = await q('SELECT * FROM users WHERE normalized_username=$1', [n]);
  if (u) return res.json({ state: 'active', user: pub(u) });
  const gone = RESERVED.has(n) || (await q('SELECT 1 FROM username_history WHERE normalized_username=$1', [n])).length > 0;
  res.json({ state: gone ? 'reserved' : 'available' }); // never reveals who held it
});
app.patch('/api/owner/badges', auth, async (req, res) => {
  if (req.user.role !== 'owner') throw E(403, 'Owner only.');
  const { owner, verified, premium } = req.body;
  await q('UPDATE users SET owner_badge_visible=$2,verified_badge_visible=$3,premium_badge_visible=$4 WHERE id=$1', [req.user.id, !!owner, !!verified, !!premium]);
  await q("INSERT INTO owner_audit_logs(owner_id,action,target_type,target_id,metadata,ip_address,user_agent) VALUES($1,'badges.visibility','user',$1,$2,$3,$4)", [req.user.id, { owner: !!owner, verified: !!verified, premium: !!premium }, req.ip, req.get('user-agent')]);
  res.json({ ok: true });
});
app.get('/api/messages/:id', auth, async (req, res) => res.json(await q('SELECT * FROM (SELECT * FROM messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) ORDER BY id DESC LIMIT 100) t ORDER BY id', [req.user.id, +req.params.id])));

// Statuses: unlimited count (anti-spam rate limit only), 24h expiry, bytes count against the 10 GB / 50 GB quota.
app.post('/api/status', auth, lim(6e4, 60), async (req, res) => {
  const privacy = req.body.privacy ?? 'everyone', t = String(req.body.body ?? '').trim().slice(0, 700);
  if (!['everyone', 'contacts', 'except', 'only'].includes(privacy)) throw E(400, 'Bad privacy option.');
  if (!t) throw E(400, 'Write something first.');
  const bytes = Buffer.byteLength(t);
  const [ok] = await q('UPDATE users SET storage_used=storage_used+$2 WHERE id=$1 AND storage_used+$2<=storage_quota RETURNING id', [req.user.id, bytes]); // atomic quota check
  if (!ok) throw E(413, 'Storage is full. Free up space to post.');
  res.json((await q("INSERT INTO statuses(user_id,body,privacy,bytes) VALUES($1,$2,$3,$4) RETURNING id,body,created_at", [req.user.id, t, privacy, bytes]))[0]);
});
app.get('/api/status', auth, async (req, res) => res.json(await q("SELECT s.id,s.body,s.created_at,u.username,u.display_name FROM statuses s JOIN users u ON u.id=s.user_id WHERE s.expires_at>now() AND (s.user_id=$1 OR s.privacy='everyone') ORDER BY s.created_at DESC LIMIT 100", [req.user.id])));
setInterval(() => q("WITH d AS(DELETE FROM statuses WHERE expires_at<=now() RETURNING user_id,bytes) UPDATE users u SET storage_used=GREATEST(0,storage_used-x.b) FROM(SELECT user_id,SUM(bytes) b FROM d GROUP BY 1) x WHERE u.id=x.user_id").catch(console.error), 6e5);

app.use(express.static(path.join(dir, 'public')));
app.get(/^\/(u|owner)(\/.*)?$/, (req, res) => res.sendFile(path.join(dir, 'public/index.html')));
app.use((e, req, res, next) => { if (e.code === '23505') e = E(409, 'Username already taken.'); if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' }); });

const server = createServer(app), io = new Server(server, { cors: { origin: ORIGIN || false, credentials: true } });
io.use(async (s, next) => { const u = await userFromToken(tok(s.handshake.headers.cookie)).catch(() => null); u ? (s.user = u, next()) : next(new Error('auth')); });
io.on('connection', s => {
  const id = s.user.id; s.join('u:' + id); io.emit('presence:update', { id, online: true });
  s.on('chat:message', async ({ to, body } = {}, ack) => {
    try { body = String(body ?? '').trim().slice(0, 4000); if (!body || !Number.isInteger(to)) return;
      const [m] = await q('INSERT INTO messages(sender_id,recipient_id,body) VALUES($1,$2,$3) RETURNING *', [id, to, body]);
      io.to('u:' + to).to('u:' + id).emit('chat:message', m); ack?.({ ok: true }); } catch (e) { console.error(e); ack?.({ ok: false }); }
  });
  for (const ev of ['chat:typing', 'chat:stop_typing']) s.on(ev, ({ to } = {}) => io.to('u:' + to).emit(ev, { from: id }));
  s.on('chat:read', async ({ from } = {}) => { await q('UPDATE messages SET read_at=now() WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL', [from, id]).catch(() => {}); io.to('u:' + from).emit('chat:read', { by: id }); });
  s.on('disconnect', () => io.emit('presence:update', { id, online: false }));
});
await provisionOwner();
server.listen(PORT, () => console.log('Letterly on :' + PORT));
