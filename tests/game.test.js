import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { SONGS } from '../js/songs.js';

const card = (year, id = year) => ({ id, year, title: `t${id}`, artist: 'a' });

// Partida controlada: línea de tiempo y carta actual fijadas a mano.
function game(opts = {}, timelines = [[card(1990)], [card(2000)]], current = card(1985)) {
  const s = G.createGame({ players: [{ name: 'Ana' }, { name: 'Beto' }], songs: SONGS, ...opts });
  if (!opts.coop) s.players.forEach((p, i) => (p.timeline = timelines[i]));
  else s.players[0].timeline = timelines[0];
  s.card = current;
  return s;
}

test('fits: antes, entre, después y mismo año', () => {
  const tl = [card(1980), card(1990)];
  assert.ok(G.fits(tl, 0, 1970));
  assert.ok(!G.fits(tl, 0, 1985));
  assert.ok(G.fits(tl, 1, 1985));
  assert.ok(G.fits(tl, 2, 2001));
  assert.ok(G.fits(tl, 1, 1990) && G.fits(tl, 2, 1990));
});

test('colocar bien gana la carta y pasa el turno', () => {
  const s = game();
  s.players[1].tokens = 0; // nadie puede desafiar
  assert.ok(G.place(s, 0));
  assert.equal(s.phase, 'reveal');
  G.resolve(s);
  assert.deepEqual(s.players[0].timeline.map(c => c.year), [1985, 1990]);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'place');
});

test('colocar mal descarta la carta', () => {
  const s = game();
  s.players[1].tokens = 0;
  G.place(s, 1);
  G.resolve(s);
  assert.equal(s.players[0].timeline.length, 1);
  assert.equal(s.discard.at(-1).year, 1985);
});

test('desafío correcto roba la carta y cuesta una ficha', () => {
  const s = game();
  G.place(s, 1);
  assert.equal(s.phase, 'challenge');
  assert.ok(!G.challenge(s, 1, 1), 'no puede usar el mismo hueco');
  assert.ok(G.challenge(s, 1, 0));
  assert.equal(s.players[1].tokens, 1);
  assert.ok(!G.challenge(s, 1, 0), 'solo un desafío por jugador');
  G.reveal(s);
  G.resolve(s);
  assert.deepEqual(s.players[1].timeline.map(c => c.year), [1985, 2000]);
});

test('desafío fallido: el jugador en turno conserva la carta', () => {
  const s = game();
  G.place(s, 0);
  G.challenge(s, 1, 1);
  G.reveal(s);
  G.resolve(s);
  assert.equal(s.players[0].timeline.length, 2);
  assert.equal(s.players[1].tokens, 1);
});

test('decir título y artista da ficha (máx. 5) aunque falle la posición', () => {
  const s = game();
  s.players[1].tokens = 0;
  s.players[0].tokens = 5;
  G.place(s, 1);
  G.resolve(s, { 0: { name: true } });
  assert.equal(s.players[0].tokens, 5);
  const t = game();
  t.players[1].tokens = 0;
  G.place(t, 1);
  G.resolve(t, { 0: { name: true } });
  assert.equal(t.players[0].tokens, 3);
});

test('saltar cuesta 1 ficha y cambia la canción', () => {
  const s = game();
  const before = s.card;
  assert.ok(G.skip(s));
  assert.equal(s.players[0].tokens, 1);
  assert.notEqual(s.card, before);
  s.players[0].tokens = 0;
  assert.ok(!G.skip(s));
});

test('comprar carta con 3 fichas la inserta ordenada', () => {
  const s = game();
  assert.ok(!G.buy(s, 0));
  s.players[0].tokens = 3;
  assert.ok(G.buy(s, 0));
  assert.equal(s.players[0].tokens, 0);
  const years = s.players[0].timeline.map(c => c.year);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
});

test('modo PRO exige título y artista para quedarse la carta', () => {
  const s = game();
  s.players[0].mode = 'pro';
  s.players[1].tokens = 0;
  G.place(s, 0);
  assert.deepEqual(G.claimsNeeded(s), [{ player: 0, name: true, year: false }]);
  G.resolve(s, {});
  assert.equal(s.players[0].timeline.length, 1);
});

test('modo Experto exige además el año exacto', () => {
  const s = game();
  s.players[0].mode = 'expert';
  s.players[1].tokens = 0;
  G.place(s, 0);
  G.resolve(s, { 0: { name: true, year: true } });
  assert.equal(s.players[0].timeline.length, 2);
});

test('gana quien llega al objetivo de cartas', () => {
  const s = game({ target: 2 });
  s.players[1].tokens = 0;
  G.place(s, 0);
  G.resolve(s);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
});

test('cooperativo: fallar resta ficha y con 0 fichas se pierde', () => {
  const s = game({ coop: true }, [[card(1990)]]);
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].tokens, 5);
  G.place(s, 1);
  assert.equal(s.phase, 'reveal', 'sin desafíos en cooperativo');
  G.resolve(s);
  assert.equal(s.players[0].tokens, 4);
  s.players[0].tokens = 1;
  s.card = card(1950);
  G.place(s, 1);
  G.resolve(s);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, null);
});

test('createGame reparte 1 carta y fichas según el modo', () => {
  const s = G.createGame({ players: [{ name: 'A', mode: 'pro' }, { name: 'B', mode: 'expert' }, { name: 'C' }], songs: SONGS });
  assert.deepEqual(s.players.map(p => p.tokens), [5, 3, 2]);
  assert.ok(s.players.every(p => p.timeline.length === 1));
  const n = G.createGame({ players: [{ name: 'A' }], songs: SONGS, useTokens: false });
  assert.equal(n.players[0].tokens, 0);
});

test('el mazo no tiene canciones duplicadas', () => {
  const keys = SONGS.map(s => `${s.artist}|${s.title}`.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
});
