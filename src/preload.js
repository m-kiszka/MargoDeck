'use strict';

const { ipcRenderer, webFrame } = require('electron');

const CHORD_MOD = 'LB';
const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'DUp', 'DDown', 'DLeft', 'DRight', 'Guide'];

let mapping = null;
let LOCALES = {};
let lang = 'pl';
const languageName = (code) => LOCALES[code]?._name || code;
function t(text, ...args) {
  const dict = LOCALES[lang] || {};
  let out = dict[text] != null ? dict[text] : text;
  args.forEach((v, i) => { out = out.replace(`{${i}}`, v); });
  return out;
}
const setLanguage = (m) => { lang = LOCALES[m?.language] ? m.language : (LOCALES.pl ? 'pl' : 'en'); };

const prevButtons = new Array(BUTTON_NAMES.length).fill(false);
const heldKeys = new Set();
const chordUsed = new Set();
const nudgeUsed = new Set();
let cursor = { x: 640, y: 400, visible: true, lastMove: 0 };
let cursorEl = null;

const sendKey = (key, down) => ipcRenderer.send('md:key', { key, down });
const recentSent = [];
const sendMouse = (kind, button = 'left') => {
  recentSent.push({ x: cursor.x, y: cursor.y });
  if (recentSent.length > 30) recentSent.shift();
  ipcRenderer.send('md:mouse', { kind, x: cursor.x, y: cursor.y, button });
};

function setKey(key, wanted) {
  if (!key) return;
  if (wanted && !heldKeys.has(key)) { heldKeys.add(key); sendKey(key, true); }
  if (!wanted && heldKeys.has(key)) { heldKeys.delete(key); sendKey(key, false); }
}
const releaseAllKeys = () => [...heldKeys].forEach((k) => setKey(k, false));

function runAction(action, down) {
  if (!action) return;
  if (down && Array.isArray(action.also)) action.also.forEach((t) => ipcRenderer.send('md:action', t));
  switch (action.type) {
    case 'key': sendKey(action.key, down); break;
    case 'keys': (action.keys || []).forEach((k) => sendKey(k, down)); break;
    case 'click': sendMouse(down ? 'down' : 'up', 'left'); break;
    case 'rightclick': sendMouse(down ? 'down' : 'up', 'right'); break;
    case 'toggleCursor': if (down) { cursor.visible = !cursor.visible; drawCursor(); } break;
    case 'centerCursor': if (down) centerCursorOnHero(); break;
    case 'nudgeModifier': break;
    case 'focusNext': if (down) jumpToTarget(1); break;
    case 'focusPrev': if (down) jumpToTarget(-1); break;
    case 'toggleHelp': if (down) toggleMenu(); break;
    case 'none': break;
    default: if (down) ipcRenderer.send('md:action', action.type);
  }
}

const TILE = 32;
const HERO_POS_SCRIPT = `(() => {
  const E = window.Engine;
  const canvas = document.getElementById('GAME_CANVAS');
  if (!E || !E.hero || !E.hero.d || !E.map || !E.map.offset || !canvas) return null;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !canvas.width) return null;
  let zoom = 1;
  try { zoom = (E.zoomManager && E.zoomManager.getActualZoom()) || 1; } catch (e) {}
  const scale = (r.width / canvas.width) * zoom;
  return {
    x: r.left + (E.hero.d.x * ${TILE} + ${TILE / 2} - E.map.offset[0]) * scale,
    y: r.top + (E.hero.d.y * ${TILE} + ${TILE / 2} - E.map.offset[1]) * scale,
    tile: ${TILE} * scale,
  };
})()`;

function fallbackHeroPos() {
  const canvas = document.getElementById('GAME_CANVAS');
  const r = canvas ? canvas.getBoundingClientRect() : null;
  if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, tile: TILE };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2, tile: TILE };
}

async function heroScreenPos() {
  try {
    const p = await webFrame.executeJavaScript(HERO_POS_SCRIPT);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch (_) {}
  return fallbackHeroPos();
}

const TARGETS_SCRIPT = `(() => {
  const SELECTOR = 'input:not([type=hidden]), textarea, select, button, a[href], [contenteditable=""], [contenteditable=true], [tabindex], [role=button], [onclick]';
  const vw = innerWidth, vh = innerHeight;
  const jq = window.jQuery || window.$;
  const hasHandlers = (el) => {
    if (el.onclick || el.onmousedown || el.onmouseup) return true;
    if (jq && jq._data) {
      const ev = jq._data(el, 'events');
      if (ev && (ev.click || ev.mousedown || ev.mouseup || ev.pointerdown || ev.touchstart)) return true;
    }
    return false;
  };
  const set = new Set(document.querySelectorAll(SELECTOR));
  for (const el of document.body.getElementsByTagName('*')) {
    if (!set.has(el) && hasHandlers(el)) set.add(el);
  }
  const isCandidate = (el) => set.has(el);
  const out = [];
  for (const el of set) {
    if (el.id === 'GAME_CANVAS' || el.closest('#md-menu, #md-sheet, #margodeck-cursor, #md-focus')) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.width * r.height > vw * vh * 0.5) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) continue;
    let owner = hit;
    while (owner && !isCandidate(owner)) owner = owner.parentElement;
    if (owner !== el) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || +st.opacity === 0) continue;
    out.push({ x: cx, y: cy, l: r.left, t: r.top, w: r.width, h: r.height });
  }
  return out;
})()`;

const ROW_TOLERANCE = 12;
let lastTarget = null;
let focusEl = null;
let focusTimer = null;

const readingOrder = (a, b) => (Math.abs(a.y - b.y) <= ROW_TOLERANCE ? a.x - b.x : a.y - b.y);

function showFocusBox(t) {
  if (!focusEl || !document.documentElement.contains(focusEl)) {
    focusEl = document.createElement('div');
    focusEl.id = 'md-focus';
    Object.assign(focusEl.style, {
      position: 'fixed', zIndex: '2147483644', pointerEvents: 'none', borderRadius: '4px',
      border: '2px solid #f0c86a', boxShadow: '0 0 0 2px rgba(0,0,0,.6), 0 0 12px rgba(240,200,106,.7)',
      transition: 'opacity .3s',
    });
    document.documentElement.appendChild(focusEl);
  }
  Object.assign(focusEl.style, {
    left: `${t.l - 3}px`, top: `${t.t - 3}px`, width: `${t.w + 6}px`, height: `${t.h + 6}px`, opacity: '1',
  });
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { if (focusEl) focusEl.style.opacity = '0'; }, 1500);
}

