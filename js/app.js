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
  up: '<path d="M12 4l-7 7h4.5v9h5v-9H19z"/>',
  down: '<path d="M12 20l7-7h-4.5V4h-5v9H5z"/>',
  between: '<path d="M12 2l-5 5h3.5v3h3V7H17zM12 22l5-5h-3.5v-3h-3v3H7z"/>',
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
    fadeInAudio();
    audio.play().catch(() => {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Canción misteriosa', artist: 'HITSTER' });
    }
  } else audio.pause();
}
function stopAudio() { audio.pause(); audio.removeAttribute('src'); ui.playing = false; }
audio.addEventListener('play', () => { ui.playing = true; syncDeck(); });
audio.addEventListener('pause', () => { ui.playing = false; syncDeck(); });

// ---------- movimiento ----------
// "system" sigue al sistema operativo; "full" y "reduced" lo fuerzan desde Opciones.
const systemReduce = matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = () => setup.motion === 'reduced' || (setup.motion !== 'full' && systemReduce.matches);
function applyMotion() { document.documentElement.dataset.motion = reduceMotion() ? 'reduced' : 'full'; }
systemReduce.addEventListener?.('change', applyMotion);
applyMotion();
// el navegador solo permite vibrar tras un toque real
const vibrate = p => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(p); };
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

// ---------- tocadiscos ----------
// El plato se conserva entre renders (render() vuelve a colocar el mismo nodo),
// así el giro y el brazo siguen su animación sin saltar.
let platter = null, spinAnim = null, rampRaf = 0, deckOn = false;
const ARM_REST = 4, ARM_PLAY = 26;
const armAt = deg => `rotate(${deg}deg)`;

// El brazo se levanta (crece un poco, como si se acercara), viaja y baja.
function moveArm(on) {
  const arm = platter?.querySelector('.tonearm');
  if (!arm) return;
  const from = getComputedStyle(arm).transform;  // incluye la animación en curso
  arm.getAnimations().forEach(a => a.cancel());
  const end = armAt(on ? ARM_PLAY : ARM_REST);
  arm.style.transform = end;
  if (reduceMotion()) {
    arm.animate([{ transform: from }, { transform: end }], { duration: 250, easing: 'ease' });
    return;
  }
  const up = 'scale(1.07)';
  const frames = on
    ? [{ transform: from }, { transform: `${armAt(ARM_REST + 4)} ${up}`, offset: .22 },
       { transform: `${armAt(ARM_PLAY + 1.5)} ${up}`, offset: .74 }, { transform: end }]
    : [{ transform: from }, { transform: `${armAt(ARM_PLAY - 2)} ${up}`, offset: .2 },
       { transform: `${armAt(ARM_REST + 2)} ${up}`, offset: .82 }, { transform: end }];
  arm.animate(frames, { duration: on ? 950 : 750, easing: EASE_IN_OUT });
}

// El vinilo acelera y frena como un plato real (cambia la velocidad, no salta).
function spinRecord(on, instant = false) {
  const rec = platter?.querySelector('.deck-vinyl');
  if (!rec) return;
  if (!spinAnim || spinAnim.effect?.target !== rec) {
    spinAnim = rec.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1800, iterations: Infinity });
    spinAnim.playbackRate = 0;
  }
  cancelAnimationFrame(rampRaf);
  const target = on && !reduceMotion() ? 1 : 0;
  const anim = spinAnim, start = anim.playbackRate, dur = on ? 700 : 1300, t0 = performance.now();
  if (instant || start === target) { anim.playbackRate = target; return; }
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = on ? 1 - Math.pow(1 - k, 3) : 1 - Math.pow(1 - k, 2);
    anim.playbackRate = start + (target - start) * e;
    if (k < 1) rampRaf = requestAnimationFrame(step);
  };
  rampRaf = requestAnimationFrame(step);
}

// La música entra cuando la aguja toca el disco (en iOS el volumen no se puede tocar y entra directa).
function fadeInAudio() {
  if (reduceMotion()) { audio.volume = 1; return; }
  const t0 = performance.now();
  audio.volume = 0;
  const step = now => {
    const k = Math.min(1, Math.max(0, (now - t0 - 550) / 450));
    audio.volume = k;
    if (k < 1 && !audio.paused) requestAnimationFrame(step);
    else audio.volume = 1;
  };
  requestAnimationFrame(step);
}

function setDeck(on, instant = false) {
  if (!platter) return;
  platter.classList.toggle('on', on);
  if (instant) {
    platter.querySelector('.tonearm').style.transform = armAt(on ? ARM_PLAY : ARM_REST);
    spinRecord(on, true);
  } else if (on !== deckOn) {
    moveArm(on);
    spinRecord(on);
  }
  deckOn = on;
}

