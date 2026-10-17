(function() {
  const CARD_H = 90; /* Hauteur de base (s'adapte si la desc est longue) */
  const GAP = 12;
  
  let order = [];
  let solved = false;
  let cardEls = {};
  
  let dragState = null;
  let animationFrameId = null;

  const themeToggle = document.getElementById('themeToggle');
  const statusEl = document.getElementById('status');
  const boardEl = document.getElementById('board');
  const railEl = document.getElementById('rail');
  const validateBtn = document.getElementById('validateBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const resultEl = document.getElementById('result');
  const modeSelect = document.getElementById('modeSelect');

  // --- Thème ---
  const currentTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  themeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  });

  resultEl.addEventListener('click', () => resultEl.classList.remove('show'));

  // --- Utilitaires ---
  const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
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

  function randomMonthDay() {
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * DAYS_IN_MONTH[month - 1]) + 1;
    return { mm: String(month).padStart(2, '0'), dd: String(day).padStart(2, '0') };
  }

  // Nettoie le texte (enlève les [réf.], etc.)
  function cleanText(text) {
    if (!text) return '';
    let t = text.trim();
    t = t.replace(/_/g, ' '); // Remplace les underscores par des espaces
    t = t.replace(/\[.*?\]/g, ''); // Enlève [1], [réf. nécessaire]
    t = t.replace(/\s+/g, ' '); // Enlève les doubles espaces
    t = t.replace(/\s+([.,;:!?])/g, '$1'); // Nettoie les espaces avant ponctuation
    t = t.charAt(0).toUpperCase() + t.slice(1); // Majuscule au début
    return t.replace(/\.$/, '').trim(); // Enlève le point final
  }

  // Nettoie le titre de l'article (enlève les dates entre parenthèses)
  function cleanArticleTitle(title) {
    if (!title) return '';
    let t = title.replace(/_/g, ' '); // Remplace les underscores par des espaces
    t = t.replace(/\s*\([0-9]{3,4}(?:\s*-\s*[0-9]{3,4})?\)\s*$/, ''); // Enlève les dates (ex: 1515)
    return t.trim();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function slotY(index) { return index * (CARD_H + GAP); }

  // ============================================================
  // OPTIMISATION RÉSEAU
  // ============================================================

  async function getBatchPageviews(articleTitles) {
    if (!articleTitles || articleTitles.length === 0) return {};

    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = lastMonth.getFullYear();
    const month = String(lastMonth.getMonth() + 1).padStart(2, '0');
    const start = `${year}${month}01`;
    const end = `${year}${month}28`;

    const titles = articleTitles.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join('%7C');
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/user/${titles}/monthly/${start}/${end}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return {};
      const data = await res.json();
      const viewsMap = {};
      if (data.items) {
        data.items.forEach(item => {
          const title = item.article.replace(/_/g, ' ');
          if (!viewsMap[title]) viewsMap[title] = 0;
          viewsMap[title] += item.views;
        });
      }
      return viewsMap;
    } catch (e) { return {}; }
  }

  async function fetchEventsForDate(mm, dd) {
    try {
      const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.events || [];
    } catch (e) { return []; }
  }

  async function prepareGameData(isHardMode = false) {
    const { mm, dd } = randomMonthDay();
    statusEl.textContent = `Chargement du ${dd}/${mm}...`;
    
    const events = await fetchEventsForDate(mm, dd);
    let usable = shuffle(events).filter(e =>
      e.year && e.pages && e.pages[0] && e.pages[0].extract && !isRecurringEvent(e.text)
    );

    if (usable.length === 0) return [];

    if (!isHardMode) {
      statusEl.textContent = 'Analyse de la popularité...';
      const titlesToCheck = usable.slice(0, 50).map(e => e.pages[0].title);
      const viewsMap = await getBatchPageviews(titlesToCheck);
      usable = usable.filter(e => {
        const title = e.pages[0].title;
        return (viewsMap[title] || 0) >= 10000;
      });
    }

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

  // --- Logique du jeu ---
  function buildRail(n) {
    railEl.innerHTML = '';
    const boardHeight = slotY(n - 1) + CARD_H;
    railEl.style.height = boardHeight + 'px';

    const centerFirst = slotY(0) + CARD_H / 2;
    const centerLast = slotY(n - 1) + CARD_H / 2;
    const lineHeight = centerLast - centerFirst;

    const line = document.createElement('div');
    line.className = 'rail-line';
    line.style.top = centerFirst + 'px';
    line.style.height = lineHeight + 'px';
    railEl.appendChild(line);

    for (let i = 0; i < n; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.top = (slotY(i) + CARD_H / 2 - 6) + 'px'; 
      tick.dataset.index = i;
      railEl.appendChild(tick);
    }
  }

  function layout(excludeId) {
    order.forEach((item, i) => {
      if (item._id === excludeId) return;
      const el = cardEls[item._id];
      if (el) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = `translateY(${slotY(i)}px)`;
      }
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
      card.style.transition = 'none';
      card.style.transform = `translateY(${slotY(order.indexOf(item))}px)`;

      const grip = document.createElement('div');
      grip.className = 'grip';

      const content = document.createElement('div');
      content.className = 'content';
      
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.text; // Le titre de l'article
      
      const desc = document.createElement('div');
      desc.className = 'description';
      desc.textContent = item.description; // Le texte de l'événement
      
      const year = document.createElement('div');
      year.className = 'year';
      year.textContent = item.year;
      
      content.appendChild(title);
      content.appendChild(desc);
      content.appendChild(year);
      
      card.appendChild(grip);
      card.appendChild(content);

      cardEls[item._id] = card;
      boardEl.appendChild(card);
      
      attachDrag(card, item);
    });
  }

  // --- Drag & Drop ---
  function attachDrag(card, item) {
    card.addEventListener('pointerdown', (e) => {
      if (solved) return;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const rect = card.getBoundingClientRect();
      const offsetY = e.clientY - rect.top; 
      const startIndex = order.findIndex(o => o._id === item._id);
      
      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging');
      card.style.transition = 'none'; 

      dragState = {
        card,
        item,
        pointerY: e.clientY,
        offsetY,
        startIndex,
        maxTranslate: slotY(order.length - 1)
      };

      function animate() {
        if (!dragState) return;

        const boardRect = boardEl.getBoundingClientRect();
        const pointerY = dragState.pointerY - boardRect.top;
        
        let t = pointerY - dragState.offsetY;
        t = Math.max(0, Math.min(dragState.maxTranslate, t));
        
        dragState.card.style.transform = `translateY(${t}px)`;

        const candidateIndex = Math.round(t / (CARD_H + GAP));
        const currentIndex = order.findIndex(o => o._id === dragState.item._id);
        
        if (candidateIndex !== currentIndex) {
          const [moved] = order.splice(currentIndex, 1);
          order.splice(candidateIndex, 0, moved);
          layout(dragState.item._id);
        }

        animationFrameId = requestAnimationFrame(animate);
      }

      animationFrameId = requestAnimationFrame(animate);

      function onMove(ev) {
        if (dragState) dragState.pointerY = ev.clientY;
      }

      function onUp() {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        if (dragState) {
          const finalIndex = order.findIndex(o => o._id === dragState.item._id);
          dragState.card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
          dragState.card.style.transform = `translateY(${slotY(finalIndex)}px)`;
          dragState.card.classList.remove('dragging');
          setTimeout(() => { 
            if (dragState) dragState.card.style.transition = '';
            dragState = null; 
          }, 300);
        }
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerup', onUp);
        card.removeEventListener('pointercancel', onUp);
      }

      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerup', onUp);
      card.addEventListener('pointercancel', onUp);
    });
  }

  // --- Validation ---
  function checkOrder() {
    if (solved) return;
    solved = true;
    validateBtn.disabled = true;
    statusEl.textContent = 'Vérification...';

    const correctOrder = order.slice().sort((a, b) => a.year - b.year);
    const correctPositions = {};
    correctOrder.forEach((item, index) => {
      correctPositions[item._id] = index;
    });

    let allCorrect = true;

    order.forEach((item, idx) => {
      const card = cardEls[item._id];
      
      const isCorrect = correctPositions[item._id] === idx;
      
      if (isCorrect) {
        card.classList.add('correct');
        card.classList.remove('wrong');
      } else {
        card.classList.add('wrong');
        card.classList.remove('correct');
        allCorrect = false;
      }
      
      const tick = railEl.querySelector(`.tick[data-index="${idx}"]`);
      if (tick) tick.classList.add('revealed');
    });

    resultEl.className = 'result show ' + (allCorrect ? 'win' : 'lose');
    
    if (allCorrect) {
      resultEl.textContent = 'Parfait ! L\'ordre est exact.';
    } else {
      const correctCount = order.filter((item, idx) => correctPositions[item._id] === idx).length;
      resultEl.textContent = `Presque ! ${correctCount} carte(s) sur 5 sont à la bonne place.`;
    }
    
    statusEl.textContent = 'Fini';
  }

  // --- Nouvelle Partie ---
  async function newGame() {
    solved = false;
    dragState = null;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    resultEl.className = 'result';
    railEl.querySelectorAll('.tick').forEach(t => t.classList.remove('revealed'));
    validateBtn.disabled = true;
    newGameBtn.disabled = true;

    const isHardMode = modeSelect.value === 'hard';

    boardEl.innerHTML = '';
    boardEl.style.height = '0px';
    
    let events = await prepareGameData(isHardMode);

    // Fallback si on n'a pas 5 événements
    if (events.length < 5) {
      statusEl.textContent = 'Recherche d\'une autre date...';
      const { mm, dd } = randomMonthDay();
      const fallbackEvents = await fetchEventsForDate(mm, dd);
      
      let usable = shuffle(fallbackEvents).filter(e => e.year && !isRecurringEvent(e.text));
      events = [];
      const usedYears = new Set();
      for (const e of usable) {
        if (events.length >= 5) break;
        if (usedYears.has(e.year)) continue;
        usedYears.add(e.year);
        events.push(e);
      }
    }

    if (events.length < 5) {
      statusEl.textContent = 'Impossible de trouver 5 événements. Réessaie.';
      newGameBtn.disabled = false;
      return;
    }

    // L'INVERSION SE FAIT ICI
    const enriched = events.map((e, i) => {
      const articleTitle = e.pages[0].title;
      
      return {
        // Le gros titre = le titre de l'article (sans les dates)
        text: cleanArticleTitle(articleTitle), 
        // La description = le texte de l'événement (nettoyé)
        description: cleanText(e.text),         
        year: e.year,
        _id: i + '-' + Date.now(),
      };
    });

    order = shuffle(enriched);
    buildRail(order.length);
    render();

    validateBtn.disabled = false;
    newGameBtn.disabled = false;
    statusEl.textContent = 'Prêt';
  }

  validateBtn.addEventListener('click', checkOrder);
  newGameBtn.addEventListener('click', newGame);

  newGame();
})();