async function jumpToTarget(dir) {
  let targets = [];
  try { targets = (await webFrame.executeJavaScript(TARGETS_SCRIPT)) || []; } catch (_) {}
  if (!targets.length) return;
  targets.sort(readingOrder);
  const from = lastTarget && Math.abs(lastTarget.x - cursor.x) < 2 && Math.abs(lastTarget.y - cursor.y) < 2
    ? lastTarget
    : { x: cursor.x, y: cursor.y };
  let next;
  if (dir > 0) next = targets.find((t) => readingOrder(t, from) > 0) || targets[0];
  else next = [...targets].reverse().find((t) => readingOrder(t, from) < 0) || targets[targets.length - 1];
  lastTarget = { x: next.x, y: next.y };
  cursor.x = next.x;
  cursor.y = next.y;
  cursor.visible = true;
  cursor.lastMove = performance.now();
  realMouseActive = false;
  sendMouse('move');
  drawCursor();
  showFocusBox(next);
}

const NUDGE_INTERVAL_MS = 80;
let nudgeBusy = false;
let nudgeLast = 0;

function nudgeTowards(dx, dy) {
  const now = performance.now();
  if (nudgeBusy || now - nudgeLast < NUDGE_INTERVAL_MS) return;
  nudgeBusy = true;
  nudgeLast = now;
  centerCursorOnHero(dx, dy).finally(() => { nudgeBusy = false; });
}

async function centerCursorOnHero(dx = 0, dy = 0) {
  const p = await heroScreenPos();
  const step = (p.tile || TILE) * (mapping.nudgeTiles ?? 1);
  cursor.x = Math.max(0, Math.min(window.innerWidth - 1, p.x + dx * step));
  cursor.y = Math.max(0, Math.min(window.innerHeight - 1, p.y + dy * step));
  cursor.visible = true;
  cursor.lastMove = performance.now();
  realMouseActive = false;
  sendMouse('move');
  drawCursor();
}

const DEFAULT_ARROW = {
  src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><path d='M2 1 L2 18 L7 13 L10 20 L13 19 L10 12 L17 12 Z' fill='white' stroke='black' stroke-width='1.5'/></svg>",
  hx: 2, hy: 1,
};
let cursorImg = null;
let currentCursorKey = '';
let lastStyleCheck = 0;
let realMouseActive = false;

function ensureOverlay() {
  if (cursorEl && document.documentElement.contains(cursorEl)) return;
  cursorEl = document.createElement('div');
  cursorEl.id = 'margodeck-cursor';
  Object.assign(cursorEl.style, {
    position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', lineHeight: '0',
  });
  cursorImg = document.createElement('img');
  cursorImg.draggable = false;
  cursorEl.appendChild(cursorImg);
  document.documentElement.appendChild(cursorEl);
  currentCursorKey = '';
  applyCursorStyle(DEFAULT_ARROW);
  drawCursor();
}

function parseCssCursor(value) {
  const m = /url\(\s*["']?([^"')]+)["']?\s*\)\s*(\d+)?\s*(\d+)?/.exec(value || '');
  if (!m) return null;
  return { src: m[1], hx: +(m[2] || 0), hy: +(m[3] || 0) };
}

function applyCursorStyle(c) {
  const key = `${c.src}|${c.hx}|${c.hy}`;
  if (key === currentCursorKey) return;
  currentCursorKey = key;
  cursorImg.src = c.src;
  cursorEl.style.transform = `translate(${-c.hx}px, ${-c.hy}px)`;
}

function syncCursorStyle() {
  const now = performance.now();
  if (now - lastStyleCheck < 100) return;
  lastStyleCheck = now;
  cursorEl.style.display = 'none';
  const el = document.elementFromPoint(cursor.x, cursor.y);
  let parsed = null;
  for (let n = el; n && n.nodeType === 1 && !parsed; n = n.parentElement) {
    const v = getComputedStyle(n).cursor;
    parsed = parseCssCursor(v);
    if (!parsed && v !== 'auto') break;
  }
  applyCursorStyle(parsed || DEFAULT_ARROW);
}

function drawCursor() {
  if (!cursorEl) return;
  const idle = performance.now() - cursor.lastMove > 4000;
  const show = cursor.visible && !idle && !realMouseActive && !menu;
  if (show) syncCursorStyle();
  cursorEl.style.display = show ? 'block' : 'none';
  cursorEl.style.left = cursor.x + 'px';
  cursorEl.style.top = cursor.y + 'px';
}

window.addEventListener('mousemove', (e) => {
  const near = (p) => Math.abs(e.clientX - p.x) <= 2 && Math.abs(e.clientY - p.y) <= 2;
  if (!near(cursor) && !recentSent.some(near)) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    realMouseActive = true;
  }
}, true);

