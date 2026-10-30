// Pure game engine: no DOM, no network. (state, now) => newState.
export const DURATION = { seer: 20000, wolves: 30000, witch: 20000, day: 90000 };
const ORDER = [['seer', 'voyante'], ['wolves', 'loup'], ['witch', 'sorciere']];

/** Traditional role distribution for n players (4..18). */
export function distribute(n, rng = Math.random) {
  const wolves = n < 8 ? 1 : n < 12 ? 2 : n < 16 ? 3 : 4;
  const list = Array(wolves).fill('loup');
  if (n >= 4) list.push('voyante');
  if (n >= 6) list.push('sorciere');
  if (n >= 7) list.push('chasseur');
  if (n >= 8) list.push('cupidon');
  while (list.length < n) list.push('villageois');
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

/** Kill uids, then propagate the lovers chain. Returns new players + deaths. */
export function killChain(players, uids, cause, lovers = null) {
  const next = structuredClone(players), deaths = [];
  const queue = uids.map((uid) => ({ uid, cause }));
  while (queue.length) {
    const { uid, cause: c } = queue.shift();
    if (!next[uid]?.alive) continue;
    next[uid].alive = false; deaths.push({ uid, cause: c, role: next[uid].role });
    if (lovers?.includes(uid)) queue.push({ uid: lovers.find((u) => u !== uid), cause: 'amour' });
  }
  return { players: next, deaths };
}

/** Night resolution: wolf kill (unless saved) + witch poison + lovers chain. */
export function resolveNight(players, { wolfTarget, saved, poisoned }, lovers) {
  const targets = [];
  if (wolfTarget && !saved) targets.push(wolfTarget);
  const first = killChain(players, targets, 'loups', lovers);
  const second = poisoned ? killChain(first.players, [poisoned], 'poison', lovers) : { players: first.players, deaths: [] };
  return { players: second.players, deaths: [...first.deaths, ...second.deaths] };
}

/** Most voted uid; null on tie or no votes. Captain's vote counts double. */
export function tally(votes, captain = null) {
  const c = {};
  for (const [voter, t] of Object.entries(votes)) if (t) c[t] = (c[t] || 0) + (voter === captain ? 2 : 1);
  const max = Math.max(0, ...Object.values(c));
  const top = Object.keys(c).filter((k) => c[k] === max);
  return { counts: c, winner: top.length === 1 ? top[0] : null };
}

/** 'village' | 'wolves' | 'lovers' | null */
export function checkWin(players, lovers = null) {
  const alive = Object.entries(players).filter(([, p]) => p.alive);
  const w = alive.filter(([, p]) => p.role === 'loup').length, v = alive.length - w;
  if (lovers && alive.length === 2 && alive.every(([u]) => lovers.includes(u)) && w === 1) return 'lovers';
  if (w === 0) return 'village';
  if (w >= v) return 'wolves';
  return null;
}

const pickTarget = (actions, uids, rng) => {
  const c = {};
  uids.forEach((u) => actions[u]?.t && (c[actions[u].t] = (c[actions[u].t] || 0) + 1));
  const max = Math.max(0, ...Object.values(c)), top = Object.keys(c).filter((k) => c[k] === max);
  return top.length ? top[Math.floor(rng() * top.length)] : null; // wolves tie => random
};

/** Build the initial in-game state from a lobby doc. */
export function startGame(d, now, rng = Math.random) {
  const uids = Object.keys(d.players), roles = distribute(uids.length, rng), players = {};
  uids.forEach((u, i) => (players[u] = { ...d.players[u], role: roles[i], alive: true }));
  return { ...d, players, phase: 'night', day: 1, step: 'seer', endsAt: now + DURATION.seer, actions: {}, lovers: null,
    potions: { save: 1, poison: 1 }, seerLog: {}, wolfTarget: null, pending: {}, log: ['Le village s’endort…'], winner: null };
}

const living = (d, role) => Object.entries(d.players).filter(([, p]) => p.alive && (!role || p.role === role)).map(([u]) => u);
const nm = (d, u) => d.players[u].name;

function enterStep(d, now, from) {
  for (let i = from; i < ORDER.length; i++) {
    const [s, role] = ORDER[i];
    if (living(d, role).length) return { ...d, step: s, endsAt: now + DURATION[s], actions: {} };
  }
  return null;
}

/** Advance the game if the current step is complete or its deadline passed. */
export function step(d, now, rng = Math.random) {
  if (d.phase === 'night') {
    const idx = ORDER.findIndex(([s]) => s === d.step), role = ORDER[idx][1], actors = living(d, role);
    if (!(actors.every((u) => d.actions[u] !== undefined) || now >= d.endsAt)) return d;
    const n = { ...d };
    if (d.step === 'seer') actors.forEach((u) => { const t = d.actions[u]?.t; if (t) n.seerLog = { ...n.seerLog, [u]: `${nm(d, t)} : ${d.players[t].role}` }; });
    if (d.step === 'wolves') n.wolfTarget = pickTarget(d.actions, actors, rng);
    if (d.step === 'witch') {
      const a = d.actions[actors[0]] || {}; n.potions = { ...d.potions };
      if (a.save && n.potions.save) { n.pending = { ...n.pending, saved: true }; n.potions.save = 0; }
      if (a.poison && n.potions.poison) { n.pending = { ...n.pending, poisoned: a.poison }; n.potions.poison = 0; }
    }
    const nxt = enterStep(n, now, idx + 1);
    if (nxt) return nxt;
    const r = resolveNight(n.players, { wolfTarget: n.wolfTarget, ...n.pending }, n.lovers);
    const log = [...n.log, r.deaths.length ? r.deaths.map((x) => `${nm(n, x.uid)} est mort (${x.role}).`).join(' ') : 'Personne n’est mort cette nuit.'];
    const winner = checkWin(r.players, n.lovers);
    return { ...n, players: r.players, log, winner, phase: winner ? 'end' : 'day', step: null, pending: {}, wolfTarget: null, endsAt: now + DURATION.day, actions: {} };
  }
  if (d.phase === 'day') {
    const voters = living(d);
    if (!(voters.every((u) => d.actions[u] !== undefined) || now >= d.endsAt)) return d;
    const votes = Object.fromEntries(voters.map((u) => [u, d.actions[u]?.t]));
    const { winner: out } = tally(votes, d.captain);
    const r = out ? killChain(d.players, [out], 'vote', d.lovers) : { players: d.players, deaths: [] };
    const log = [...d.log, r.deaths.length ? r.deaths.map((x) => `${nm(d, x.uid)} est exécuté (${x.role}).`).join(' ') : 'Égalité : personne n’est exécuté.'];
    const winner = checkWin(r.players, d.lovers);
    const n = { ...d, players: r.players, log, winner, day: d.day + 1, actions: {} };
    return winner ? { ...n, phase: 'end' } : { ...enterStep(n, now, 0), phase: 'night', log: [...log, 'La nuit tombe…'] };
  }
  return d;
}
