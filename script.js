(function() {
  // --- CONSTANTES & VARIABLES GLOBALES ---
  const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
  const CARD_H = 140; // Doit correspondre à la hauteur dans le CSS
  const GAP = 16;     // Doit correspondre à l'espacement dans le CSS
  
  let order = [];
  let solved = false;
  let cardEls = {};
  let currentDragId = null;

  // --- ÉLÉMENTS DOM ---
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const statusEl = document.getElementById('status');
  const loadingEl = document.getElementById('loading');
  const boardWrapEl = document.getElementById('boardWrap');
  const boardEl = document.getElementById('board');
  const railEl = document.getElementById('rail');
  const validateBtn = document.getElementById('validateBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const resultBanner = document.getElementById('resultBanner');

  // --- GESTION DU THÈME ---
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
  }
  
  let currentTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  applyTheme(currentTheme);

  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(currentTheme);
  });

  // --- UTILITAIRES ---
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function formatYear(y) {
    if (y < 0) return `${Math.abs(y)} av. J.-C.`;
    return `En ${y}`;
  }

  function randomMonthDay() {
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * DAYS_IN_MONTH[month - 1]) + 1;
    return { mm: String(month).padStart(2, '0'), dd: String(day).padStart(2, '0') };
  }

  // --- API WIKIPÉDIA ---
  async function fetchDailyEvents() {
    const { mm, dd } = randomMonthDay();
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    if (!res.ok) throw new Error('Erreur API');
    const data = await res.json();
    return data.events || [];
  }

  function formatEventTitle(text) {
    if (!text) return '';
    let t = text.trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t.replace(/\.$/, '');
  }

  const RECURRING_KEYWORDS = [
    'élection', 'référendum', 'referendum', 'jeux olympiques', 'jeux paralympiques',
    'championnat', 'coupe du monde', 'grand prix', 'festival de cannes', 'oscars',
    'grammy', 'eurovision', 'sommet'
  ];

  function isRecurringEvent(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return RECURRING_KEYWORDS.some(k => t.includes(k));
  }

  function selectFive(events) {
    const usable = shuffle(events).filter(e =>
      e.year && e.pages && e.pages[0] && e.pages[0].extract && !isRecurringEvent(e.text)
    );
    const chosen = [];
    const usedYears = new Set();
    for (const e of usable) {
      if (chosen.length >= 5) break;
      if (usedYears.has(e.year)) continue;
      usedYears.add(e.year);
      chosen.push(e);
    }
    return chosen;
  }

  async function pickFiveFromApi() {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const events = await fetchDailyEvents();
        const chosen = selectFive(events);
        if (chosen.length >= 5) return chosen;
      } catch (e) { /* On retente */ }
    }
    return [];
  }

  // --- RENDU VISUEL ---
  function buildRail(n) {
    railEl.innerHTML = '<div class="rail-line"></div>';
    for (let i = 0; i < n; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      // Centrage mathématique du point sur la ligne
      tick.style.top = (i * (CARD_H + GAP) + (CARD_H / 2) - 6) + 'px';
      tick.dataset.index = i;
      railEl.appendChild(tick);
    }
  }

  function revealTick(index) {
    const tick = railEl.querySelector(`.tick[data-index="${index}"]`);
    if (tick) tick.classList.add('revealed');
  }

  function clearReveal() {
    railEl.querySelectorAll('.tick').forEach(t => t.classList.remove('revealed'));
  }

  function slotY(index) { return index * (CARD_H + GAP); }

  function layout(excludeId) {
    order.forEach((item, i) => {
      if (item._id === excludeId) return;
      const el = cardEls[item._id];
      if (el) el.style.transform = `translateY(${slotY(i)}px)`;
    });
  }

  function render() {
    boardEl.innerHTML = '';
    cardEls = {};
    boardEl.style.height = (slotY(order.length - 1) + CARD_H) + 'px';

    order.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = item._id;
      card.style.transition = 'none'; // Empêche l'animation au premier rendu

      // Poignée
      const handle = document.createElement('div');
      handle.className = 'card-handle';
      handle.innerHTML = '⠿';

      // Image
      const thumb = document.createElement('div');
      thumb.className = 'card-thumb';
      if (item.thumb) {
        const img = document.createElement('img');
        img.src = item.thumb;
        img.alt = '';
        img.draggable = false;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '📜';
      }

      // Contenu (Titre + Année cachée)
      const content = document.createElement('div');
      content.className = 'card-content';
      
      const titleEl = document.createElement('div');
      titleEl.className = 'card-title';
      titleEl.textContent = item.title;
      
      const yearEl = document.createElement('div');
      yearEl.className = 'card-year';
      
      content.appendChild(titleEl);
      content.appendChild(yearEl);

      card.appendChild(handle);
      card.appendChild(thumb);
      card.appendChild(content);

      cardEls[item._id] = card;
      boardEl.appendChild(card);
      attachDrag(card, item);
    });

    layout(null);

    requestAnimationFrame(() => {
      Object.values(cardEls).forEach(el => { el.style.transition = ''; });
    });
  }

  // --- DRAG & DROP ---
  function attachDrag(card, item) {
    card.addEventListener('pointerdown', (e) => {
      if (solved) return;
      // Si on clique sur un bouton ou un lien, on ne drag pas
      if (e.target.closest('button') || e.target.closest('a')) return;

      const startY = e.clientY;
      const startIndex = order.findIndex(o => o._id === item._id);
      const startTranslate = slotY(startIndex);
      const maxTranslate = slotY(order.length - 1);

      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging');
      currentDragId = item._id;

      function onMove(ev) {
        const dy = ev.clientY - startY;
        const t = Math.max(0, Math.min(maxTranslate, startTranslate + dy));
        card.style.transform = `translateY(${t}px)`;

        const candidateIndex = Math.round(t / (CARD_H + GAP));
        const currentIndex = order.findIndex(o => o._id === item._id);
        
        if (candidateIndex !== currentIndex) {
          const [moved] = order.splice(currentIndex, 1);
          order.splice(candidateIndex, 0, moved);
          layout(item._id);
        }
      }

      function onUp() {
        card.classList.remove('dragging');
        currentDragId = null;
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

  // --- VALIDATION ---
  function checkOrder() {
    if (solved) return;
    solved = true;
    validateBtn.disabled = true;

    const correctOrder = order.slice().sort((a, b) => a.year - b.year);
    let allCorrect = true;

    order.forEach((item, idx) => {
      const card = cardEls[item._id];
      const yearEl = card.querySelector('.card-year');
      const isCorrect = correctOrder[idx]._id === item._id;
      
      yearEl.textContent = formatYear(item.year);
      
      if (isCorrect) {
        card.classList.add('correct');
      } else {
        card.classList.add('wrong');
        allCorrect = false;
      }
      revealTick(idx);
    });

    resultBanner.className = 'result-banner show ' + (allCorrect ? 'win' : 'lose');
    resultBanner.textContent = allCorrect
      ? 'Félicitations ! La chronologie est parfaite.'
      : 'Presque ! Regarde les dates qui viennent d\'apparaître.';

    statusEl.textContent = allCorrect ? 'Gagné !' : 'Terminé';
  }

  // --- NOUVELLE PARTIE ---
  async function newGame() {
    solved = false;
    resultBanner.className = 'result-banner';
    clearReveal();
    loadingEl.style.display = 'flex';
    boardWrapEl.style.display = 'none';
    validateBtn.disabled = true;
    newGameBtn.disabled = true;
    statusEl.textContent = 'Chargement…';

    const events = await pickFiveFromApi();

    if (events.length < 5) {
      loadingEl.style.display = 'none';
      newGameBtn.disabled = false;
      statusEl.textContent = 'Erreur de connexion. Réessaie.';
      return;
    }

    const enriched = events.map((e, i) => ({
      title: formatEventTitle(e.text),
      year: e.year,
      thumb: (e.pages[0].thumbnail) ? e.pages[0].thumbnail.source : null,
      _id: i + '-' + Date.now(),
    }));

    order = shuffle(enriched);
    buildRail(order.length);
    render();

    loadingEl.style.display = 'none';
    boardWrapEl.style.display = 'flex';
    validateBtn.disabled = false;
    newGameBtn.disabled = false;
    statusEl.textContent = 'À toi de jouer !';
  }

  // --- INITIALISATION ---
  validateBtn.addEventListener('click', checkOrder);
  newGameBtn.addEventListener('click', newGame);

  newGame();
})();
