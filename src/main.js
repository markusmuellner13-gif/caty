// Bootstrap: wires the Game to menus, saves, settings and input devices.
import { Game } from './game.js';
import { AudioManager } from './audio.js';
import { isTouchDevice, clamp } from './util.js';

const SAVE_KEY = 'percy.save.v1';
const SETTINGS_KEY = 'percy.settings.v1';

const $ = (id) => document.getElementById(id);
const screens = {
  title: $('titleScreen'), howto: $('howToScreen'), settings: $('settingsScreen'),
  pause: $('pauseScreen'), death: $('deathScreen'), win: $('winScreen'),
};
const hud = $('hud');
const canvas = $('game');
const clickCatch = $('clickCatch');

let settingsReturnTo = 'title';
let toastTimer = null;

function show(name) {
  for (const k in screens) screens[k].classList.toggle('visible', k === name);
}
function hideAll() { show('__none__'); }

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ------------------------------------------------------------ audio + game
const audio = new AudioManager();

const game = new Game(canvas, audio, {
  onToast: toast,
  onLevelUp: (lv) => toast(`✨ LEVEL UP — Percy is now level ${lv}!`),
  onCheckpoint: (name, snapshot) => {
    toast(`🐾 Checkpoint: ${name}`);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot)); } catch {}
    $('btnContinue').classList.remove('hidden');
  },
  onDeath: (reason, lives) => {
    $('deathReason').textContent = reason;
    $('deathLives').textContent = lives === 1 ? 'Last life! Careful now…' : `${lives} lives left`;
    show('death');
    document.exitPointerLock?.();
  },
  onWin: (stats) => {
    $('winTime').textContent = stats.time;
    $('winDeaths').textContent = stats.deaths;
    $('winXp').textContent = stats.xp;
    $('winLevel').textContent = stats.level;
    $('winYarn').textContent = `${stats.yarn}/6`;
    show('win');
    hud.classList.remove('visible');
    confetti();
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    $('btnContinue').classList.add('hidden');
    document.exitPointerLock?.();
  },
});

// ------------------------------------------------------------ settings
function loadSettings() {
  let s = { music: 0.6, sfx: 0.8, sens: 1, invertY: false, quality: 'high', palette: 'percy' };
  try { s = { ...s, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch {}
  return s;
}
let settings = loadSettings();

function applySettings() {
  audio.setMusicVol(settings.music);
  audio.setSfxVol(settings.sfx);
  game.settings.sensitivity = settings.sens;
  game.settings.invertY = settings.invertY;
  game.applyQuality(settings.quality);
  if (game.settings.palette !== settings.palette) game.setPalette(settings.palette);
  // reflect in UI
  $('setMusic').value = settings.music;
  $('setSfx').value = settings.sfx;
  $('setSens').value = settings.sens;
  $('setInvertY').checked = settings.invertY;
  for (const b of $('setQuality').children) b.classList.toggle('on', b.dataset.v === settings.quality);
  for (const b of $('setPalette').children) b.classList.toggle('on', b.dataset.v === settings.palette);
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
applySettings();

$('setMusic').addEventListener('input', (e) => { settings.music = +e.target.value; audio.setMusicVol(settings.music); saveSettings(); });
$('setSfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; audio.setSfxVol(settings.sfx); saveSettings(); });
$('setSens').addEventListener('input', (e) => { settings.sens = +e.target.value; game.settings.sensitivity = settings.sens; saveSettings(); });
$('setInvertY').addEventListener('change', (e) => { settings.invertY = e.target.checked; game.settings.invertY = settings.invertY; saveSettings(); });
$('setQuality').addEventListener('click', (e) => {
  const v = e.target.dataset?.v;
  if (!v) return;
  settings.quality = v;
  game.applyQuality(v);
  for (const b of $('setQuality').children) b.classList.toggle('on', b.dataset.v === v);
  saveSettings();
  audio.uiClick?.();
});
$('setPalette').addEventListener('click', (e) => {
  const v = e.target.dataset?.v;
  if (!v) return;
  settings.palette = v;
  game.setPalette(v);
  for (const b of $('setPalette').children) b.classList.toggle('on', b.dataset.v === v);
  saveSettings();
  if (audio.started) audio.meow();
});

// ------------------------------------------------------------ pointer lock
const touchMode = isTouchDevice();
if (touchMode) document.body.classList.add('touch');

function grabPointer() {
  if (touchMode) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && game.state === 'playing' && !game.paused) {
    // Esc released the pointer → pause
    openPause();
  }
  clickCatch.classList.toggle('hidden', locked || game.state !== 'playing' || game.paused || touchMode);
});
clickCatch.addEventListener('click', () => { grabPointer(); });
canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !game.paused) grabPointer();
});

// ------------------------------------------------------------ flow control
function startPlaying() {
  audio.start();
  audio.resume();
  hideAll();
  hud.classList.add('visible');
  game.setPaused(false);
  grabPointer();
  clickCatch.classList.toggle('hidden', true);
}

function openPause() {
  if (game.state !== 'playing') return;
  game.setPaused(true);
  show('pause');
  document.exitPointerLock?.();
}
function closePause() {
  show('__none__');
  game.setPaused(false);
  audio.resume();
  grabPointer();
}

