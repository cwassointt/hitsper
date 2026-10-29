import { SONGS } from './songs.js';
import * as G from './game.js';
import { findTrack } from './audio.js';

const STORE = 'hitsper:v1';
const $app = document.getElementById('app');
const audio = new Audio();

const saved = load();
let game = saved?.game || null;
let setup = saved?.setup || {
  coop: false, useTokens: true, target: 10,
  players: [{ name: '', mode: 'normal' }, { name: '', mode: 'normal' }],
};
let ui = { view: 'setup', sheet: null, challenger: null, pick: null, claims: {}, flash: null, track: null, playing: false };

// ---------- utilidades ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ game: game?.phase === 'over' ? null : game, setup })); } catch {}
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hue = year => ((Math.floor(year / 10) * 10 - 1950) / 10) * 47 % 360;

const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  users: '<path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.7 0-8 1.3-8 4v3h10v-3c0-1 .4-2 1.2-2.8A13 13 0 0 0 8 13zm8 0c-.3 0-.7 0-1.1.1A4 4 0 0 1 17 17v3h7v-3c0-2.7-5.3-4-8-4z"/>',
  info: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>',
  close: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/>',
  exit: '<path d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h8v-2H4z"/>',
  skip: '<path d="M6 18l8.5-6L6 6zm9-12v12h2V6z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  minus: '<path d="M19 13H5v-2h14z"/>',
  trash: '<path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
};
const icon = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const tokens = n => `<span class="tokens" aria-label="${n} fichas">${'<i></i>'.repeat(n)}${n ? '' : '<em>0</em>'}</span>`;

// ---------- audio ----------
async function loadTrack(tries = 0) {
  const card = game?.card;
  if (!card || ui.track?.id === card.id) return;
  stopAudio();
  ui.track = { id: card.id, status: 'loading' };
  render();
  const t = await findTrack(card);
  if (game?.card?.id !== card.id) return; // la carta cambió mientras buscábamos
  if (!t && tries < 8) {
    G.replaceCard(game);
    ui.track = null;
    save();
    return loadTrack(tries + 1);
  }
  ui.track = t ? { id: card.id, status: 'ready', ...t } : { id: card.id, status: 'missing' };
  render();
  // precarga la siguiente
  if (game.deck.length) findTrack(game.deck.at(-1));
}