const SLOT_GROUPS = [
  { group: 'buttons', title: 'Buttons', names: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'Start', 'Back'] },
  { group: 'chords', title: 'Hold L1 +', names: ['A', 'B', 'X', 'Y', 'RB', 'LT', 'RT', 'LS', 'RS', 'Start', 'DUp', 'DDown', 'DLeft', 'DRight'] },
  { group: 'dpad', title: 'D-pad', names: ['up', 'down', 'left', 'right'] },
  { group: 'leftStick', title: 'Left stick', names: ['up', 'down', 'left', 'right'] },
];
const KEY_ONLY_GROUPS = new Set(['dpad', 'leftStick']);
const LABELS = {
  Back: 'View', Start: 'Menu', LS: 'L3', RS: 'R3', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2',
  up: '↑', down: '↓', left: '←', right: '→',
};
const DPAD_ARROWS = { DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→' };
const buttonLabel = (n) => (DPAD_ARROWS[n] ? `${t('D-pad')} ${DPAD_ARROWS[n]}` : LABELS[n] || n);

const ACTIONS = [
  { type: 'key', label: 'Keyboard key…' },
  { type: 'click', label: 'Left click' },
  { type: 'rightclick', label: 'Right click' },
  { type: 'keyboard', label: 'Steam on-screen keyboard' },
  { type: 'closePopup', label: 'Close popup window' },
  { type: 'centerCursor', label: 'Center cursor on character' },
  { type: 'nudgeModifier', label: 'Hold + D-pad / right stick: cursor next to character' },
  { type: 'focusNext', label: 'Jump to next field / button' },
  { type: 'focusPrev', label: 'Jump to previous field / button' },
  { type: 'toggleCursor', label: 'Show / hide cursor' },
  { type: 'zoomIn', label: 'Zoom in' },
  { type: 'zoomOut', label: 'Zoom out' },
  { type: 'zoomReset', label: 'Reset zoom' },
  { type: 'reload', label: 'Reload page' },
  { type: 'toggleFullscreen', label: 'Toggle fullscreen' },
  { type: 'none', label: '— Nothing —' },
];

const GAME_ACTIONS = [
  { key: 'i', label: 'Inventory (bind I in game first)' },
  { key: 'q', label: 'Turn-based fight with monster' },
  { key: 'f', label: 'Quick fight' },
  { key: 'x', label: 'Attack nearest player' },
  { key: 'z', label: 'Close battle window' },
  { key: 'h', label: 'Show battle log' },
  { key: 'b', label: 'Resize battle log' },
  { key: 'Tab', label: 'Battle sets' },
  { key: 'r', label: 'Talk to nearest NPC' },
  { key: 'e', label: 'Mini map' },
  { key: 'm', label: 'World map' },
  { key: 'c', label: 'Chat' },
  { key: 'g', label: 'Group' },
  { key: 'v', label: 'Invite to group' },
  { key: 'k', label: 'Clans' },
  { key: 'p', label: 'Community' },
  { key: 'o', label: 'Abyss' },
  { key: 't', label: 'Quests' },
  { key: 'u', label: 'Skills' },
  { key: 'l', label: 'Character switch panel' },
  { key: '`', label: 'Console' },
];
const gameActionFor = (key) => GAME_ACTIONS.find((g) => g.key === key);

const KEY_ROWS = [
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'Backspace'],
  [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'],
];
const KEY_LABELS = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: '⌫' };

const RESOLUTIONS = [
  [1280, 800, 'Steam Deck'],
  [1280, 720, ''],
  [1600, 900, ''],
  [1680, 1050, ''],
  [1920, 1080, 'Full HD'],
  [1920, 1200, ''],
  [2560, 1440, ''],
];

let display = { fullscreen: true, width: 1280, height: 800 };
let menu = null;
let menuEl = null;
let navRepeat = { dir: null, next: 0 };

function slotList() {
  const items = [
    { special: 'reload', label: 'Reload page', title: 'App' },
    { special: 'fullscreen', label: 'Fullscreen', value: display.fullscreen ? 'On' : 'Off', title: 'App' },
    { special: 'resolution', label: 'Window size', value: `${display.width} × ${display.height}`, title: 'App' },
    { special: 'language', label: 'Language', value: languageName(lang), title: 'App' },
    { special: 'quit', label: 'Quit MargoDeck', title: 'App' },
  ];
  const hud = hudSettings();
  items.push({ special: 'hud', part: 'enabled', label: 'Show on screen', value: hud.enabled ? 'On' : 'Off', title: 'On-screen controls' });
  for (const part of HUD_PARTS) {
    items.push({ special: 'hud', part: part.id, label: part.setting, value: hud[part.id] ? 'On' : 'Off', title: 'On-screen controls' });
  }
  for (const g of SLOT_GROUPS) for (const n of g.names) items.push({ group: g.group, name: n, title: g.title });
  items.push({ special: 'reset', label: 'Restore default mapping' });
  items.push({ special: 'close', label: 'Close menu' });
  return items;
}

function getSlot(slot) {
  const v = mapping[slot.group]?.[slot.name];
  return KEY_ONLY_GROUPS.has(slot.group) ? (v ? { type: 'key', key: v } : null) : v;
}