$('btnNewGame').addEventListener('click', () => {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  game.newRun();
  startPlaying();
  toast('🐾 Follow the golden beacon!');
});
$('btnContinue').addEventListener('click', () => {
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch {}
  if (save) game.loadRun(save); else game.newRun();
  startPlaying();
});
$('btnHowTo').addEventListener('click', () => { settingsReturnTo = 'title'; show('howto'); });
$('btnSettings').addEventListener('click', () => { settingsReturnTo = 'title'; show('settings'); });
$('btnPauseSettings').addEventListener('click', () => { settingsReturnTo = 'pause'; show('settings'); });

for (const btn of document.querySelectorAll('.back-btn')) {
  btn.addEventListener('click', () => {
    show(settingsReturnTo);
    if (settingsReturnTo === 'title') show('title');
  });
}

$('pauseBtn').addEventListener('click', openPause);
$('btnResume').addEventListener('click', closePause);
$('btnRestartCp').addEventListener('click', () => {
  game.respawn();
  closePause();
});
$('btnQuit').addEventListener('click', () => {
  game.state = 'title';
  game.setPaused(false);
  hud.classList.remove('visible');
  show('title');
});
$('btnRespawn').addEventListener('click', () => {
  game.respawn();
  startPlaying();
});
$('btnPlayAgain').addEventListener('click', () => {
  clearConfetti();
  game.newRun();
  startPlaying();
});
$('btnWinQuit').addEventListener('click', () => {
  clearConfetti();
  game.state = 'title';
  hud.classList.remove('visible');
  show('title');
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && game.state === 'playing') {
    if (game.paused) closePause(); else openPause();
  }
  if (e.code === 'Escape' && game.state === 'playing' && touchMode) {
    if (game.paused) closePause(); else openPause();
  }
  // respawn shortcut on death screen
  if (e.code === 'Space' && game.state === 'dead' && screens.death.classList.contains('visible')) {
    game.respawn();
    startPlaying();
  }
  if (e.code === 'Enter' && game.state === 'title' && screens.title.classList.contains('visible')) {
    $(localStorage.getItem(SAVE_KEY) ? 'btnContinue' : 'btnNewGame').click();
  }
});

// first user gesture anywhere → boot audio (required by browsers)
window.addEventListener('pointerdown', () => { audio.start(); audio.resume(); }, { once: true });

// show Continue if a save exists
try { if (localStorage.getItem(SAVE_KEY)) $('btnContinue').classList.remove('hidden'); } catch {}

// pause when the tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing' && !game.paused) openPause();
});

// ------------------------------------------------------------ confetti
function confetti() {
  const host = $('confetti');
  const colors = ['#ffb84d', '#ff7a59', '#35e0e0', '#58d68d', '#c86bd9', '#ffe29a'];
  for (let i = 0; i < 90; i++) {
    const d = document.createElement('div');
    d.className = 'confetto';
    d.style.left = `${Math.random() * 100}vw`;
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = `${2.4 + Math.random() * 2.6}s`;
    d.style.animationDelay = `${Math.random() * 1.4}s`;
    d.style.transform = `rotate(${Math.random() * 360}deg)`;
    host.appendChild(d);
  }
}
function clearConfetti() { $('confetti').innerHTML = ''; }

// ------------------------------------------------------------ touch input
if (touchMode) {
  const joy = $('joystick'), knob = $('joyKnob');
  let joyId = null, joyCx = 0, joyCy = 0;
  joy.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2;
    joyCy = r.top + r.height / 2;
    e.preventDefault();
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      const dx = clamp((t.clientX - joyCx) / 48, -1, 1);
      const dy = clamp((t.clientY - joyCy) / 48, -1, 1);
      game.touch.move.x = dx;
      game.touch.move.y = -dy;
      knob.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
    }
    e.preventDefault();
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      game.touch.move.x = 0; game.touch.move.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    }
  };
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // camera drag on the rest of the screen
  let camId = null, lastX = 0, lastY = 0;
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (camId === null && t.clientX > window.innerWidth * 0.35) {
        camId = t.identifier; lastX = t.clientX; lastY = t.clientY;
      }
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== camId) continue;
      game.camYaw -= (t.clientX - lastX) * 0.006 * game.settings.sensitivity;
      game.camPitch = clamp(game.camPitch - (t.clientY - lastY) * 0.005 * (game.settings.invertY ? -1 : 1), -1.15, 0.7);
      lastX = t.clientX; lastY = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  const camEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === camId) camId = null; };
  canvas.addEventListener('touchend', camEnd);
  canvas.addEventListener('touchcancel', camEnd);

  $('btnJump').addEventListener('touchstart', (e) => { game._jumpPressed(); e.preventDefault(); }, { passive: false });
  $('btnSprint').addEventListener('touchstart', (e) => { game.touch.sprint = !game.touch.sprint; e.target.style.opacity = game.touch.sprint ? 1 : 0.7; e.preventDefault(); }, { passive: false });
  $('btnMeow').addEventListener('touchstart', (e) => { audio.meow(); e.preventDefault(); }, { passive: false });
}

// prevent context menu / double-tap zoom weirdness
window.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });

// debug/testing handle
window.__game = game;
