// Local demo transport: localStorage + BroadcastChannel (same browser, several tabs).
// Same interface a Firebase transport must implement: createRoom, joinRoom, subscribe, update, get.
import { fr as t } from '../i18n/fr.js';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no O/I (0/1 look-alikes)
const ch = new BroadcastChannel('loup-garou'), subs = new Map();
const key = (c) => 'lg:' + c;
export const get = (c) => JSON.parse(localStorage.getItem(key(c)) || 'null');
const emit = (c) => (subs.get(c) || []).forEach((cb) => cb(get(c)));
const put = (c, d) => { localStorage.setItem(key(c), JSON.stringify(d)); ch.postMessage(c); emit(c); };
ch.onmessage = (e) => emit(e.data);

export function createRoom(uid, name) {
  let code; do code = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join(''); while (get(code));
  put(code, { code, host: uid, phase: 'lobby', players: { [uid]: { name } }, actions: {}, log: [] });
  return code;
}
export function joinRoom(code, uid, name) {
  const d = get(code); if (!d) throw new Error(t.errNoRoom);
  if (d.players[uid]) return d; // reconnect: role and state are kept
  if (d.phase !== 'lobby') throw new Error(t.errStarted);
  if (Object.keys(d.players).length >= 18) throw new Error(t.errFull);
  if (Object.values(d.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(t.errTaken);
  d.players[uid] = { name }; put(code, d); return d;
}
/** Read-modify-write; only publishes when the result changed. */
export function update(code, fn) {
  const d = get(code); if (!d) return;
  const n = fn(structuredClone(d));
  if (n && JSON.stringify(n) !== JSON.stringify(d)) put(code, n);
}
export function subscribe(code, cb) {
  subs.set(code, [...(subs.get(code) || []), cb]); cb(get(code));
  return () => subs.set(code, (subs.get(code) || []).filter((x) => x !== cb));
}