function setSlot(slot, action) {
  mapping[slot.group] = mapping[slot.group] || {};
  if (KEY_ONLY_GROUPS.has(slot.group)) {
    mapping[slot.group][slot.name] = action && action.type === 'key' ? action.key : '';
  } else if (!action || action.type === 'none') {
    delete mapping[slot.group][slot.name];
  } else {
    mapping[slot.group][slot.name] = action;
  }
  ipcRenderer.invoke('md:saveMapping', mapping);
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keyLabel = (k) => esc(t(KEY_LABELS[k] || '') || (k.length === 1 ? k.toUpperCase() : k));
function describe(a) {
  if (!a) return '<span class="dim">—</span>';
  const extra = Array.isArray(a.also) && a.also.length
    ? ' / ' + a.also.map((type) => esc(t((ACTIONS.find((x) => x.type === type) || { label: type }).label))).join(' / ')
    : '';
  if (a.type === 'keys') return (a.keys || []).map((k) => describe({ type: 'key', key: k })).join(' / ') + extra;
  if (a.type === 'key' && extra) return describe({ type: 'key', key: a.key }) + extra;
  if (a.type === 'key') {
    const g = gameActionFor(a.key);
    return (g ? `${esc(t(g.label))} ` : '') + `<kbd>${keyLabel(a.key)}</kbd>`;
  }
  return esc(t((ACTIONS.find((x) => x.type === a.type) || { label: a.type }).label));
}
const slotName = (s) => (s.group === 'chords' ? 'L1 + ' : '') + buttonLabel(s.name);
const MAX_KEYS = 3;

function slotKeys(slot) {
  const a = getSlot(slot);
  if (!a) return [];
  if (a.type === 'key') return [a.key];
  if (a.type === 'keys') return [...(a.keys || [])];
  return [];
}

function setSlotKeys(slot, keys) {
  const also = getSlot(slot)?.also;
  const withAlso = (a) => (also && also.length ? { ...a, also } : a);
  if (keys.length === 0) setSlot(slot, null);
  else if (keys.length === 1) setSlot(slot, withAlso({ type: 'key', key: keys[0] }));
  else setSlot(slot, withAlso({ type: 'keys', keys }));
}

function addSlotKey(slot, key) {
  const keys = slotKeys(slot);
  if (!keys.includes(key) && keys.length < MAX_KEYS) keys.push(key);
  setSlotKeys(slot, keys);
}

function actionList() {
  const keyOnly = KEY_ONLY_GROUPS.has(menu.slot.group);
  const game = GAME_ACTIONS.map((g) => ({ type: 'game', key: g.key, label: `${esc(t(g.label))} <kbd>${keyLabel(g.key)}</kbd>`, group: 'Margonem' }));
  if (menu.adding) {
    const keys = slotKeys(menu.slot);
    return [...game.filter((g) => !keys.includes(g.key)), { type: 'key', label: t('Keyboard key…'), group: 'Other' }];
  }
  const current = [];
  const keys = keyOnly ? [] : slotKeys(menu.slot);
  if (keys.length) {
    current.push({ type: 'current', label: describe(getSlot(menu.slot)), group: 'Current' });
    if (keys.length < MAX_KEYS) current.push({ type: 'addKey', label: t('+ Add another key…'), group: 'Current' });
    if (keys.length > 1) current.push({ type: 'removeKey', label: t('− Remove last key'), group: 'Current' });
  }
  const base = keyOnly ? ACTIONS.filter((a) => a.type === 'key' || a.type === 'none') : ACTIONS;
  return [...current, ...game, ...base.map((a) => ({ ...a, label: esc(t(a.label)), group: 'Other' }))];
}

function openMenu() {
  releaseAllKeys();
  showSheet(false);
  chordUsed.clear();
  menu = { screen: 'slots', idx: 0 };
  renderMenu();
  ipcRenderer.invoke('md:display').then((d) => { display = d; renderMenu(); });
}
function closeMenu() {
  menu = null;
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function toggleMenu() { menu ? closeMenu() : openMenu(); }

const MENU_CSS = `
#md-menu{position:fixed;inset:0;z-index:2147483646;background:rgba(6,8,14,.82);display:flex;align-items:center;justify-content:center;font:15px/1.4 system-ui,sans-serif;color:#e8e6e1}
#md-menu .panel{width:min(880px,94vw);max-height:90vh;display:flex;flex-direction:column;background:#151922;border:1px solid #2c3342;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#md-menu header{padding:14px 20px;border-bottom:1px solid #2c3342;display:flex;justify-content:space-between;align-items:baseline}
#md-menu h2{margin:0;font-size:18px;color:#f0c86a}
#md-menu .body{overflow:auto;padding:8px 12px}
#md-menu .grp{margin:10px 8px 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7f8aa3}
#md-menu .row{display:flex;justify-content:space-between;padding:7px 12px;border-radius:7px;cursor:pointer}
#md-menu .row.sel,#md-menu .key.sel{background:#f0c86a;color:#151922}
#md-menu .row.sel .dim{color:#151922}
#md-menu kbd{font:600 13px ui-monospace,monospace;padding:1px 7px;border:1px solid currentColor;border-radius:4px}
#md-menu .dim{color:#7f8aa3}
#md-menu .keys{display:flex;flex-direction:column;gap:6px;padding:10px}
#md-menu .krow{display:flex;gap:6px;flex-wrap:wrap}
#md-menu .key{min-width:44px;padding:9px 8px;text-align:center;background:#222837;border-radius:6px;cursor:pointer;font:600 14px ui-monospace,monospace}
#md-menu footer{padding:10px 20px;border-top:1px solid #2c3342;color:#7f8aa3;font-size:13px}
`;

function renderMenu() {
  if (!menu) return;
  if (!menuEl) {
    menuEl = document.createElement('div');
    menuEl.id = 'md-menu';
    document.documentElement.appendChild(menuEl);
  }
  let title;
  let body;
  if (menu.screen === 'slots') {
    title = t('MargoDeck – settings');
    let lastGroup = null;
    body = slotList().map((it, i) => {
      let h = '';
      const grp = it.title || 'Other';
      if (grp !== lastGroup) { lastGroup = grp; h += `<div class="grp">${t(grp)}</div>`; }
      const left = it.special ? t(it.label) : slotName(it);
      const right = it.special ? esc(t(it.value || '')) : describe(getSlot(it));
      return h + `<div class="row${i === menu.idx ? ' sel' : ''}" data-i="${i}"><span>${left}</span><span>${right}</span></div>`;
    }).join('');
  } else if (menu.screen === 'res') {
    title = t('Window size');
    body = RESOLUTIONS.map(([w, h, note], i) => {
      const cur = w === display.width && h === display.height ? ` <span class="dim">${t('(current)')}</span>` : '';
      return `<div class="row${i === menu.idx ? ' sel' : ''}" data-i="${i}"><span>${w} × ${h}${cur}</span><span class="dim">${note}</span></div>`;
    }).join('') + `<div class="grp">${t('Choosing a size leaves fullscreen')}</div>`;
  } else if (menu.screen === 'actions') {
    title = menu.adding ? t('Add key to: {0}', slotName(menu.slot)) : t('Assign: {0}', slotName(menu.slot));
    let lastGroup = null;
    body = actionList().map((a, i) => {
      const h = a.group !== lastGroup ? `<div class="grp">${t((lastGroup = a.group))}</div>` : '';
      return h + `<div class="row${i === menu.idx ? ' sel' : ''}" data-i="${i}"><span>${a.label}</span></div>`;
    }).join('');
  } else {
    title = t('Key for: {0}', slotName(menu.slot));
    body = '<div class="keys">' + KEY_ROWS.map((r, ri) => '<div class="krow">' + r.map((k, ci) =>
      `<div class="key${ri === menu.row && ci === menu.col ? ' sel' : ''}" data-r="${ri}" data-c="${ci}">${keyLabel(k)}</div>`).join('') + '</div>').join('') + '</div>';
  }
  menuEl.innerHTML = `<style>${MENU_CSS}</style><div class="panel">
    <header><h2>${title}</h2><span class="dim">${t('Menu: close')}</span></header>
    <div class="body">${body}</div>
    <footer>${t('D-pad / left stick: move · A: select · B: back · View + Menu opens this screen · Changes are saved immediately')}</footer></div>`;
  menuEl.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => { menu.idx = +el.dataset.i; menuSelect(); }));
  menuEl.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('click', () => { menu.row = +el.dataset.r; menu.col = +el.dataset.c; menuSelect(); }));
  const sel = menuEl.querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function menuSelect() {
  if (menu.screen === 'slots') {
    const it = slotList()[menu.idx];
    if (it.special === 'close') return closeMenu();
    if (it.special === 'quit') { ipcRenderer.send('md:action', 'quit'); return; }
    if (it.special === 'hud') {
      mapping.hud = { ...hudSettings(), [it.part]: !hudSettings()[it.part] };
      ipcRenderer.invoke('md:saveMapping', mapping);
      hudDirty = true;
      renderMenu();
      return;
    }
    if (it.special === 'language') {
      const codes = Object.keys(LOCALES);
      mapping.language = codes[(codes.indexOf(lang) + 1) % codes.length];
      setLanguage(mapping);
      ipcRenderer.invoke('md:saveMapping', mapping);
      renderMenu();
      return;
    }
    if (it.special === 'reload') { closeMenu(); ipcRenderer.send('md:action', 'reload'); return; }
    if (it.special === 'fullscreen') {
      ipcRenderer.invoke('md:setDisplay', { fullscreen: !display.fullscreen }).then((d) => { display = d; renderMenu(); });
      return;
    }
    if (it.special === 'resolution') {
      const cur = RESOLUTIONS.findIndex(([w, h]) => w === display.width && h === display.height);
      menu = { screen: 'res', idx: Math.max(0, cur), back: menu.idx };
      renderMenu();
      return;
    }
    if (it.special === 'reset') {
      ipcRenderer.invoke('md:resetMapping').then((m) => { mapping = m; setLanguage(m); renderMenu(); });
      return;
    }
    menu = { screen: 'actions', idx: 0, slot: it, back: menu.idx };
  } else if (menu.screen === 'res') {
    const [width, height] = RESOLUTIONS[menu.idx];
    ipcRenderer.invoke('md:setDisplay', { width, height }).then((d) => { display = d; renderMenu(); });
    menu = { screen: 'slots', idx: menu.back };
  } else if (menu.screen === 'actions') {
    const a = actionList()[menu.idx];
    if (a.type === 'current') {
      menu = { screen: 'slots', idx: menu.back };
    } else if (a.type === 'addKey') {
      menu = { ...menu, adding: true, idx: 0 };
    } else if (a.type === 'removeKey') {
      setSlotKeys(menu.slot, slotKeys(menu.slot).slice(0, -1));
      menu = { ...menu, idx: 0 };
    } else if (a.type === 'game') {
      if (menu.adding) addSlotKey(menu.slot, a.key);
      else setSlot(menu.slot, { type: 'key', key: a.key });
      menu = { screen: 'slots', idx: menu.back };
    } else if (a.type === 'key') {
      const cur = getSlot(menu.slot);
      let row = 0;
      let col = 0;
      KEY_ROWS.forEach((r, ri) => { const ci = r.indexOf(cur?.key); if (ci >= 0) { row = ri; col = ci; } });
      menu = { ...menu, screen: 'keys', row, col };
    } else {
      setSlot(menu.slot, a);
      menu = { screen: 'slots', idx: menu.back };
    }
  } else {
    const key = KEY_ROWS[menu.row][menu.col];
    if (menu.adding) addSlotKey(menu.slot, key);
    else setSlot(menu.slot, { type: 'key', key });
    menu = { screen: 'slots', idx: menu.back };
  }
  renderMenu();
}

