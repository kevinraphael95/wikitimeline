(function(){

// ---------------------------------------------------------------
// Pool of candidate entries: people, events, inventions.
// year: negative = BC. wiki: article title on fr.wikipedia.org
// ---------------------------------------------------------------
const POOL = [
  { emoji:'🏛️', title:'Fondation de Rome', wiki:'Rome', year:-753 },
  { emoji:'👑', title:'Naissance de Cléopâtre', wiki:'Cléopâtre VII', year:-69 },
  { emoji:'⚔️', title:'Naissance de Jules César', wiki:'Jules César', year:-100 },
  { emoji:'🏰', title:'Charlemagne couronné empereur', wiki:'Charlemagne', year:800 },
  { emoji:'🌍', title:'Chute de l\'Empire romain d\'Occident', wiki:'Chute de l\'Empire romain d\'Occident', year:476 },
  { emoji:'🖨️', title:'Invention de l\'imprimerie', wiki:'Gutenberg', year:1450 },
  { emoji:'🎨', title:'Naissance de Léonard de Vinci', wiki:'Léonard de Vinci', year:1452 },
  { emoji:'⛵', title:'Découverte de l\'Amérique par Colomb', wiki:'Christophe Colomb', year:1492 },
  { emoji:'🎭', title:'Naissance de William Shakespeare', wiki:'William Shakespeare', year:1564 },
  { emoji:'🧑', title:'Naissance d\'Isaac Newton', wiki:'Isaac Newton', year:1643 },
  { emoji:'📷', title:'Invention de la photographie', wiki:'Nicéphore Niépce', year:1826 },
  { emoji:'⚡', title:'Invention de la pile électrique', wiki:'Alessandro Volta', year:1800 },
  { emoji:'🇫🇷', title:'Révolution française', wiki:'Révolution française', year:1789 },
  { emoji:'🎩', title:'Naissance de Napoléon Bonaparte', wiki:'Napoléon Ier', year:1769 },
  { emoji:'🧬', title:'Naissance de Charles Darwin', wiki:'Charles Darwin', year:1809 },
  { emoji:'📖', title:'Publication de "L\'Origine des espèces"', wiki:'L\'Origine des espèces', year:1859 },
  { emoji:'🔬', title:'Naissance de Marie Curie', wiki:'Marie Curie', year:1867 },
  { emoji:'🕊️', title:'Naissance du Mahatma Gandhi', wiki:'Mahatma Gandhi', year:1869 },
  { emoji:'☎️', title:'Invention du téléphone', wiki:'Alexander Graham Bell', year:1876 },
  { emoji:'💡', title:'Invention de l\'ampoule électrique', wiki:'Thomas Edison', year:1879 },
  { emoji:'🧠', title:'Naissance d\'Albert Einstein', wiki:'Albert Einstein', year:1879 },
  { emoji:'🚗', title:'Invention de l\'automobile moderne', wiki:'Karl Benz', year:1886 },
  { emoji:'✈️', title:'Premier vol des frères Wright', wiki:'Frères Wright', year:1903 },
  { emoji:'🚢', title:'Naufrage du Titanic', wiki:'Titanic', year:1912 },
  { emoji:'💥', title:'Début de la Première Guerre mondiale', wiki:'Première Guerre mondiale', year:1914 },
  { emoji:'🦠', title:'Découverte de la pénicilline', wiki:'Pénicilline', year:1928 },
  { emoji:'⚫', title:'Début de la Seconde Guerre mondiale', wiki:'Seconde Guerre mondiale', year:1939 },
  { emoji:'🛰️', title:'Lancement de Spoutnik 1', wiki:'Spoutnik 1', year:1957 },
  { emoji:'✊', title:'Discours "I Have a Dream" de M.L. King', wiki:'Martin Luther King', year:1963 },
  { emoji:'🌙', title:'Premier pas sur la Lune', wiki:'Apollo 11', year:1969 },
  { emoji:'🧱', title:'Chute du mur de Berlin', wiki:'Chute du mur de Berlin', year:1989 },
  { emoji:'💻', title:'Invention du World Wide Web', wiki:'World Wide Web', year:1989 },
  { emoji:'📱', title:'Sortie du premier iPhone', wiki:'IPhone', year:2007 },
  { emoji:'🕯️', title:'Attentats du 11 septembre', wiki:'Attentats du 11 septembre 2001', year:2001 },
];

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

function pickFive(){
  const shuffled = shuffle(POOL);
  const chosen = [];
  const usedYears = new Set();
  for (const item of shuffled){
    if (chosen.length >= 5) break;
    if (usedYears.has(item.year)) continue;
    usedYears.add(item.year);
    chosen.push(item);
  }
  return chosen;
}

const MONTHS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';

// Strip anything that could give away the date/century: full dates, standalone
// 3-4 digit numbers (years), "av. J.-C." markers, and roman-numeral centuries.
function sanitizeExtract(text){
  if (!text) return '';
  let t = text;
  t = t.replace(new RegExp(`\\b\\d{1,2}(er)?\\s+(${MONTHS})\\s+\\d{1,4}\\b`, 'gi'), '—');
  t = t.replace(new RegExp(`(${MONTHS})\\s+\\d{1,4}\\b`, 'gi'), '$1 —');
  t = t.replace(/\b\d{1,4}\b/g, '—');
  t = t.replace(/—\s*av\.?\s*J\.?-?C\.?/gi, '—');
  t = t.replace(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI)e?\s+si[eè]cle\b/gi, 'siècle —');
  t = t.replace(/(—\s*){2,}/g, '— ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

async function fetchSummary(item){
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.wiki)}`);
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    const raw = (data.extract || '').split('. ').slice(0, 2).join('. ');
    return {
      extract: sanitizeExtract(raw),
      thumb: (data.thumbnail && data.thumbnail.source) ? data.thumbnail.source : null,
    };
  } catch (e) {
    return { extract: '', thumb: null };
  }
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
    titleEl.textContent = `${item.emoji} ${item.title}`;
    const extractEl = document.createElement('div');
    extractEl.className = 'card-extract';
    extractEl.textContent = item.extract || '';
    body.appendChild(titleEl);
    body.appendChild(extractEl);

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

  const items = pickFive();
  const enriched = await Promise.all(items.map(async (item, i) => {
    const summary = await fetchSummary(item);
    return Object.assign({}, item, summary, { _id: i + '-' + Date.now() });
  }));

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