// Actualiza el texto y el botón del tocadiscos sin recrear el plato.
function syncDeck() {
  const deck = $app.querySelector('.deck');
  if (!deck) return;
  const fresh = document.createElement('div');
  fresh.innerHTML = disc();
  deck.querySelector('.deck-info').replaceWith(fresh.querySelector('.deck-info'));
  setDeck(ui.playing);
}

// Las animaciones de entrada solo se ejecutan cuando cambia la pantalla o el turno,
// no en cada toque (cada render reemplaza el DOM).
let lastKey = null, phaseAt = 0;
function render() {
  const key = ui.view === 'game' && game ? `${game.phase}:${game.turn}:${game.card?.id}` : `setup:${ui.view}`;
  const entering = key !== lastKey;
  if (entering) { lastKey = key; phaseAt = Date.now(); }

  const oldPlatter = platter;
  $app.innerHTML = (ui.view === 'game' && game ? gameView() : setupView()) + sheetView();
  $app.classList.toggle('entering', entering);
  // reutiliza el plato anterior para que el giro y el brazo no se reinicien
  const fresh = $app.querySelector('.platter');
  if (fresh && oldPlatter) { fresh.replaceWith(oldPlatter); platter = oldPlatter; setDeck(ui.playing); }
  else if (fresh) { platter = fresh; setDeck(ui.playing, true); }
  else { cancelAnimationFrame(rampRaf); platter = null; spinAnim = null; deckOn = false; }
  // índice para escalonar entradas (máx. 10 pasos)
  if (entering) $app.querySelectorAll('.timeline, .setup, .phase').forEach(list =>
    [...list.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10))));

  if (entering && game?.phase === 'reveal') onReveal();
  if (ui.flash) ui.flash.fresh = false;
  ui.sheetFresh = false;
  ui.newRow = null;
  save();
}

