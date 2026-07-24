(function(){

// ---------------------------------------------------------------
// Aucune liste interne : tous les événements viennent en direct de
// l'API "Éphéméride" (onthisday) de Wikipédia, pour une date aléatoire.
// ---------------------------------------------------------------
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const DEFAULT_EMOJI = '📜';

const CARD_H = 96;   // must match .card height in CSS
const GAP = 14;       // must match #board gap in CSS

let order = [];        // current visual order, array of item objects (with data attached)
let solved = false;

const themeToggle = document.getElementById('themeToggle');
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
}
let currentTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
applyTheme(currentTheme);
themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(currentTheme);
});

const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');
const boardWrapEl = document.getElementById('boardWrap');
const boardEl = document.getElementById('board');
const railEl = document.getElementById('rail');
const validateBtn = document.getElementById('validateBtn');
const newGameBtn = document.getElementById('newGameBtn');
const resultBanner = document.getElementById('resultBanner');

function formatYear(y){
  const mono = n => n; // keep as number
  if (y < 0) return `${Math.abs(y)} av. J.-C.`;
  return `an ${y}`;
}

function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomMonthDay(){
  const month = Math.floor(Math.random() * 12) + 1;
  const day = Math.floor(Math.random() * DAYS_IN_MONTH[month - 1]) + 1;
  return { mm: String(month).padStart(2, '0'), dd: String(day).padStart(2, '0') };
}

// Récupère les événements "un jour comme aujourd'hui" pour une date au hasard.
async function fetchDailyEvents(){
  const { mm, dd } = randomMonthDay();
  const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
  if (!res.ok) throw new Error('bad response');
  const data = await res.json();
  return data.events || [];
}

function formatEventTitle(text){
  if (!text) return '';
  let t = text.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.replace(/\.$/, '');
}

// Choisit 5 événements distincts (années différentes) parmi ceux qui ont
// une page Wikipédia exploitable (extrait disponible).
function selectFive(events){
  const usable = shuffle(events).filter(e => e.year && e.pages && e.pages[0] && e.pages[0].extract);
  const chosen = [];
  const usedYears = new Set();
  for (const e of usable){
    if (chosen.length >= 5) break;
    if (usedYears.has(e.year)) continue;
    usedYears.add(e.year);
    chosen.push(e);
  }
  return chosen;
}

// Retire jusqu'à obtenir 5 événements exploitables, en essayant plusieurs
// dates au hasard si besoin (une journée donnée n'a pas toujours assez
// d'événements avec extrait + année distincte).
async function pickFiveFromApi(){
  for (let attempt = 0; attempt < 8; attempt++){
    try {
      const events = await fetchDailyEvents();
      const chosen = selectFive(events);
      if (chosen.length >= 5) return chosen;
    } catch (e) { /* on retente avec une autre date */ }
  }
  return [];
}

function buildRail(n){
  railEl.innerHTML = '<div class="rail-line"></div>';
  for (let i = 0; i < n; i++){
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.top = (i * (CARD_H + GAP) + CARD_H/2) + 'px';
    tick.dataset.index = i;
    railEl.appendChild(tick);
  }
  railEl.style.height = (n * CARD_H + (n-1) * GAP) + 'px';
}

// The rail ticks are purely decorative (they just light up); the actual
// revealed date is shown directly on its card so nothing overlaps the text.
function revealTick(index){
  const tick = railEl.querySelector(`.tick[data-index="${index}"]`);
  if (tick) tick.classList.add('revealed');
}

function clearReveal(){
  railEl.querySelectorAll('.tick').forEach(t => t.classList.remove('revealed'));
}

let cardEls = {}; // id -> DOM element, persistent across a game (no full re-render while dragging)

function slotY(index){ return index * (CARD_H + GAP); }

// Re-position every card (except the one currently being dragged, which
// follows the pointer directly) to match its index in `order`.
function layout(excludeId){
  order.forEach((item, i) => {
    if (item._id === excludeId) return;
    const el = cardEls[item._id];
    if (el) el.style.transform = `translateY(${slotY(i)}px)`;
  });
}

function render(){
  boardEl.innerHTML = '';
  cardEls = {};
  boardEl.style.height = (slotY(order.length - 1) + CARD_H) + 'px';

  order.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item._id;
    card.style.transition = 'none'; // avoid slide-in animation on first paint

    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '⠿';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (item.thumb) {
      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.textContent = item.emoji;
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = item.title;
    body.appendChild(titleEl);

    const feedback = document.createElement('div');
    feedback.className = 'card-feedback';
    feedback.dataset.role = 'feedback';
    const fbYear = document.createElement('span');
    fbYear.className = 'fb-year';
    const fbMark = document.createElement('span');
    fbMark.className = 'fb-mark';
    feedback.appendChild(fbYear);
    feedback.appendChild(fbMark);

    const arrows = document.createElement('div');
    arrows.className = 'arrows';
    const upBtn = document.createElement('button');
    upBtn.textContent = '▲';
    upBtn.addEventListener('click', () => moveCard(item._id, -1));
    const downBtn = document.createElement('button');
    downBtn.textContent = '▼';
    downBtn.addEventListener('click', () => moveCard(item._id, 1));
    arrows.appendChild(upBtn);
    arrows.appendChild(downBtn);

    card.appendChild(handle);
    card.appendChild(thumb);
    card.appendChild(body);
    card.appendChild(feedback);
    card.appendChild(arrows);

    cardEls[item._id] = card;
    boardEl.appendChild(card);
    attachDrag(card, item);
  });

  layout(null);

  // Let the initial position apply instantly, then re-enable smooth
  // transitions for every future move.
  requestAnimationFrame(() => {
    Object.values(cardEls).forEach(el => { el.style.transition = ''; });
  });
}