function menuBack() {
  if (menu.screen === 'slots') return closeMenu();
  if (menu.screen === 'keys') menu = { ...menu, screen: 'actions', idx: 0 };
  else if (menu.adding) menu = { ...menu, adding: false, idx: 0 };
  else menu = { screen: 'slots', idx: menu.back };
  renderMenu();
}

function listLength() {
  if (menu.screen === 'slots') return slotList().length;
  if (menu.screen === 'res') return RESOLUTIONS.length;
  return actionList().length;
}

function menuMove(dir) {
  if (menu.screen === 'keys') {
    if (dir === 'up') menu.row = (menu.row + KEY_ROWS.length - 1) % KEY_ROWS.length;
    if (dir === 'down') menu.row = (menu.row + 1) % KEY_ROWS.length;
    const len = KEY_ROWS[menu.row].length;
    menu.col = Math.min(menu.col, len - 1);
    if (dir === 'left') menu.col = (menu.col + len - 1) % len;
    if (dir === 'right') menu.col = (menu.col + 1) % len;
  } else {
    const n = listLength();
    if (dir === 'up') menu.idx = (menu.idx + n - 1) % n;
    if (dir === 'down') menu.idx = (menu.idx + 1) % n;
  }
  renderMenu();
}

function menuTick(pad) {
  const b = (i) => pad.buttons[i]?.pressed;
  const [lx, ly] = pad.axes;
  let dir = null;
  if (b(12) || ly < -0.6) dir = 'up';
  else if (b(13) || ly > 0.6) dir = 'down';
  else if (b(14) || lx < -0.6) dir = 'left';
  else if (b(15) || lx > 0.6) dir = 'right';
  const now = performance.now();
  if (dir !== navRepeat.dir) {
    navRepeat = { dir, next: now + 350 };
    if (dir) menuMove(dir);
  } else if (dir && now >= navRepeat.next) {
    navRepeat.next = now + 90;
    menuMove(dir);
  }

  pad.buttons.forEach((btn, i) => {
    if (btn.pressed === prevButtons[i]) return;
    prevButtons[i] = btn.pressed;
    if (!btn.pressed || !menu) return;
    const name = BUTTON_NAMES[i];
    if (name === 'A') menuSelect();
    else if (name === 'B') menuBack();
    else if (name === 'Start') closeMenu();
  });
}