function togglePlay() {
  const t = ui.track;
  if (t?.status !== 'ready') return;
  if (audio.src !== t.preview) audio.src = t.preview;
  if (audio.paused) {
    audio.play().catch(() => {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Canción misteriosa', artist: 'HITSTER' });
    }
  } else audio.pause();
}
function stopAudio() { audio.pause(); audio.removeAttribute('src'); ui.playing = false; }
audio.addEventListener('play', () => { ui.playing = true; render(); });
audio.addEventListener('pause', () => { ui.playing = false; render(); });

// ---------- vistas ----------
let lastPhase = null, phaseAt = 0;
function render() {
  if (game?.phase !== lastPhase) { lastPhase = game?.phase; phaseAt = Date.now(); }
  $app.innerHTML = (ui.view === 'game' && game ? gameView() : setupView()) + sheetView();
  save();
}

function setupView() {
  const s = setup;
  const players = s.coop ? `<p class="muted">En cooperativo todos sois un único equipo: 5 fichas compartidas, cada fallo resta una. Conseguid ${s.target} cartas antes de quedaros sin fichas.</p>` : `
    <ul class="roster">
      ${s.players.map((p, i) => `
        <li>
          <span class="avatar" style="--h:${i * 67}">${i + 1}</span>
          <input data-field="name" data-i="${i}" value="${esc(p.name)}" placeholder="Jugador ${i + 1}" aria-label="Nombre del jugador ${i + 1}" maxlength="18">
          <select data-field="mode" data-i="${i}" aria-label="Dificultad del jugador ${i + 1}">
            ${Object.entries(G.MODES).map(([k, m]) => `<option value="${k}" ${p.mode === k ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
          <button class="icon-btn" data-action="remove-player" data-i="${i}" aria-label="Quitar jugador" ${s.players.length <= 1 ? 'disabled' : ''}>${icon('trash')}</button>
        </li>`).join('')}
    </ul>
    <button class="btn ghost small" data-action="add-player" ${s.players.length >= 10 ? 'disabled' : ''}>${icon('plus')} Añadir jugador</button>
    <p class="muted small">Normal: 2 fichas. PRO: 5 fichas, hay que decir título y artista. Experto: 3 fichas, además el año exacto.</p>`;

  return `
  <main class="setup">
    <header class="hero">
      <h1 class="logo">HIT<span>STER</span></h1>
      <p>Escucha. Adivina el año. Construye tu línea del tiempo.</p>
    </header>
    ${game ? `<button class="btn primary wide" data-action="resume">Continuar partida</button>` : ''}
    <section class="panel">
      <h2>Modo de juego</h2>
      <div class="segmented" role="radiogroup" aria-label="Modo de juego">
        <button role="radio" aria-checked="${!s.coop}" data-action="coop" data-v="0">Competitivo</button>
        <button role="radio" aria-checked="${s.coop}" data-action="coop" data-v="1">Cooperativo</button>
      </div>
    </section>
    <section class="panel">
      <h2>Jugadores</h2>
      ${players}
    </section>
    <section class="panel">
      <h2>Opciones</h2>
      ${s.coop ? '' : `
      <label class="row toggle">
        <span>Jugar con fichas HITSTER<small>Saltar, desafiar y comprar cartas</small></span>
        <input type="checkbox" data-field="useTokens" ${s.useTokens ? 'checked' : ''}>
      </label>`}
      <div class="row">
        <span>Cartas para ganar</span>
        <div class="stepper">
          <button class="icon-btn" data-action="target" data-v="-1" aria-label="Menos cartas">${icon('minus')}</button>
          <output>${s.target}</output>
          <button class="icon-btn" data-action="target" data-v="1" aria-label="Más cartas">${icon('plus')}</button>
        </div>
      </div>
    </section>
    <button class="btn primary wide big" data-action="start">${game ? 'Nueva partida' : 'Empezar partida'}</button>
    <button class="btn ghost wide" data-action="sheet" data-v="rules">${icon('info')} Cómo se juega</button>
    <p class="muted small center">${SONGS.length} canciones · fragmentos de 30 s vía iTunes</p>
  </main>`;
}

function scoreboard() {
  return `<button class="scoreboard" data-action="sheet" data-v="players" aria-label="Ver jugadores">
    ${game.players.map((p, i) => `
      <span class="chip ${i === game.turn ? 'is-turn' : ''}" style="--h:${i * 67}">
        <b>${esc(p.name)}</b>
        <span class="count">${p.timeline.length}<small>/${game.target}</small></span>
        ${game.useTokens ? tokens(p.tokens) : ''}
      </span>`).join('')}
  </button>`;
}

function gameView() {
  const body = { place: placeView, challenge: challengeView, reveal: revealView, over: overView }[game.phase]();
  return `
  <div class="game">
    <header class="topbar">
      <button class="icon-btn" data-action="exit" aria-label="Salir al menú">${icon('exit')}</button>
      <span class="logo small">HIT<span>STER</span></span>
      <button class="icon-btn" data-action="sheet" data-v="rules" aria-label="Reglas">${icon('info')}</button>
    </header>
    ${scoreboard()}
    ${ui.flash ? `<div class="flash ${ui.flash.kind}" role="status">${ui.flash.text}</div>` : ''}
    ${body}
  </div>`;
}

function disc() {
  const t = ui.track;
  const label = !t || t.status === 'loading' ? 'Buscando canción…' : ui.playing ? 'Pausar' : 'Reproducir';
  return `
  <div class="player">
    <button class="disc ${ui.playing ? 'spinning' : ''}" data-action="play" aria-label="${label}" ${t?.status !== 'ready' ? 'disabled' : ''}>
      <span class="disc-label">${t?.status === 'ready' ? icon(ui.playing ? 'pause' : 'play') : '<span class="loader"></span>'}</span>
    </button>
    <div>
      <p class="eyebrow">Canción misteriosa</p>
      <p class="player-state">${label}</p>
    </div>
  </div>`;
}

function cardHTML(c) {
  return `<li class="card" style="--h:${hue(c.year)}">
    <span class="year">${c.year}</span>
    <span class="meta"><b>${esc(c.title)}</b><span>${esc(c.artist)}</span></span>
  </li>`;
}

// slot(i) devuelve el HTML del hueco i (antes de timeline[i]).
function timeline(tl, slot) {
  let html = slot(0);
  tl.forEach((c, i) => { html += cardHTML(c) + slot(i + 1); });
  return `<ol class="timeline">${html}</ol>`;
}

const mystery = (label, cls = '') => `<li class="slot mark ${cls}"><span class="q">?</span><span>${label}</span></li>`;
const slotBtn = (i, label = 'Aquí') => `<li class="slot-li"><button class="slot" data-action="slot" data-slot="${i}" aria-label="Colocar en la posición ${i + 1}">${icon('plus')} ${label}</button></li>`;

function placeView() {
  const p = G.active(game);
  const tl = timeline(p.timeline, i => (ui.pick === i ? mystery('Tu elección', 'picked') : slotBtn(i)));
  return `
  <section class="phase">
    <p class="eyebrow">Turno de</p>
    <h2 class="turn-name">${esc(p.name)} <span class="badge">${G.MODES[p.mode].label}</span></h2>
    ${disc()}
    <p class="hint">Escucha la canción y toca el hueco donde crees que va. Puedes decir en voz alta el título y el artista${game.coop ? '' : ' para ganar fichas'}.</p>
    ${tl}
    <div class="actions sticky">
      ${game.useTokens ? `<button class="btn ghost" data-action="skip" ${p.tokens < 1 ? 'disabled' : ''}>${icon('skip')} Saltar · 1</button>` : ''}
      <button class="btn primary" data-action="confirm-place" ${ui.pick === null ? 'disabled' : ''}>Confirmar</button>
    </div>
  </section>`;
}

function challengeView() {
  const p = G.active(game);
  const who = ui.challenger;
  const tl = timeline(p.timeline, i => {
    if (i === game.slot) return mystery(esc(p.name), 'owner');
    const c = game.challenges.find(c => c.slot === i);
    if (c) return mystery(`<b>¡HITSTER!</b> ${esc(game.players[c.player].name)}`, 'rival');
    if (who === null) return '<li class="slot-li"><span class="slot ghosted"></span></li>';
    return ui.pick === i ? mystery(esc(game.players[who].name), 'picked') : slotBtn(i, 'Aquí');
  });
  const rivals = game.players.map((r, i) => G.canChallenge(game, i) ? `
    <button class="btn hitster ${who === i ? 'active' : ''}" data-action="challenger" data-i="${i}">
      ¡HITSTER! <small>${esc(r.name)} · ${r.tokens} ficha${r.tokens === 1 ? '' : 's'}</small>
    </button>` : '').join('');
  return `
  <section class="phase">
    ${disc()}
    <h2>¿Alguien grita ¡HITSTER!?</h2>
    <p class="hint">${who === null
      ? `Si crees que ${esc(p.name)} se equivocó, pulsa tu nombre y pon tu ficha en el hueco correcto. Cuesta 1 ficha.`
      : `${esc(game.players[who].name)}: elige otro hueco en la línea de ${esc(p.name)}.`}</p>
    ${rivals ? `<div class="rivals">${rivals}</div>` : ''}
    ${tl}
    <div class="actions sticky">
      ${who === null
        ? `<button class="btn primary" data-action="reveal">Revelar carta</button>`
        : `<button class="btn ghost" data-action="challenger" data-i="${who}">Cancelar</button>
           <button class="btn primary" data-action="confirm-challenge" ${ui.pick === null ? 'disabled' : ''}>Poner ficha</button>`}
    </div>
  </section>`;
}

function revealView() {
  const p = G.active(game), c = game.card;
  const ok = slot => G.fits(p.timeline, slot, c.year);
  const tl = timeline(p.timeline, i => {
    if (i === game.slot) return mystery(`${esc(p.name)} ${ok(i) ? '✓' : '✗'}`, ok(i) ? 'right' : 'wrong');
    const ch = game.challenges.find(x => x.slot === i);
    if (ch) return mystery(`${esc(game.players[ch.player].name)} ${ok(i) ? '✓' : '✗'}`, ok(i) ? 'right' : 'wrong');
    return '';
  });
  const claims = G.claimsNeeded(game).map(n => {
    const who = game.players[n.player], cl = ui.claims[n.player] || {};
    return `<fieldset class="claim">
      <legend>${esc(who.name)}${n.player === game.turn && G.MODES[who.mode].earn ? ' · ¿gana ficha?' : ''}</legend>
      <label class="row toggle"><span>Dijo título y artista</span><input type="checkbox" data-action="claim" data-i="${n.player}" data-k="name" ${cl.name ? 'checked' : ''}></label>
      ${n.year ? `<label class="row toggle"><span>Dijo el año exacto</span><input type="checkbox" data-action="claim" data-i="${n.player}" data-k="year" ${cl.year ? 'checked' : ''}></label>` : ''}
    </fieldset>`;
  }).join('');
  return `
  <section class="phase">
    <div class="reveal-card" style="--h:${hue(c.year)}">
      ${ui.track?.art ? `<img src="${ui.track.art}" alt="" width="120" height="120">` : ''}
      <div>
        <span class="year big">${c.year}</span>
        <b>${esc(c.title)}</b>
        <span>${esc(c.artist)}</span>
      </div>
    </div>
    ${claims ? `<div class="claims"><p class="hint">Confirmad lo que se dijo en voz alta:</p>${claims}</div>` : ''}
    ${tl}
    <div class="actions sticky">
      <button class="btn primary" data-action="resolve">Siguiente turno</button>
    </div>
  </section>`;
}

function overView() {
  const ranking = game.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.timeline.length - a.p.timeline.length);
  const title = game.coop
    ? (game.winner === 0 ? '¡Lo habéis conseguido!' : 'Os quedasteis sin fichas')
    : game.winner !== null ? `¡${esc(game.players[game.winner].name)} gana!` : 'Fin de la partida';
  return `
  <section class="phase over">
    <div class="trophy" aria-hidden="true">★</div>
    <h2 class="turn-name">${title}</h2>
    <ol class="ranking">
      ${ranking.map(({ p, i }) => `<li style="--h:${i * 67}"><b>${esc(p.name)}</b><span>${p.timeline.length} carta${p.timeline.length === 1 ? '' : 's'}</span></li>`).join('')}
    </ol>
    <div class="actions">
      <button class="btn primary" data-action="rematch">Revancha</button>
      <button class="btn ghost" data-action="home">Menú</button>
    </div>
  </section>`;
}

function sheetView() {
  if (!ui.sheet) return '';
  const content = ui.sheet === 'rules' ? rulesHTML() : playersHTML();
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${ui.sheet === 'rules' ? 'Reglas' : 'Jugadores'}" data-stop>
      <button class="icon-btn sheet-close" data-action="close-sheet" aria-label="Cerrar">${icon('close')}</button>
      ${content}
    </div>
  </div>`;
}

function playersHTML() {
  return `<h2>Jugadores</h2>${game.players.map((p, i) => `
    <section class="pl" style="--h:${i * 67}">
      <header>
        <b>${esc(p.name)}</b> <span class="badge">${G.MODES[p.mode].label}</span>
        ${game.useTokens ? tokens(p.tokens) : ''}
      </header>
      <ol class="mini">${p.timeline.map(c => `<li><span style="--h:${hue(c.year)}">${c.year}</span>${esc(c.title)} — ${esc(c.artist)}</li>`).join('')}</ol>
      ${game.useTokens ? `<button class="btn ghost small" data-action="buy" data-i="${i}" ${p.tokens < G.BUY_COST || game.phase === 'over' ? 'disabled' : ''}>Comprar carta · 3 fichas</button>` : ''}
    </section>`).join('')}`;
}

function rulesHTML() {
  return `<h2>Cómo se juega</h2>
  <div class="rules">
    <p><b>Objetivo:</b> gana quien coloque primero ${setup.target} cartas en su línea del tiempo. No hace falta saber el año exacto: solo si la canción es anterior, posterior o está entre tus cartas.</p>
    <h3>Tu turno</h3>
    <ol>
      <li>Reproduce la canción misteriosa.</li>
      <li>Toca el hueco de tu línea donde crees que va.</li>
      <li>Los rivales pueden desafiarte. Después se revela la carta: si acertaste, te la quedas. Si coincide el año con otra carta, vale delante o detrás.</li>
    </ol>
    <h3>Fichas HITSTER</h3>
    <ul>
      <li><b>Saltar</b> (1 ficha): cambia la canción en tu turno.</li>
      <li><b>¡HITSTER!</b> (1 ficha): en el turno de otro, pon tu ficha en el hueco que creas correcto. Si el jugador en turno falla y tú aciertas, te quedas la carta. Gana el primero que la ponga; no puede haber dos fichas en el mismo hueco.</li>
      <li><b>Comprar</b> (3 fichas): en cualquier momento, desde <i>Jugadores</i>, añade una carta directamente.</li>
      <li><b>Ganar fichas:</b> di el título y el artista en tu turno (aunque falles la posición). Máximo 5.</li>
    </ul>
    <h3>Dificultades</h3>
    <ul>
      <li><b>PRO:</b> debes decir artista y título para quedarte o robar la carta. 5 fichas, no ganas más.</li>
      <li><b>Experto:</b> además el año exacto. 3 fichas, no ganas más.</li>
      <li><b>Cooperativo:</b> un único equipo con 5 fichas. Cada fallo resta una. Ganáis si llegáis al objetivo antes de quedaros sin fichas.</li>
    </ul>
  </div>`;
}

// ---------- acciones ----------
function flashFromLast() {
  const l = game.last;
  if (!l) return null;
  const c = `«${esc(l.card.title)}» (${l.card.year})`;
  if (l.winner === null) return { kind: 'bad', text: `Nadie se queda ${c}.` };
  if (l.winner === l.turn) return { kind: 'good', text: `${esc(game.players[l.winner].name)} se queda ${c}.` };
  return { kind: 'steal', text: `¡${esc(game.players[l.winner].name)} roba ${c}!` };
}

function startGame() {
  const players = setup.players.map((p, i) => ({ name: p.name.trim() || `Jugador ${i + 1}`, mode: p.mode }));
  game = G.createGame({ players, songs: SONGS, coop: setup.coop, useTokens: setup.useTokens, target: setup.target });
  ui = { ...ui, view: 'game', sheet: null, challenger: null, pick: null, claims: {}, flash: null, track: null };
  render();
  loadTrack();
}

const actions = {
  'add-player': () => setup.players.push({ name: '', mode: 'normal' }),
  'remove-player': ({ i }) => setup.players.splice(i, 1),
  coop: ({ v }) => (setup.coop = v === '1'),
  target: ({ v }) => (setup.target = Math.min(30, Math.max(3, setup.target + Number(v)))),
  start: () => {
    if (game && !confirm('¿Empezar una nueva partida? Se perderá la actual.')) return false;
    startGame();
    return false;
  },
  resume: () => { ui.view = 'game'; ui.track = null; setTimeout(loadTrack); },
  exit: () => { stopAudio(); ui.view = 'setup'; },
  home: () => { stopAudio(); game = null; ui.view = 'setup'; },
  rematch: () => { startGame(); return false; },
  sheet: ({ v }) => (ui.sheet = v),
  'close-sheet': () => (ui.sheet = null),
  play: () => { togglePlay(); return false; },
  slot: ({ slot }) => (ui.pick = Number(slot)),
  'confirm-place': () => { G.place(game, ui.pick); ui.pick = null; ui.flash = null; },
  skip: () => {
    if (!G.skip(game)) return;
    ui.pick = null;
    ui.flash = { kind: 'info', text: 'Canción saltada.' };
    setTimeout(loadTrack);
  },
  challenger: ({ i }) => { ui.challenger = ui.challenger === Number(i) ? null : Number(i); ui.pick = null; },
  'confirm-challenge': () => { G.challenge(game, ui.challenger, ui.pick); ui.challenger = null; ui.pick = null; },
  reveal: () => { G.reveal(game); },
  claim: ({ i, k }, el) => { (ui.claims[i] ||= {})[k] = el.checked; },
  resolve: () => {
    G.resolve(game, ui.claims);
    ui.claims = {};
    ui.flash = flashFromLast();
    if (game.phase !== 'over') setTimeout(loadTrack);
    else stopAudio();
  },
  buy: ({ i }) => {
    if (!G.buy(game, Number(i))) return;
    const p = game.players[i];
    ui.flash = { kind: 'info', text: `${esc(p.name)} compra una carta.` };
    if (game.phase === 'over') { ui.sheet = null; stopAudio(); }
  },
};

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.classList.contains('sheet-backdrop') && e.target.closest('[data-stop]')) return;
  if (el.type === 'checkbox') return; // los checkbox van por 'change'
  // evita que un doble toque pulse el botón de la fase siguiente (misma posición)
  if (el.closest('.actions') && Date.now() - phaseAt < 500) return;
  const fn = actions[el.dataset.action];
  if (fn && fn(el.dataset, el) !== false) render();
});

$app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.action === 'claim') return actions.claim(el.dataset, el), render();
  const f = el.dataset.field;
  if (f === 'mode') setup.players[el.dataset.i].mode = el.value;
  if (f === 'useTokens') setup.useTokens = el.checked;
  save();
});

$app.addEventListener('input', e => {
  if (e.target.dataset.field === 'name') { setup.players[e.target.dataset.i].name = e.target.value; save(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); }
});

render();