function moveCard(id, delta){
  if (solved) return;
  const idx = order.findIndex(o => o._id === id);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= order.length) return;
  const tmp = order[idx];
  order[idx] = order[newIdx];
  order[newIdx] = tmp;
  layout(null);
}

// ---- Pointer-based drag & drop reordering ----
// Cards are absolutely positioned by slot index (slotY). While dragging,
// the card's transform is driven directly by the pointer; every other card
// smoothly animates (CSS transition) to its new slot whenever the dragged
// card crosses a slot boundary. This avoids the jumpiness of DOM reordering.
function attachDrag(card, item){
  card.addEventListener('pointerdown', (e) => {
    if (solved) return;
    if (e.target.closest('.arrows')) return; // let arrow buttons work independently

    const startClientY = e.clientY;
    const startIndex = order.findIndex(o => o._id === item._id);
    const startTranslate = slotY(startIndex);
    const maxTranslate = slotY(order.length - 1);

    card.setPointerCapture(e.pointerId);
    card.classList.add('dragging');

    function onMove(ev){
      const dy = ev.clientY - startClientY;
      const t = Math.max(0, Math.min(maxTranslate, startTranslate + dy));
      card.style.transform = `translateY(${t}px)`;

      const candidateIndex = Math.round(t / (CARD_H + GAP));
      const currentIndex = order.findIndex(o => o._id === item._id);
      if (candidateIndex !== currentIndex){
        const [moved] = order.splice(currentIndex, 1);
        order.splice(candidateIndex, 0, moved);
        layout(item._id);
      }
    }

    function onUp(){
      card.classList.remove('dragging');
      const finalIndex = order.findIndex(o => o._id === item._id);
      card.style.transform = `translateY(${slotY(finalIndex)}px)`;
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
    }

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  });
}

function checkOrder(){
  if (solved) return;
  solved = true;
  validateBtn.disabled = true;

  const correctOrder = order.slice().sort((a, b) => a.year - b.year);
  let allCorrect = true;

  order.forEach((item, idx) => {
    const card = cardEls[item._id];
    const feedback = card.querySelector('[data-role="feedback"]');
    const fbYear = feedback.querySelector('.fb-year');
    const fbMark = feedback.querySelector('.fb-mark');
    const isCorrect = correctOrder[idx]._id === item._id;
    fbYear.textContent = formatYear(item.year);
    if (isCorrect){
      card.classList.add('correct');
      feedback.classList.add('correct');
      fbMark.textContent = '✓';
    } else {
      card.classList.add('wrong');
      feedback.classList.add('wrong');
      fbMark.textContent = '✕';
      allCorrect = false;
    }
    revealTick(idx);
  });

  resultBanner.className = 'result-banner show ' + (allCorrect ? 'win' : 'lose');
  resultBanner.textContent = allCorrect
    ? '✓ Chronologie parfaite ! Bravo.'
    : '✕ Pas tout à fait — regarde les dates qui viennent d\'apparaître sur chaque carte.';

  statusEl.textContent = allCorrect ? 'Partie gagnée' : 'Partie terminée';
}

async function newGame(){
  solved = false;
  resultBanner.className = 'result-banner';
  clearReveal();
  loadingEl.style.display = 'block';
  boardWrapEl.style.display = 'none';
  validateBtn.disabled = true;
  newGameBtn.disabled = true;
  statusEl.textContent = 'Chargement…';

  const events = await pickFiveFromApi();

  if (events.length < 5){
    loadingEl.style.display = 'none';
    newGameBtn.disabled = false;
    statusEl.textContent = 'Erreur de chargement — réessaie.';
    return;
  }

  const enriched = events.map((e, i) => {
    const page = e.pages[0];
    return {
      title: formatEventTitle(e.text),
      year: e.year,
      wiki: page.title,
      thumb: (page.thumbnail && page.thumbnail.source) ? page.thumbnail.source : null,
      emoji: DEFAULT_EMOJI,
      _id: i + '-' + Date.now(),
    };
  });

  order = shuffle(enriched);
  buildRail(order.length);
  render();

  loadingEl.style.display = 'none';
  boardWrapEl.style.display = 'flex';
  validateBtn.disabled = false;
  newGameBtn.disabled = false;
  statusEl.textContent = `${order.length} événements · glisse pour réordonner`;
}

validateBtn.addEventListener('click', checkOrder);
newGameBtn.addEventListener('click', newGame);

newGame();

})();