const SHEET_DELAY = 500;
let backDownAt = 0;
let modDownAt = 0;
let sheetShown = false;
let sheetEl = null;

function sheetRows() {
  const rows = [];
  const cell = (a) => (a ? describe(a) : '<span class="dim">—</span>');
  for (const n of ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'Start']) {
    rows.push([buttonLabel(n), cell(mapping.buttons?.[n]), n === CHORD_MOD ? `<span class="dim">${t('modifier')}</span>` : cell(mapping.chords?.[n])]);
  }
  rows.push(['View', cell(mapping.buttons?.Back), '']);
  rows.push(['View + Menu', t('MargoDeck settings'), '']);
  const dpadNames = { up: 'DUp', down: 'DDown', left: 'DLeft', right: 'DRight' };
  for (const d of ['up', 'down', 'left', 'right']) {
    const k = mapping.dpad?.[d];
    rows.push([buttonLabel(dpadNames[d]), k ? describe({ type: 'key', key: k }) : cell(null), cell(mapping.chords?.[dpadNames[d]])]);
  }
  const ls = mapping.leftStick || {};
  rows.push([t('Left stick'), ['up', 'left', 'down', 'right'].map((d) => `<kbd>${keyLabel(ls[d] || '—')}</kbd>`).join(''), '']);
  rows.push([t('Right stick'), t('Cursor'), '']);
  return rows;
}

function showSheet(show) {
  if (show === sheetShown) return;
  sheetShown = show;
  if (!show) { if (sheetEl) { sheetEl.remove(); sheetEl = null; } return; }
  sheetEl = document.createElement('div');
  sheetEl.id = 'md-sheet';
  document.documentElement.appendChild(sheetEl);
  renderSheet();
}

function renderSheet() {
  if (!sheetEl || !mapping) return;
  const rows = sheetRows().map(([i, n, c]) => `<tr><th>${esc(i)}</th><td>${n}</td><td>${c}</td></tr>`).join('');
  sheetEl.innerHTML = `<style>
#md-sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,94vw);max-height:92vh;overflow:auto;z-index:2147483645;pointer-events:none;
  background:rgba(21,25,34,.94);border:1px solid #2c3342;border-radius:12px;font:14px/1.35 system-ui,sans-serif;color:#e8e6e1;box-shadow:0 16px 48px rgba(0,0,0,.55);padding:12px 16px}
#md-sheet table{width:100%;border-collapse:collapse}
#md-sheet th,#md-sheet td{text-align:left;padding:4px 8px;border-bottom:1px solid #222837;vertical-align:top}
#md-sheet thead th{color:#7f8aa3;font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
#md-sheet tbody th{color:#f0c86a;white-space:nowrap;font-weight:600}
#md-sheet kbd{font:600 12px ui-monospace,monospace;padding:0 5px;margin-left:2px;border:1px solid currentColor;border-radius:4px}
#md-sheet .dim{color:#7f8aa3}
</style><table><thead><tr><th>${t('Button')}</th><th>${t('Press')}</th><th>${t('Hold L1 +')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// On-screen controls (HUD) ----------------------------------------------

const HUD_PARTS = [
  { id: 'windows', corner: 'bl', layer: 'base', title: 'Windows', setting: 'Windows (bottom left)' },
  { id: 'actions', corner: 'br', layer: 'base', title: 'Actions', setting: 'Actions (bottom right)' },
  { id: 'combos', corner: 'bl', layer: 'l1', title: 'L1 +', setting: 'L1 + buttons (while holding L1, bottom left)' },
  { id: 'dpadCombos', corner: 'br', layer: 'l1', title: 'L1 + D-pad', setting: 'L1 + D-pad (while holding L1, bottom right)' },
];
const HUD_DEFAULTS = { enabled: true, windows: true, actions: true, combos: true, dpadCombos: true };
const hudSettings = () => ({ ...HUD_DEFAULTS, ...(mapping?.hud || {}) });

const IS_POPUP = !!window.opener;
let hudRoot = null;
let hudDirty = true;
let hudLastLayout = 0;
let hudLastKey = '';

const HOLD_ICON = '<svg class="ring" viewBox="0 0 16 16" aria-hidden="true">'
  + '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2.2"/>'
  + '<path d="M8 2 A6 6 0 1 1 2.8 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

function hudLabel(a) {
  if (!a) return '';
  const name = (type) => t((ACTIONS.find((x) => x.type === type) || { label: type }).label);
  const keyName = (k) => {
    const g = gameActionFor(k);
    return g ? t(g.label).replace(/\s*\(.*\)$/, '') : (KEY_LABELS[k] ? t(KEY_LABELS[k]) : k.toUpperCase());
  };
  let parts = [];
  if (a.type === 'key') parts = [keyName(a.key)];
  else if (a.type === 'keys') parts = (a.keys || []).map(keyName);
  else parts = [name(a.type)];
  if (Array.isArray(a.also)) parts.push(...a.also.map(name));
  return parts.join(' / ');
}

function hudEntries(id) {
  const out = [];
  const add = (badge, a, hold = false) => { const l = hudLabel(a); if (l) out.push({ badge, label: l, hold }); };
  const dpadKey = (d) => (mapping.dpad?.[d] ? { type: 'key', key: mapping.dpad[d] } : null);
  const nudgeButton = Object.keys(mapping.buttons || {}).find((n) => mapping.buttons[n]?.type === 'nudgeModifier');
  if (id === 'windows') {
    add('✚↑', dpadKey('up'));
    add('✚↓', dpadKey('down'));
    add('✚←', dpadKey('left'));
    add('✚→', dpadKey('right'));
    add('L3', mapping.buttons?.LS);
    out.push({ badge: 'View', label: t('All controls'), hold: true });
  } else if (id === 'actions') {
    for (const n of ['X', 'Y', 'LB', 'RS']) {
      if (n === nudgeButton) continue;
      add(buttonLabel(n), mapping.buttons?.[n]);
      if (n === CHORD_MOD) out.push({ badge: buttonLabel(n), label: t('More shortcuts'), hold: true });
    }
    if (nudgeButton) out.push({ badge: `${buttonLabel(nudgeButton)} + ✚`, label: t('Cursor next to character'), hold: true });
  } else if (id === 'combos') {
    for (const n of ['A', 'B', 'X', 'Y', 'RB', 'LT', 'RT', 'LS', 'RS', 'Start']) add(buttonLabel(n), mapping.chords?.[n]);
  } else if (id === 'dpadCombos') {
    for (const [n, arrow] of [['DUp', '↑'], ['DDown', '↓'], ['DLeft', '←'], ['DRight', '→']]) add(`✚${arrow}`, mapping.chords?.[n]);
  }
  return out;
}

const HUD_CSS = `
#md-hud{position:fixed;inset:0;pointer-events:none;z-index:2147483640;font:bold 13px/1.3 Arial,Helvetica,sans-serif;color:#f1e6c8;
  text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000,0 0 5px rgba(0,0,0,.85)}
