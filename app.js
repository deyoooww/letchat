const $ = s => document.querySelector(s), root = $('#app');
const api = async (p, m = 'GET', b) => { const r = await fetch('/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-letterly': '1' }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; };
const h = (t, a = {}, ...c) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) k === 'on' ? Object.entries(v).forEach(([n, f]) => e.addEventListener(n, f)) : v != null && v !== false && e.setAttribute(k, v); c.flat(9).forEach(x => x != null && x !== false && e.append(x)); return e; };
const svg = s => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const toast = t => { const e = h('div', { class: 'toast', role: 'status' }, t); document.body.append(e); setTimeout(() => e.remove(), 2600); };

// Reusable badge components (backend decides which render)
const VerifiedBadge = (px = 20) => svg(`<svg class="badge" width="${px}" height="${px}" viewBox="0 0 24 24" role="img" aria-label="Verified"><circle cx="12" cy="12" r="12" fill="#2F95E8"/><path d="M6.6 12.7l3.7 3.7 7.1-7.7" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const PremiumBadge = (px = 20) => svg(`<svg class="badge" width="${px}" height="${px}" viewBox="0 0 24 24" role="img" aria-label="Premium"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.5 7-6.3-3.6-6.3 3.6 1.5-7L2 9.4l7-.8z" fill="#9B6BFF" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`);
const OwnerBadge = () => h('span', { class: 'chip owner', 'aria-label': 'Owner' }, 'OWNER');
const Badges = b => h('span', { class: 'badges' }, b.owner && OwnerBadge(), b.verified && VerifiedBadge(), b.premium && PremiumBadge());
const col = (v, d) => /^#[0-9a-f]{6}$/i.test(v) ? v : d;
const Avatar = (u, px = 44) => { const c = u.character_config || {}; return svg(`<svg class="avatar" width="${px}" height="${px}" viewBox="0 0 48 48" role="img" aria-label="Avatar"><circle cx="24" cy="24" r="22" fill="${col(c.bg, '#B6F23B')}" stroke="#111" stroke-width="3"/><circle cx="24" cy="26" r="12" fill="${col(c.skin, '#F6C9A0')}" stroke="#111" stroke-width="2.5"/><path d="M11 24a13 13 0 0126 0c-6-2-18-2-26 0z" fill="${col(c.hair, '#3B2A20')}"/><circle cx="19.5" cy="27" r="1.7"/><circle cx="28.5" cy="27" r="1.7"/><path d="M20 32q4 3.5 8 0" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>`); };
const Who = u => h('span', { class: 'who' }, h('b', {}, u.display_name), h('span', { class: 'at' }, '@' + u.username), Badges(u.badges));

let me, peer, prof, sock, msgs = [], view = 'chat';
async function boot() {
  try { me = await api('/me'); } catch { return auth(); }
  const pm = location.pathname.match(/^\/u\/@?([^/]+)/);
  if (pm) try { prof = await api('/u/' + pm[1]); view = 'profile'; } catch {}
  start();
}
function auth() {
  let reg = false; const err = h('p', { class: 'err', role: 'alert' });
  const f = { u: h('input', { placeholder: 'username', autocomplete: 'username', required: true }), d: h('input', { placeholder: 'display name', autocomplete: 'name' }), p: h('input', { type: 'password', placeholder: 'password (8+ characters)', autocomplete: 'current-password', required: true }) };
  const go = h('button', {}), sw = h('button', { class: 'ghost', type: 'button' });
  const draw = () => { f.d.hidden = !reg; go.textContent = reg ? 'Create my account' : 'Log in'; sw.textContent = reg ? 'I already have an account' : 'I need an account'; err.textContent = ''; };
  sw.addEventListener('click', () => { reg = !reg; draw(); }); draw();
  root.replaceChildren(h('form', { class: 'card auth', on: { submit: async e => { e.preventDefault(); try { me = await api(reg ? '/register' : '/login', 'POST', { username: f.u.value, display_name: f.d.value, password: f.p.value }); start(); } catch (x) { err.textContent = x.message; } } } },
    h('h1', {}, 'Letterly'), h('p', {}, 'Chat, send letters, share statuses. Free for everyone.'), f.u, f.d, f.p, err, go, sw));
}
function start() {
  sock?.disconnect(); sock = io();
  sock.on('chat:message', m => { const mine = m.sender_id === me.id; if (peer && (mine ? m.recipient_id : m.sender_id) === peer.id) { msgs.push(m); drawLog(); if (!mine) sock.emit('chat:read', { from: peer.id }); } else if (!mine) toast('New message'); });
  sock.on('chat:typing', ({ from }) => { if (peer?.id === from) $('#typing').textContent = 'typing…'; });
  sock.on('chat:stop_typing', () => { const t = $('#typing'); if (t) t.textContent = ''; });
  shell();
}
function shell() {
  const tab = (k, t) => h('button', { class: view === k ? 'on' : '', on: { click: () => { view = k; shell(); } } }, t), main = h('main');
  ({ chat: chatView, status: statusView, me: meView, profile: profileView })[view](main);
  root.replaceChildren(h('div', { id: 'shell' }, h('nav', {}, h('b', { class: 'logo' }, 'L'), tab('chat', 'Chats'), tab('status', 'Status'), tab('me', 'Me')), main));
}
async function open(u) { peer = u; msgs = await api('/messages/' + u.id); view = 'chat'; shell(); sock.emit('chat:read', { from: u.id }); }
function drawLog() { const l = $('#log'); if (!l) return; l.replaceChildren(...msgs.map(x => h('div', { class: 'msg' + (x.sender_id === me.id ? ' mine' : '') }, x.body))); l.scrollTop = l.scrollHeight; }
function chatView(m) {
  const res = h('div', { class: 'list' }), log = h('div', { class: 'log', id: 'log', role: 'log' });
  const find = h('input', { type: 'search', placeholder: 'Find someone by @username', on: { input: async e => { const v = e.target.value.trim().replace(/^@/, ''); if (v.length < 2) return res.replaceChildren(); const r = await api('/search?q=' + encodeURIComponent(v)).catch(() => []); res.replaceChildren(...r.filter(u => u.id !== me.id).map(u => h('button', { class: 'row', on: { click: () => open(u) } }, Avatar(u, 36), Who(u)))); } } });
  const box = h('input', { placeholder: 'Write a message', maxlength: 4000, on: { input: () => peer && sock.emit('chat:typing', { to: peer.id }), blur: () => peer && sock.emit('chat:stop_typing', { to: peer.id }) } });
  const send = e => { e.preventDefault(); const body = box.value.trim(); if (!body || !peer) return; box.value = ''; sock.emit('chat:stop_typing', { to: peer.id }); sock.emit('chat:message', { to: peer.id, body }); };
  m.append(h('section', { class: 'card' }, h('h2', {}, 'Chats'), find, res),
    h('section', { class: 'card' }, h('h2', {}, peer ? peer.display_name : 'Pick someone to chat with'), log, h('small', { id: 'typing' }), h('form', { class: 'send', on: { submit: send } }, box, h('button', {}, 'Send'))));
  drawLog();
}
function statusView(m) {
  const t = h('textarea', { rows: 3, maxlength: 700, placeholder: 'What\'s happening? It disappears in 24 hours.' }), list = h('div', { class: 'list' });
  const load = async () => { const r = await api('/status'); list.replaceChildren(...r.map(s => h('article', { class: 'card tight' }, h('b', {}, s.display_name + ' @' + s.username), h('p', {}, s.body)))); };
  m.append(h('section', { class: 'card' }, h('h2', {}, 'New status'), t, h('button', { on: { click: async () => { try { await api('/status', 'POST', { body: t.value }); t.value = ''; load(); toast('Status posted'); } catch (x) { toast(x.message); } } } }, 'Post status')), h('h2', {}, 'Right now'), list);
  load();
}
function profileView(m) {
  m.append(h('section', { class: 'card' }, prof.state === 'active' ? [Avatar(prof.user, 72), h('h2', {}, Who(prof.user)), h('p', {}, prof.user.bio || 'No bio yet.'), h('p', {}, 'Joined ' + new Date(prof.user.joined).toLocaleDateString()), prof.user.id !== me.id && h('button', { on: { click: () => open(prof.user) } }, 'Send a message')] : h('h2', {}, prof.state === 'reserved' ? 'Username unavailable' : 'No one has this username yet')));
}
function meView(m) {
  const { used, quota } = me.storage, pct = Math.min(100, used / quota * 100), gb = b => (b / 2 ** 30).toFixed(2) + ' GB', nu = h('input', { placeholder: 'new username' });
  const sw = (k, l) => { const i = h('input', { type: 'checkbox' }); i.checked = me.badge_settings[k]; i.addEventListener('change', async () => { try { await api('/owner/badges', 'PATCH', { ...me.badge_settings, [k]: i.checked }); me = await api('/me'); toast('Badge updated'); } catch (x) { toast(x.message); } }); return h('label', { class: 'sw' }, i, l); };
  m.append(h('section', { class: 'card' }, Avatar(me, 72), h('h2', {}, Who(me)), h('p', {}, me.bio || 'No bio yet.')),
    h('section', { class: 'card' }, h('h2', {}, 'Storage'), h('div', { class: 'meter' + (pct > 90 ? ' warn' : '') }, h('i', { style: 'width:' + pct + '%' })), h('p', {}, `${gb(used)} / ${gb(quota)}` + (pct >= 100 ? ' · full, free up space to upload' : pct > 90 ? ' · almost full' : ''))),
    h('section', { class: 'card' }, h('h2', {}, 'Username'), nu, h('button', { on: { click: async () => { try { const r = await api('/me/username', 'PATCH', { username: nu.value }); me.username = r.username; toast('Saved. Your old username stays reserved.'); shell(); } catch (x) { toast(x.message); } } } }, 'Change username')),
    me.role === 'owner' && h('section', { class: 'card' }, h('h2', {}, 'Badge visibility'), sw('owner', 'Owner badge'), sw('verified', 'Verified badge'), sw('premium', 'Premium badge')),
    h('section', { class: 'card row2' }, h('button', { on: { click: async () => { await api('/logout', 'POST'); location.reload(); } } }, 'Log out'), h('button', { class: 'ghost', on: { click: async () => { await api('/logout-all', 'POST'); location.reload(); } } }, 'Log out of all devices')));
}
boot();
