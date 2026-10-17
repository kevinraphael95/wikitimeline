(function() {
  const GAP = 12;                 // Espace entre les cartes
  const CARDS_PER_GAME = 5;
  const MAX_ATTEMPTS = 5;         // Nombre de dates essayées avant d'abandonner
  const POPULARITY_MIN = 10000;   // Vues minimum sur 30 jours (mode Normal)

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
  // Le thème initial est posé sur <html> par le script du <head> (aucun flash).
  const root = document.documentElement;
  themeToggle.textContent = root.dataset.theme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const newTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = newTheme;
    root.style.colorScheme = newTheme;
    try { localStorage.setItem('theme', newTheme); } catch (e) {}
    themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  });

  resultEl.addEventListener('click', () => resultEl.classList.remove('show'));

  // --- Utilitaires de nettoyage ---
  const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
  const RECURRING_KEYWORDS = ['élection', 'référendum', 'referendum', 'jeux olympiques', 'jeux paralympiques', 'championnat', 'coupe du monde', 'grand prix', 'festival de cannes', 'oscars', 'grammy', 'eurovision', 'sommet'];

  function isRecurringEvent(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return RECURRING_KEYWORDS.some(k => t.includes(k));
  }

  // L'année apparaît-elle dans le titre ou la description ? (spoiler)
  function leaksYear(e) {
    const y = String(Math.abs(e.year));
    // Les titres de l'API ont des underscores ; \b ne les traite pas comme des
    // séparateurs, donc on les remplace par des espaces avant le test.
    const haystack = ((e.text || '') + ' ' + ((e.pages && e.pages[0] && e.pages[0].title) || '')).replace(/_/g, ' ');
    return new RegExp('\\b' + y + '\\b').test(haystack);
  }

  function randomMonthDay() {
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * DAYS_IN_MONTH[month - 1]) + 1;
    return { mm: String(month).padStart(2, '0'), dd: String(day).padStart(2, '0') };
  }

  function cleanText(text) {
    if (!text) return '';
    let t = text.trim();
    t = t.replace(/_/g, ' ');
    t = t.replace(/\[.*?\]/g, '');
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/\s+([.,;:!?])/g, '$1');
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t.replace(/\.$/, '').trim();
  }

  function cleanArticleTitle(title) {
    if (!title) return '';
    let t = title.replace(/_/g, ' ');
    t = t.replace(/\s*\([0-9]{3,4}(?:\s*-\s*[0-9]{3,4})?\)\s*$/, '');
    return t.trim();
  }

  // Année affichable : -44 → « 44 av. J.-C. »
  function formatYear(y) {
    return y < 0 ? `${-y} av. J.-C.` : String(y);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ============================================================
  // DONNÉES (Wikipédia)
  // ============================================================
  const pageKey = (e) => e.pages[0].title.replace(/_/g, ' ');

  // Vues sur les 30 derniers jours pour jusqu'à 50 articles, en UNE requête
  // (API Action de Wikipédia). Renvoie null si la requête échoue, pour que
  // l'appelant puisse ignorer le filtre de popularité au lieu de tout rejeter.
  async function getBatchPageviews(titles) {
    if (!titles || !titles.length) return {};
    const url = 'https://fr.wikipedia.org/w/api.php?action=query&prop=pageviews&pvipdays=30'
      + '&format=json&origin=*&redirects=1&titles=' + encodeURIComponent(titles.join('|'));
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const q = data.query || {};

      // Chemin « titre demandé → titre normalisé → cible de redirection »
      const alias = {};
      (q.normalized || []).forEach(n => { alias[n.from] = n.to; });
      (q.redirects || []).forEach(r => { alias[r.from] = r.to; });

      const viewsByTitle = {};
      Object.values(q.pages || {}).forEach(p => {
        viewsByTitle[p.title] = Object.values(p.pageviews || {})
          .reduce((sum, v) => sum + (v || 0), 0);
      });

      const out = {};
      titles.forEach(t => {
        let x = t;
        for (let i = 0; i < 3 && alias[x]; i++) x = alias[x];
        if (x in viewsByTitle) out[t] = viewsByTitle[x];
      });
      return out;
    } catch (e) { return null; }
  }

  async function fetchEventsForDate(mm, dd) {
    try {
      const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
      if (!res.ok) return [];
      return (await res.json()).events || [];
    } catch (e) { return []; }
  }

  function isUsableEvent(e) {
    return Number.isFinite(e.year)
      && e.pages && e.pages[0] && e.pages[0].title
      && !isRecurringEvent(e.text)
      && !leaksYear(e);
  }

  // Garde au plus `count` événements, tous d'années différentes
  function pickDistinctYears(list, count) {
    const chosen = [];
    const usedYears = new Set();
    for (const e of list) {
      if (chosen.length >= count) break;
      if (usedYears.has(e.year)) continue;
      usedYears.add(e.year);
      chosen.push(e);
    }
    return chosen;
  }

  // Essaie UNE date au hasard
  async function tryRandomDate(usePopularity) {
    const { mm, dd } = randomMonthDay();
    statusEl.textContent = `Chargement du ${dd}/${mm}...`;
    const events = await fetchEventsForDate(mm, dd);
    let usable = shuffle(events).filter(isUsableEvent);

    if (usePopularity && usable.length) {
      statusEl.textContent = 'Analyse de la popularité...';
      const sample = usable.slice(0, 50);
      const views = await getBatchPageviews(sample.map(pageKey));
      // Si l'API de stats est indisponible (null), on garde tout l'échantillon
      usable = views
        ? sample.filter(e => (views[pageKey(e)] || 0) >= POPULARITY_MIN)
        : sample;
    }
    return pickDistinctYears(usable, CARDS_PER_GAME);
  }

  // ============================================================
  // LOGIQUE DE RENDU DYNAMIQUE
  // ============================================================

  function layout(excludeId) {
    let currentY = 0;
    order.forEach((item) => {
      const el = cardEls[item._id];
      if (!el) return;

      if (item._id !== excludeId) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = `translateY(${currentY}px)`;
      }

      // Hauteur réelle + espace
      currentY += el.offsetHeight + GAP;
    });

    const total = Math.max(0, currentY - GAP);
    boardEl.style.height = total + 'px';
    railEl.style.height = total + 'px';
    updateRail();
  }

  function updateRail() {
    railEl.innerHTML = '';
    if (order.length === 0) return;

    let currentY = 0;
    const ticksData = [];

    order.forEach((item, i) => {
      const el = cardEls[item._id];
      if (!el) return;

      const cardHeight = el.offsetHeight;
      ticksData.push({ top: currentY + cardHeight / 2, index: i });
      currentY += cardHeight + GAP;
    });

    if (!ticksData.length) return;

    const line = document.createElement('div');
    line.className = 'rail-line';
    line.style.top = (ticksData[0].top) + 'px';
    line.style.height = (ticksData[ticksData.length - 1].top - ticksData[0].top) + 'px';
    railEl.appendChild(line);

    ticksData.forEach(t => {
      const tick = document.createElement('div');
      tick.className = 'tick';
      if (solved) tick.classList.add('revealed');
      tick.style.top = (t.top - 6) + 'px';
      tick.dataset.index = t.index;
      railEl.appendChild(tick);
    });
  }

  function render() {
    boardEl.innerHTML = '';
    cardEls = {};

    order.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = item._id;
      card.style.transition = 'none'; // Pas d'anim au premier rendu

      const grip = document.createElement('div');
      grip.className = 'grip';

      const content = document.createElement('div');
      content.className = 'content';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.text;

      const desc = document.createElement('div');
      desc.className = 'description';
      desc.textContent = item.description;

      // L'année est à droite de la carte : elle ne prend plus de hauteur
      const year = document.createElement('div');
      year.className = 'year';
      year.textContent = formatYear(item.year);

      content.appendChild(title);
      content.appendChild(desc);

      card.appendChild(grip);
      card.appendChild(content);
      card.appendChild(year);

      cardEls[item._id] = card;
      boardEl.appendChild(card);

      attachDrag(card, item);
    });

    // On laisse le navigateur calculer la hauteur
    requestAnimationFrame(() => {
      layout(null);
      Object.values(cardEls).forEach(el => { el.style.transition = ''; });
    });
  }

  // Les hauteurs changent quand les polices finissent de charger ou quand la
  // largeur du plateau change (redimensionnement, rotation du téléphone) :
  // on recalcule alors la mise en page.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (order.length && !dragState) layout(null); });
  }
  let lastBoardWidth = 0;
  new ResizeObserver((entries) => {
    const w = entries[0].contentRect.width;
    if (w === lastBoardWidth) return;
    lastBoardWidth = w;
    if (order.length && !dragState) layout(null);
  }).observe(boardEl);

  // --- Drag & Drop ---
  function attachDrag(card, item) {
    card.addEventListener('pointerdown', (e) => {
      if (solved || dragState) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Au doigt, on ne déplace une carte que par sa poignée : le reste de la
      // carte reste utilisable pour faire défiler la page.
      if (e.pointerType === 'touch' && !e.target.closest('.grip')) return;

      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const rect = card.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;

      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging');
      card.style.transition = 'none';

      dragState = {
        card,
        item,
        pointerY: e.clientY,
        offsetY
      };

      function animate() {
        if (!dragState) return;

        const boardRect = boardEl.getBoundingClientRect();
        const pointerY = dragState.pointerY - boardRect.top;

        let t = pointerY - dragState.offsetY;

        const totalHeight = boardEl.offsetHeight - dragState.card.offsetHeight;
        t = Math.max(0, Math.min(totalHeight, t));

        dragState.card.style.transform = `translateY(${t}px)`;

        const cardCenter = t + (dragState.card.offsetHeight / 2);
        let candidateIndex = 0;
        let currentY = 0;

        for (let i = 0; i < order.length; i++) {
          const el = cardEls[order[i]._id];
          const h = el.offsetHeight;

          if (cardCenter > currentY + h / 2) {
            candidateIndex = i;
          } else {
            break;
          }
          currentY += h + GAP;
        }

        const currentIndex = order.findIndex(o => o._id === dragState.item._id);

        if (candidateIndex !== currentIndex && candidateIndex >= 0 && candidateIndex < order.length) {
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
        animationFrameId = null;

        // On libère dragState tout de suite : un nouveau drag peut démarrer
        // pendant l'animation de retour sans être annulé par un timeout.
        const s = dragState;
        dragState = null;

        if (s) {
          s.card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
          layout(null);
          s.card.classList.remove('dragging');
          setTimeout(() => { s.card.style.transition = ''; }, 300);
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
      } else {
        card.classList.add('wrong');
        allCorrect = false;
      }
    });

    updateRail(); // `solved` est vrai : les repères sont révélés

    resultEl.className = 'result show ' + (allCorrect ? 'win' : 'lose');

    if (allCorrect) {
      resultEl.textContent = 'Parfait ! L\'ordre est exact.';
    } else {
      const correctCount = order.filter((item, idx) => correctPositions[item._id] === idx).length;
      resultEl.textContent = `Presque ! ${correctCount} carte(s) sur ${CARDS_PER_GAME} sont à la bonne place.`;
    }

    statusEl.textContent = 'Fini';
  }

  // --- Nouvelle Partie ---
  async function newGame() {
    solved = false;
    dragState = null;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    window.scrollTo({ top: 0, behavior: 'smooth' });

    resultEl.className = 'result';
    validateBtn.disabled = true;
    newGameBtn.disabled = true;

    const isHardMode = modeSelect.value === 'hard';

    boardEl.innerHTML = '';
    boardEl.style.height = '0px';
    railEl.style.height = '0px';
    railEl.innerHTML = '';
    order = [];
    cardEls = {};

    // On essaie plusieurs dates. En mode Normal, le filtre de popularité est
    // appliqué sauf à la toute dernière tentative (pour ne pas bloquer le jeu).
    let events = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && events.length < CARDS_PER_GAME; attempt++) {
      const usePopularity = !isHardMode && attempt < MAX_ATTEMPTS - 1;
      events = await tryRandomDate(usePopularity);
      if (events.length < CARDS_PER_GAME && attempt < MAX_ATTEMPTS - 1) {
        statusEl.textContent = 'Recherche d\'une autre date...';
      }
    }

    if (events.length < CARDS_PER_GAME) {
      statusEl.textContent = 'Impossible de trouver 5 événements. Réessaie.';
      newGameBtn.disabled = false;
      return;
    }

    const enriched = events.map((e, i) => ({
      text: cleanArticleTitle(e.pages[0].title),
      description: cleanText(e.text),
      year: e.year,
      _id: i + '-' + Date.now(),
    }));

    order = shuffle(enriched);
    render();

    validateBtn.disabled = false;
    newGameBtn.disabled = false;
    statusEl.textContent = 'Prêt';
  }

  validateBtn.addEventListener('click', checkOrder);
  newGameBtn.addEventListener('click', newGame);

  newGame();
})();