// Revelación: el año "rueda" hasta su valor y el móvil vibra según el resultado.
function onReveal() {
  const p = G.active(game), y = game.card.year;
  vibrate(G.fits(p.timeline, game.slot, y) ? 15 : [25, 40, 25]);
  const el = $app.querySelector('.reveal-card .year');
  if (!el || reduceMotion()) return;
  const from = y - 25, t0 = performance.now(), dur = 700;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    el.textContent = Math.round(from + (y - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setupView() {
  const s = setup;
  const players = s.coop ? `<p class="muted">En cooperativo todos sois un único equipo: 5 fichas compartidas, cada fallo resta una. Conseguid ${s.target} cartas antes de quedaros sin fichas.</p>` : `
    <ul class="roster">
      ${s.players.map((p, i) => `
        <li class="${ui.newRow === i ? 'enter' : ''}">
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
      ${vinyl('HIT<br>STER', 'hero-vinyl spin-slow')}
      <h1 class="logo">HITSTER</h1>
      <p>Pon el disco. Adivina el año. Ordena tu colección.</p>
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
      <div class="row stack">
        <span>Animaciones<small>${setup.motion === 'system' || !setup.motion ? 'Sigue el ajuste de tu dispositivo' : setup.motion === 'full' ? 'Todas, aunque el sistema las reduzca' : 'Solo fundidos suaves'}</small></span>
        <div class="segmented" role="radiogroup" aria-label="Animaciones">
          ${[['system', 'Auto'], ['full', 'Todas'], ['reduced', 'Mínimas']].map(([k, l]) =>
            `<button role="radio" aria-checked="${(setup.motion || 'system') === k}" data-action="motion" data-v="${k}">${l}</button>`).join('')}
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
      <span class="logo small">HITSTER</span>
      <button class="icon-btn" data-action="sheet" data-v="rules" aria-label="Reglas">${icon('info')}</button>
    </header>
    ${scoreboard()}
    ${ui.flash ? `<div class="flash ${ui.flash.kind} ${ui.flash.fresh === false ? '' : 'enter'}" role="status">${ui.flash.text}</div>` : ''}
    ${body}
  </div>`;
}

const vinyl = (label = '', cls = '') =>
  `<span class="vinyl ${cls}" aria-hidden="true"><span class="vinyl-label">${label}</span></span>`;

// Tocadiscos: el vinilo gira y el brazo baja mientras suena.
function disc() {
  const t = ui.track, ready = t?.status === 'ready';
  const state = !ready ? 'Buscando canción…' : ui.playing ? 'Sonando' : 'Lista para sonar';
  return `
  <div class="deck">
    <div class="platter ${ui.playing ? 'on' : ''}">
      ${vinyl('?', 'deck-vinyl')}
      <span class="tonearm" aria-hidden="true"></span>
    </div>
    <div class="deck-info">
      <p class="eyebrow">Canción misteriosa</p>
      <p class="player-state" role="status">${ui.playing ? '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}${state}</p>
      <button class="btn play" data-action="play" ${ready ? '' : 'disabled'}>
        ${ready ? icon(ui.playing ? 'pause' : 'play') : '<span class="loader"></span>'}
        ${ui.playing ? 'Pausar' : 'Reproducir'}
      </button>
    </div>
  </div>`;
}

function cardHTML(c) {
  return `<li class="card" style="--h:${hue(c.year)}">
    ${vinyl('', 'sleeve-vinyl')}
    <span class="year">${c.year}</span>
    <span class="meta"><b>${esc(c.title)}</b><span>${esc(c.artist)}</span></span>
  </li>`;
}

// slot(i) devuelve el HTML del hueco i (antes de timeline[i]).
function timeline(tl, slot) {
  let html = slot(0);
  tl.forEach((c, i) => { html += cardHTML(c) + slot(i + 1); });
  return `<ol class="timeline">
    <li class="edge old" aria-hidden="true">${icon('up')} Más antiguas</li>
    ${html}
    <li class="edge new" aria-hidden="true">${icon('down')} Más recientes</li>
  </ol>`;
}

const mystery = (label, cls = '') => `<li class="slot mark ${cls}"><span class="q">?</span><span>${label}</span></li>`;

// Texto del hueco i según sus vecinos: antes / entre / después.
function slotLabel(tl, i) {
  const prev = tl[i - 1], next = tl[i];
  if (!prev && !next) return { kind: 'between', text: 'Aquí' };
  if (!prev) return { kind: 'before', text: `Más antigua que <b>${next.year}</b>` };
  if (!next) return { kind: 'after', text: `Más reciente que <b>${prev.year}</b>` };
  return { kind: 'between', text: `Entre <b>${prev.year}</b> y <b>${next.year}</b>` };
}
const SLOT_ICON = { before: 'up', after: 'down', between: 'between' };
const slotBtn = (tl, i) => {
  const { kind, text } = slotLabel(tl, i);
  return `<li class="slot-li"><button class="slot ${kind}" data-action="slot" data-slot="${i}">${icon(SLOT_ICON[kind])} <span>${text}</span></button></li>`;
};

function placeView() {
  const p = G.active(game);
  const tl = timeline(p.timeline, i => (ui.pick === i ? mystery(`Tu elección · ${slotLabel(p.timeline, i).text}`, 'picked') : slotBtn(p.timeline, i)));
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
    return ui.pick === i ? mystery(esc(game.players[who].name), 'picked') : slotBtn(p.timeline, i);
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
      <div class="cover">
        ${vinyl(c.year, 'cover-vinyl')}
        ${ui.track?.art ? `<img src="${ui.track.art}" alt="Portada de ${esc(c.title)}" width="128" height="128">` : `<span class="cover-blank">${icon('play')}</span>`}
      </div>
      <div class="reveal-info">
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

// Celebración única al ganar: mini vinilos y notas que caen (solo transform/opacity).
function confetti() {
  const bits = Array.from({ length: 22 }, (_, i) => {
    const x = Math.round(Math.random() * 100), d = Math.round(Math.random() * 600);
    const r = Math.round(Math.random() * 720 - 360), s = (0.6 + Math.random() * 0.8).toFixed(2);
    return `<i class="${i % 3 ? 'disc' : 'note'}" style="--x:${x}%;--d:${d}ms;--r:${r}deg;--s:${s}">${i % 3 ? '' : '♪'}</i>`;
  });
  return `<div class="confetti" aria-hidden="true">${bits.join('')}</div>`;
}

function overView() {
  const won = !(game.coop && game.winner === null);
  const ranking = game.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.timeline.length - a.p.timeline.length);
  const title = game.coop
    ? (game.winner === 0 ? '¡Lo habéis conseguido!' : 'Os quedasteis sin fichas')
    : game.winner !== null ? `¡${esc(game.players[game.winner].name)} gana!` : 'Fin de la partida';
  return `
  <section class="phase over">
    ${won ? confetti() : ''}
    ${vinyl(won ? '1.º' : '', `trophy spin-slow ${won ? 'gold' : ''}`)}
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
  return `<div class="sheet-backdrop ${ui.sheetFresh ? 'enter' : ''}" data-action="close-sheet">
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
  stopAudio();
  const players = setup.players.map((p, i) => ({ name: p.name.trim() || `Jugador ${i + 1}`, mode: p.mode }));
  game = G.createGame({ players, songs: SONGS, coop: setup.coop, useTokens: setup.useTokens, target: setup.target });
  ui = { ...ui, view: 'game', sheet: null, challenger: null, pick: null, claims: {}, flash: null, track: null };
  render();
  scrollTo(0, 0);
  loadTrack();
  playIntro();
}

// Intro de partida: el disco cae en el plato, baja la aguja y se anuncia el primer turno.
// Vive fuera de #app para que los renders no la reinicien; un toque la salta.
function playIntro() {
  document.querySelector('.intro')?.remove();
  const p = G.active(game), n = game.players.length;
  const meta = game.coop ? `Cooperativo · ${game.target} cartas` : `${n} jugador${n === 1 ? '' : 'es'} · ${game.target} cartas para ganar`;
  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="intro-deck">
      ${vinyl('HIT<br>STER', 'intro-vinyl')}
      <span class="tonearm intro-arm" aria-hidden="true"></span>
    </div>
    <p class="intro-eyebrow">${game.coop ? 'Primera canción para el equipo' : 'Primera canción para'}</p>
    <h2 class="intro-name">${esc(game.coop ? 'Todos juntos' : p.name)}</h2>
    <p class="intro-meta">${meta}</p>`;
  document.body.append(el);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.add('leaving');
    setTimeout(() => {
      el.remove();
      lastKey = null; // la pantalla de juego entra escalonada al quitarse la intro
      if (ui.view === 'game') render();
    }, reduceMotion() ? 150 : 320);
  };
  el.addEventListener('click', close);
  setTimeout(close, reduceMotion() ? 1300 : 2500);
}

// Diálogo propio con el estilo del juego (sustituye a confirm()).
function askConfirm({ title, text, ok, cancel = 'Cancelar' }) {
  return new Promise(resolve => {
    const back = document.activeElement;
    const el = document.createElement('div');
    el.className = 'dialog-backdrop';
    el.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">
        ${vinyl('?', 'dialog-vinyl')}
        <h2 id="dlg-t">${title}</h2>
        <p id="dlg-d">${text}</p>
        <div class="dialog-actions">
          <button class="btn primary" data-v="1">${ok}</button>
          <button class="btn ghost" data-v="0">${cancel}</button>
        </div>
      </div>`;
    document.body.append(el);
    const btns = [...el.querySelectorAll('button')];
    btns[1].focus({ focusVisible: false }); // la opción segura recibe el foco (sin anillo al tocar)
    const finish = v => {
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('closing');
      setTimeout(() => { el.remove(); back?.focus?.(); resolve(v); }, reduceMotion() ? 0 : 160);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      if (e.key === 'Tab') { // mantiene el foco dentro del diálogo
        e.preventDefault();
        btns[(btns.indexOf(document.activeElement) + 1) % btns.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) finish(b.dataset.v === '1');
      else if (!e.target.closest('.dialog')) finish(false);
    });
  });
}

const actions = {
  'add-player': () => { ui.newRow = setup.players.push({ name: '', mode: 'normal' }) - 1; },
  'remove-player': ({ i }) => setup.players.splice(i, 1),
  coop: ({ v }) => { setup.coop = v === '1'; },
  target: ({ v }) => (setup.target = Math.min(30, Math.max(3, setup.target + Number(v)))),
  start: () => {
    if (!game) { startGame(); return false; }
    const lead = Math.max(...game.players.map(p => p.timeline.length));
    askConfirm({
      title: '¿Nueva partida?',
      text: `La partida en curso se perderá${lead ? ` (el líder lleva ${lead} carta${lead === 1 ? '' : 's'})` : ''}.`,
      ok: 'Empezar de nuevo',
      cancel: 'Seguir con la actual',
    }).then(yes => yes && startGame());
    return false;
  },
  motion: ({ v }) => { setup.motion = v; applyMotion(); },
  resume: () => { ui.view = 'game'; ui.track = null; setTimeout(loadTrack); },
  exit: () => { stopAudio(); ui.view = 'setup'; },
  home: () => { stopAudio(); game = null; ui.view = 'setup'; },
  rematch: () => { startGame(); return false; },
  sheet: ({ v }) => { ui.sheet = v; ui.sheetFresh = true; },
  'close-sheet': () => {
    // la salida es más rápida que la entrada
    $app.querySelector('.sheet-backdrop')?.classList.add('closing');
    setTimeout(() => { ui.sheet = null; render(); }, reduceMotion() ? 0 : 200);
    return false;
  },
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
  if (e.key === 'Escape' && ui.sheet) actions['close-sheet']();
});

render();