#md-hud .box{position:fixed;display:flex;flex-direction:column;gap:4px;max-width:46%}
#md-hud .ttl{display:flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#f2c14e}
#md-hud .row{display:flex;align-items:center;gap:7px;white-space:nowrap}
#md-hud .r{justify-content:flex-end}
#md-hud .b{display:inline-flex;align-items:center;gap:3px;min-width:22px;justify-content:center;padding:1px 6px;border-radius:4px;
  background:linear-gradient(#4b3523,#2a1b10);border:1px solid #c9a25a;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 1px 2px rgba(0,0,0,.7);
  font:bold 11px/1.35 Arial,Helvetica,sans-serif;color:#f6e7b8;text-shadow:0 1px 1px #000}
#md-hud .b.hold{border-color:#f2c14e;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 0 6px rgba(242,193,78,.55)}
#md-hud .ring{width:11px;height:11px;color:#f2c14e;flex:none}
#md-hud .tip{position:fixed;transform:translateX(-50%);padding:4px 12px;border-radius:5px;display:flex;gap:6px;align-items:center;white-space:nowrap;
  background:linear-gradient(rgba(58,40,24,.88),rgba(30,20,12,.88));border:1px solid #8a6a3a;box-shadow:0 2px 6px rgba(0,0,0,.6);font-size:12px}
#md-hud .tip .sep{width:14px}
#md-hud.hidden{display:none}
`;

const badgeHtml = (text, hold) => `<span class="b${hold ? ' hold' : ''}">${hold ? HOLD_ICON : ''}${esc(text)}</span>`;

function hudArea() {
  const c = document.getElementById('GAME_CANVAS');
  const r = c && c.getBoundingClientRect();
  if (r && r.width > 200 && r.height > 150) return r;
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
}

function renderHud(l1Held) {
  const hud = hudSettings();
  const layer = l1Held ? 'l1' : 'base';
  const right = (c) => c === 'br';
  const boxes = hud.enabled ? HUD_PARTS.filter((part) => part.layer === layer && hud[part.id]).map((part) => {
    const rows = hudEntries(part.id).map((e) => (right(part.corner)
      ? `<div class="row r"><span>${esc(e.label)}</span>${badgeHtml(e.badge, e.hold)}</div>`
      : `<div class="row">${badgeHtml(e.badge, e.hold)}<span>${esc(e.label)}</span></div>`)).join('');
    if (!rows) return '';
    const title = part.layer === 'l1'
      ? `${badgeHtml(buttonLabel(CHORD_MOD), true)}<span>${esc(t(part.title).replace(/^L1\s*\+\s*/, '+ '))}</span>`
      : `<span>${esc(t(part.title))}</span>`;
    return `<div class="box" data-corner="${part.corner}"><div class="ttl${right(part.corner) ? ' r' : ''}">${title}</div>${rows}</div>`;
  }).join('') : '';
  const tipTop = `<div class="tip top">${badgeHtml('View')}<span>+</span>${badgeHtml('Menu')}<span>${esc(t('MargoDeck settings'))}</span></div>`;
  const single = [['View', mapping.buttons?.Back], ['Menu', mapping.buttons?.Start]]
    .map(([b, a]) => [b, hudLabel(a)]).filter(([, l]) => l)
    .map(([b, l]) => `${badgeHtml(b)}<span>${esc(l)}</span>`).join('<span class="sep"></span>');
  const tipBottom = hud.enabled && single ? `<div class="tip bottom">${single}</div>` : '';
  hudRoot.innerHTML = `<style>${HUD_CSS}</style>${boxes}${tipTop}${tipBottom}`;
}

function layoutHud() {
  const a = hudArea();
  const pad = 14;
  hudRoot.querySelectorAll('.box').forEach((el) => {
    const c = el.dataset.corner;
    el.style.left = c[1] === 'l' ? `${a.left + pad}px` : '';
    el.style.right = c[1] === 'r' ? `${window.innerWidth - a.right + pad}px` : '';
    el.style.bottom = `${window.innerHeight - a.bottom + pad}px`;
  });
  const top = hudRoot.querySelector('.tip.top');
  if (top) { top.style.left = `${a.left + a.width / 2}px`; top.style.top = `${a.top + 8}px`; }
  const bottom = hudRoot.querySelector('.tip.bottom');
  if (bottom) { bottom.style.left = `${a.left + a.width / 2}px`; bottom.style.bottom = `${window.innerHeight - a.bottom + 40}px`; }
}

function updateHud(pad) {
  if (IS_POPUP || !mapping || !document.documentElement) return;
  const l1Held = !!pad?.buttons[BUTTON_NAMES.indexOf(CHORD_MOD)]?.pressed;
  const key = JSON.stringify([mapping.buttons, mapping.chords, mapping.dpad, mapping.hud, lang, l1Held]);
  const now = performance.now();
  if (!hudDirty && key === hudLastKey && now - hudLastLayout < 400) return;
  hudLastLayout = now;
  if (!hudRoot || !document.documentElement.contains(hudRoot)) {
    hudRoot = document.createElement('div');
    hudRoot.id = 'md-hud';
    document.documentElement.appendChild(hudRoot);
    hudDirty = true;
  }
  if (hudDirty || key !== hudLastKey) { renderHud(l1Held); hudLastKey = key; }
  hudDirty = false;
  hudRoot.classList.toggle('hidden', !!menu || sheetShown);
  layoutHud();
}

function deadzone(v) {
  const dz = mapping.stickDeadzone ?? 0.35;
  return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
}

function tick() {
  requestAnimationFrame(tick);
  if (!mapping) return;
  const pad = [...navigator.getGamepads()].find(Boolean);
  updateHud(pad);
  if (!pad) return;
  ensureOverlay();

  if (menu) { drawCursor(); menuTick(pad); return; }

  const [lx, ly, rx, ry] = pad.axes;
  const dz = mapping.stickDeadzone ?? 0.35;

  const ls = mapping.leftStick || {};
  setKey(ls.up, ly < -dz);
  setKey(ls.down, ly > dz);
  setKey(ls.left, lx < -dz);
  setKey(ls.right, lx > dz);

  const nudgeHeld = Object.entries(mapping.buttons || {}).some(([n, a]) => a?.type === 'nudgeModifier' && pad.buttons[BUTTON_NAMES.indexOf(n)]?.pressed);
  const ax = deadzone(rx || 0);
  const ay = deadzone(ry || 0);
  if (nudgeHeld && (ax || ay)) {
    const len = Math.hypot(rx, ry) || 1;
    nudgeTowards(rx / len, ry / len);
  } else if (ax || ay) {
    const speed = mapping.cursorSpeed ?? 14;
    const accel = mapping.cursorAccel ?? 2.2;
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), accel) * speed;
    cursor.x = Math.max(0, Math.min(window.innerWidth - 1, cursor.x + f(ax)));
    cursor.y = Math.max(0, Math.min(window.innerHeight - 1, cursor.y + f(ay)));
    cursor.lastMove = performance.now();
    realMouseActive = false;
    sendMouse('move');
  }
  drawCursor();

  const backHeld = pad.buttons[8]?.pressed;
  const modHeld = pad.buttons[BUTTON_NAMES.indexOf(CHORD_MOD)]?.pressed;
  if (backHeld && !prevButtons[8]) backDownAt = performance.now();
  showSheet(!!backHeld && prevButtons[8] && performance.now() - backDownAt >= SHEET_DELAY);

  pad.buttons.forEach((b, i) => {
    const name = BUTTON_NAMES[i];
    const pressed = b.pressed;
    if (pressed === prevButtons[i]) return;
    prevButtons[i] = pressed;
    if (!name || menu) return;

    if (name.startsWith('D')) {
      if (pressed && modHeld && mapping.chords?.[name]) {
        chordUsed.add(CHORD_MOD);
        chordUsed.add(name);
        runAction(mapping.chords[name], true);
        return;
      }
      if (!pressed && chordUsed.has(name)) {
        chordUsed.delete(name);
        runAction(mapping.chords?.[name], false);
        return;
      }
      if (pressed && nudgeHeld) {
        nudgeUsed.add(name);
        const held = (i) => pad.buttons[i]?.pressed;
        const dx = (held(15) ? 1 : 0) - (held(14) ? 1 : 0);
        const dy = (held(13) ? 1 : 0) - (held(12) ? 1 : 0);
        centerCursorOnHero(dx, dy);
        return;
      }
      if (!pressed && nudgeUsed.has(name)) {
        nudgeUsed.delete(name);
        return;
      }
      const dir = { DUp: 'up', DDown: 'down', DLeft: 'left', DRight: 'right' }[name];
      const key = mapping.dpad?.[dir];
      if (key) sendKey(key, pressed);
      return;
    }

    if (name === 'Back') {
      if (!pressed) {
        if (!chordUsed.has('Back') && performance.now() - backDownAt < SHEET_DELAY) { runAction(mapping.buttons.Back, true); runAction(mapping.buttons.Back, false); }
        chordUsed.delete('Back');
      }
      return;
    }

    if (name === CHORD_MOD) {
      if (pressed) { chordUsed.delete(CHORD_MOD); modDownAt = performance.now(); return; }
      if (!chordUsed.has(CHORD_MOD) && performance.now() - modDownAt < SHEET_DELAY) { runAction(mapping.buttons[CHORD_MOD], true); runAction(mapping.buttons[CHORD_MOD], false); }
      chordUsed.delete(CHORD_MOD);
      return;
    }

    if (backHeld && name === 'Start') { if (pressed) openMenu(); return; }

    if (modHeld && mapping.chords?.[name]) {
      if (pressed) { chordUsed.add(CHORD_MOD); chordUsed.add(name); }
      runAction(mapping.chords[name], pressed);
      if (!pressed) chordUsed.delete(name);
      return;
    }
    if (!pressed && chordUsed.has(name)) { chordUsed.delete(name); return; }

    runAction(mapping.buttons[name], pressed);
  });
}

window.addEventListener('blur', releaseAllKeys);

ipcRenderer.on('md:display-updated', (_e, d) => { display = d; if (menu) renderMenu(); });

ipcRenderer.on('md:mapping-updated', (_e, m) => { mapping = m; setLanguage(m); hudDirty = true; if (menu) renderMenu(); renderSheet(); });

Promise.all([ipcRenderer.invoke('md:locales'), ipcRenderer.invoke('md:mapping')]).then(([locales, m]) => {
  LOCALES = locales || {};
  mapping = m;
  setLanguage(m);
  cursor.x = window.innerWidth / 2;
  cursor.y = window.innerHeight / 2;
  requestAnimationFrame(tick);
});
