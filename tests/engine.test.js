import { describe, it, expect } from 'vitest';
import { distribute, resolveNight, tally, checkWin, killChain } from '../src/engine/engine.js';
const P = (o) => Object.fromEntries(Object.entries(o).map(([u, role]) => [u, { name: u, role, alive: true }]));
describe('engine', () => {
  it('distributes wolves by player count', () => {
    for (const [n, w] of [[4, 1], [8, 2], [12, 3], [16, 4]]) {
      const l = distribute(n); expect(l).toHaveLength(n); expect(l.filter((r) => r === 'loup')).toHaveLength(w);
    }
  });
  it('witch save cancels the wolf kill', () => {
    const r = resolveNight(P({ a: 'loup', b: 'villageois' }), { wolfTarget: 'b', saved: true }, null);
    expect(r.deaths).toHaveLength(0);
  });
  it('poison + wolf kill both apply, lovers chain follows', () => {
    const r = resolveNight(P({ a: 'loup', b: 'villageois', c: 'villageois', d: 'voyante' }), { wolfTarget: 'b', poisoned: 'd' }, ['b', 'c']);
    expect(r.deaths.map((x) => x.uid).sort()).toEqual(['b', 'c', 'd']);
  });
  it('vote ties kill nobody; captain counts double', () => {
    expect(tally({ a: 'x', b: 'y' }).winner).toBeNull();
    expect(tally({ a: 'x', b: 'y' }, 'a').winner).toBe('x');
  });
  it('win conditions', () => {
    expect(checkWin(P({ a: 'villageois', b: 'voyante' }))).toBe('village');
    expect(checkWin(P({ a: 'loup', b: 'villageois' }))).toBe('wolves');
    const { players } = killChain(P({ a: 'loup', b: 'villageois', c: 'villageois' }), ['c'], 'vote');
    expect(checkWin(players, ['a', 'b'])).toBe('lovers');
  });
});
