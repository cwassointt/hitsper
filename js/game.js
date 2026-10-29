// Reglas de HITSTER como funciones puras sobre un estado serializable.
// El estado se muta en el sitio; cada función devuelve true si la acción era válida.

export const MODES = {
  normal: { label: 'Normal', tokens: 2, earn: true, name: false, year: false },
  pro: { label: 'PRO', tokens: 5, earn: false, name: true, year: false },
  expert: { label: 'Experto', tokens: 3, earn: false, name: true, year: true },
};
export const MAX_TOKENS = 5;
export const BUY_COST = 3;
export const COOP_TOKENS = 5;

export function shuffle(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame({ players, songs, coop = false, useTokens = true, target = 10, rnd }) {
  const deck = shuffle(songs.map((s, id) => ({ ...s, id })), rnd);
  const roster = coop ? [{ name: 'Equipo', mode: 'normal' }] : players;
  const tokensOn = coop || useTokens;
  const state = {
    coop, useTokens: tokensOn, target, deck, discard: [],
    players: roster.map(p => ({
      name: p.name,
      mode: coop ? 'normal' : p.mode || 'normal',
      tokens: coop ? COOP_TOKENS : tokensOn ? MODES[p.mode || 'normal'].tokens : 0,
      timeline: [deck.pop()],
    })),
    turn: 0, card: deck.pop(), phase: 'place', slot: null, challenges: [], winner: null, last: null,
  };
  return state;
}

export const active = s => s.players[s.turn];

// Hueco `slot` = antes de timeline[slot]; válido si el año queda entre sus vecinos (iguales cuentan).
export function fits(timeline, slot, year) {
  const prev = timeline[slot - 1], next = timeline[slot];
  return (!prev || prev.year <= year) && (!next || year <= next.year);
}

export function insertSorted(timeline, card) {
  const i = timeline.findIndex(c => c.year > card.year);
  timeline.splice(i < 0 ? timeline.length : i, 0, card);
}

function endByDeck(s) {
  s.phase = 'over';
  const best = Math.max(...s.players.map(p => p.timeline.length));
  s.winner = s.coop ? null : s.players.findIndex(p => p.timeline.length === best);
}

function checkWin(s, idx) {
  if (s.players[idx].timeline.length < s.target) return false;
  s.phase = 'over';
  s.winner = idx;
  return true;
}

// Cambia la canción sin coste (p. ej. si no hay audio disponible).
export function replaceCard(s) {
  if (s.card) s.discard.push(s.card);
  s.card = s.deck.pop() || null;
  s.slot = null;
  if (!s.card) endByDeck(s);
}

export function skip(s) {
  const p = active(s);
  if (s.phase !== 'place' || !s.useTokens || p.tokens < 1) return false;
  p.tokens--;
  replaceCard(s);
  return true;
}

export function buy(s, idx) {
  const p = s.players[idx];
  if (s.phase === 'over' || !s.useTokens || p.tokens < BUY_COST || !s.deck.length) return false;
  p.tokens -= BUY_COST;
  insertSorted(p.timeline, s.deck.pop());
  checkWin(s, idx);
  return true;
}

export const canChallenge = (s, idx) =>
  !s.coop && s.useTokens && idx !== s.turn && s.players[idx].tokens > 0 &&
  !s.challenges.some(c => c.player === idx);

export const slotTaken = (s, slot) => slot === s.slot || s.challenges.some(c => c.slot === slot);

export function place(s, slot) {
  if (s.phase !== 'place' || slot < 0 || slot > active(s).timeline.length) return false;
  s.slot = slot;
  s.phase = s.players.some((_, i) => canChallenge(s, i)) ? 'challenge' : 'reveal';
  return true;
}

export function challenge(s, idx, slot) {
  if (s.phase !== 'challenge' || !canChallenge(s, idx) || slotTaken(s, slot)) return false;
  if (slot < 0 || slot > active(s).timeline.length) return false;
  s.players[idx].tokens--;
  s.challenges.push({ player: idx, slot });
  return true;
}

export function reveal(s) {
  if (s.phase !== 'challenge') return false;
  s.phase = 'reveal';
  return true;
}

// Qué tiene que confirmar el grupo de viva voz antes de resolver.
export function claimsNeeded(s) {
  const out = [];
  const p = active(s), m = MODES[p.mode];
  if (m.name || (m.earn && s.useTokens && !s.coop)) out.push({ player: s.turn, name: true, year: m.year });
  for (const c of s.challenges) {
    const cm = MODES[s.players[c.player].mode];
    if (cm.name && fits(p.timeline, c.slot, s.card.year)) out.push({ player: c.player, name: true, year: cm.year });
  }
  return out;
}

const earns = (player, claim = {}, placedOk) =>
  placedOk && (!MODES[player.mode].name || claim.name) && (!MODES[player.mode].year || claim.year);

// claims: { [indiceJugador]: { name: bool, year: bool } }
export function resolve(s, claims = {}) {
  if (s.phase !== 'reveal') return false;
  const p = active(s), card = s.card, y = card.year;
  let winner = null;
  if (earns(p, claims[s.turn], fits(p.timeline, s.slot, y))) winner = s.turn;
  else {
    const c = s.challenges.find(c => earns(s.players[c.player], claims[c.player], fits(p.timeline, c.slot, y)));
    if (c) winner = c.player;
  }

  if (!s.coop && s.useTokens && MODES[p.mode].earn && claims[s.turn]?.name) {
    p.tokens = Math.min(MAX_TOKENS, p.tokens + 1);
  }

  s.last = { card, turn: s.turn, winner, slot: s.slot, challenges: s.challenges };
  if (winner === null) {
    s.discard.push(card);
    if (s.coop && --p.tokens <= 0) {
      p.tokens = 0;
      s.phase = 'over';
      s.winner = null;
      return true;
    }
  } else {
    insertSorted(s.players[winner].timeline, card);
    if (checkWin(s, winner)) return true;
  }

  s.turn = (s.turn + 1) % s.players.length;
  s.challenges = [];
  s.slot = null;
  s.card = null;
  s.phase = 'place';
  replaceCard(s);
  return true;
}
