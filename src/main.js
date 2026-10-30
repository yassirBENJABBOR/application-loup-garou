// UI + host driver. All user strings are rendered with textContent (via h()), never innerHTML.
import './styles/main.css';
import { fr as t } from './i18n/fr.js';
import * as net from './transport/local.js';
import { startGame, step, tally } from './engine/engine.js';

/** Tiny DOM builder: string children become text nodes, so they are always escaped. */
const h = (tag, a = {}, ...c) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  e.append(...c.flat().filter((x) => x != null && x !== false)); return e;
};
const store = { get: (k) => localStorage.getItem('lgm:' + k), set: (k, v) => localStorage.setItem('lgm:' + k, v) };
const uid = store.get('uid') || (crypto.randomUUID(), store.set('uid', crypto.randomUUID()), store.get('uid'));
const app = document.getElementById('app');
let code = new URLSearchParams(location.search).get('salle')?.toUpperCase() || store.get('code');
let doc = null, off = null, err = '', timer = null;

const cleanName = (v) => { const s = v.trim(); return s.length >= 2 && s.length <= 16 ? s : null; };
const color = (s) => `hsl(${[...s].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360} 55% 38%)`;

function enter(c, d) {
  code = c; store.set('code', c); off?.(); off = net.subscribe(c, (x) => { doc = x; render(); });
  clearInterval(timer); // Host drives the engine; stateless, so a new host can resume from the doc.
  timer = setInterval(() => { if (doc?.host === uid) net.update(code, (s) => step(s, Date.now())); render(true); }, 500);
}
function landing() {
  const name = h('input', { id: 'name', maxlength: 16, placeholder: t.name, value: store.get('name') || '', 'aria-label': t.name });
  const room = h('input', { maxlength: 4, placeholder: t.code, value: code && !doc ? code : '', 'aria-label': t.code, style: 'text-transform:uppercase;width:9em' });
  const go = (fn) => () => { const n = cleanName(name.value); if (!n) { err = t.errName; return render(); }
    store.set('name', n); try { err = ''; fn(n); } catch (e) { err = e.message; render(); } };
  return h('main', {}, h('h1', {}, t.title), h('p', { class: 'demo' }, t.demo), name,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: go((n) => enter(net.createRoom(uid, n))) }, t.create)),
    h('div', { class: 'row' }, room, h('button', { onclick: go((n) => { const c = room.value.toUpperCase(); net.joinRoom(c, uid, n); enter(c); }) }, t.join)),
    h('p', { class: 'err', role: 'alert' }, err));
}
const me = () => doc.players[uid];
const act = (a) => net.update(code, (s) => ({ ...s, actions: { ...s.actions, [uid]: a } }));

function onPick(u) {
  if (!me().alive || !doc.players[u].alive) return;
  if (doc.phase === 'day') return act({ t: u });
  if (doc.phase !== 'night') return;
  const r = me().role;
  if ((doc.step === 'seer' && r === 'voyante') || (doc.step === 'wolves' && r === 'loup')) act({ t: u });
  else if (doc.step === 'witch' && r === 'sorciere' && doc.potions.poison) act({ poison: u, save: doc.actions[uid]?.save });
}
function panel() {
  const r = me().role, a = doc.actions[uid];
  if (!me().alive) return h('p', {}, t.dead);
  if (doc.phase === 'day') return h('p', {}, a ? t.voted : t.vote);
  if (doc.phase !== 'night') return null;
  if (doc.step === 'witch' && r === 'sorciere') return h('div', {},
    h('p', {}, t.victim + (doc.wolfTarget ? doc.players[doc.wolfTarget].name : '—')),
    h('div', { class: 'row' },
      doc.potions.save && doc.wolfTarget && h('button', { onclick: () => act({ save: true, poison: a?.poison }) }, t.save),
      h('button', { onclick: () => act({ save: false, poison: a?.poison }) }, t.pass)),
    doc.potions.poison ? h('p', {}, t.poison) : null);
  const mine = (doc.step === 'seer' && r === 'voyante') || (doc.step === 'wolves' && r === 'loup');
  return h('div', {}, h('p', {}, mine ? t.step[doc.step] : t.step[doc.step] + '…'), mine && doc.seerLog[uid] ? h('p', {}, doc.seerLog[uid]) : null);
}
function game() {
  const secs = Math.max(0, Math.ceil((doc.endsAt - Date.now()) / 1000));
  const votes = doc.phase === 'day' ? tally(Object.fromEntries(Object.entries(doc.actions).map(([k, v]) => [k, v.t]))).counts : {};
  const board = h('div', { class: 'board' }, Object.entries(doc.players).map(([u, p]) =>
    h('button', { class: `p ${p.alive ? '' : 'dead'} ${doc.actions[uid]?.t === u ? 'sel' : ''}`, onclick: () => onPick(u), 'aria-label': p.name },
      h('span', { class: 'av', style: `background:${color(p.name)}` }, p.name[0].toUpperCase()), p.name,
      votes[u] ? ` ×${votes[u]}` : '', !p.alive ? ` (${t.roles[p.role]})` : '')));
  const end = doc.phase === 'end' ? h('div', { class: 'role' }, h('h2', {}, t.win[doc.winner]),
    Object.values(doc.players).map((p) => h('div', {}, `${p.name} — ${t.roles[p.role]}`)),
    doc.host === uid && h('button', { class: 'primary', onclick: () => net.update(code, (s) => ({ ...s, phase: 'lobby', winner: null, log: [], actions: {},
      players: Object.fromEntries(Object.entries(s.players).map(([k, p]) => [k, { name: p.name }])) })) }, t.replay)) : null;
  return h('main', {}, h('div', { class: 'bar' }, h('strong', {}, `${t.phase[doc.phase]} ${doc.day}`), doc.phase !== 'end' && h('span', {}, `${secs}s`)),
    h('div', { class: 'role' }, t.you + t.roles[me().role]), panel(), board, end,
    h('div', { class: 'feed', 'aria-live': 'polite' }, doc.log.map((l) => h('p', {}, l))));
}
function lobby() {
  const n = Object.keys(doc.players).length, isHost = doc.host === uid, link = `${location.origin}${location.pathname}?salle=${doc.code}`;
  return h('main', {}, h('h1', {}, `${t.title} — ${doc.code}`), h('p', {}, t.share), h('input', { readonly: 'readonly', value: link, 'aria-label': t.share, style: 'width:100%' }),
    h('div', { class: 'board' }, Object.entries(doc.players).map(([u, p]) => h('div', { class: 'p' },
      h('span', { class: 'av', style: `background:${color(p.name)}` }, p.name[0].toUpperCase()), p.name, u === doc.host ? ' 👑' : ''))),
    isHost ? h('button', { class: 'primary', disabled: n < 4 ? 'disabled' : null, onclick: () => net.update(code, (s) => startGame(s, Date.now())) }, t.start) : h('p', {}, t.waiting),
    isHost && n < 4 ? h('p', {}, t.needPlayers) : null);
}
function render(tickOnly) {
  const phase = doc?.phase === 'night' ? 'night' : doc?.phase === 'day' ? 'day' : 'night';
  document.body.dataset.phase = phase;
  if (tickOnly && (!doc || doc.phase === 'lobby')) return; // avoid stealing input focus
  if (doc && !doc.players[uid]) doc = null;
  const el = !doc ? landing() : doc.phase === 'lobby' ? lobby() : game();
  const focused = document.activeElement?.id;
  app.replaceChildren(el); if (focused) document.getElementById(focused)?.focus();
}
if (code && net.get(code)?.players[uid]) enter(code, net.get(code)); else render();
