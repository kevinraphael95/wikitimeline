(() => {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================
  const CONFIG = {
    GAP: 12,                    // Espace entre les cartes (px)
    CARDS: 5,                   // Cartes par partie
    ATTEMPTS: { easy: 10, normal: 6, hard: 6 }, // Dates essayées avant d’assouplir
    SAMPLE: 100,                // Événements analysés pour la popularité
    BATCH: 50,                  // Max de titres par requête pageviews
    FETCH_TIMEOUT: 8000,        // ms
    MIN_YEAR_GAP: 2,            // Écart minimum entre deux années (assoupli en dernier recours)
    THRESHOLDS: { easy: 60000, normal: 10000, hard: 0 }, // Vues sur 30 jours
    REORDER_DELAY: 1100,        // ms avant de remettre les cartes dans le bon ordre
    EDGE_SCROLL: 70             // Zone de défilement auto en bord d’écran (px)
  };

  const MODES = ['easy', 'normal', 'hard'];
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const RECURRING_KEYWORDS = [
    'élection', 'référendum', 'referendum', 'jeux olympiques', 'jeux paralympiques',
    'championnat', 'coupe du monde', 'grand prix', 'festival de cannes', 'oscars',
    'grammy', 'eurovision', 'sommet'
  ];

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ============================================================
  // ÉTAT
  // ============================================================
  let order = [];            // [{ id, text, year, url }] dans l’ordre affiché
  let solved = false;
  let loading = false;
  let cardEls = {};          // id -> élément
  let railTicks = [];
  let railLine = null;
  let dragState = null;
  let rafId = null;
  let reorderTimer = null;
  let settleTimers = [];
  let nextGame = null;       // { mode, promise } : partie préparée en arrière-plan
  const played = new Set();  // Événements déjà vus pendant la session

  // ============================================================
  // DOM
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const themeToggle = $('themeToggle');
  const statusEl = $('status');
  const statsEl = $('stats');
  const boardEl = $('board');
  const railEl = $('rail');
  const validateBtn = $('validateBtn');
  const newGameBtn = $('newGameBtn');
  const resultEl = $('result');
  const modeSelect = $('modeSelect');

  // ============================================================
  // STOCKAGE (tolérant aux navigateurs qui le bloquent)
  // ============================================================
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* ignoré */ }
    }
  };

  // --- Statistiques ---
  let stats = { played: 0, perfect: 0, streak: 0, best: 0 };
  try {
    const saved = JSON.parse(store.get('wt:stats', 'null'));
    if (saved && typeof saved === 'object') stats = Object.assign(stats, saved);
  } catch (e) { /* ignoré */ }

  function renderStats() {
    statsEl.textContent = stats.played === 0
      ? 'Aucune partie jouée'
      : `Série : ${stats.streak} · Record : ${stats.best} · ${stats.perfect}/${stats.played} parfaites`;
  }

  function recordResult(perfect) {
    stats.played++;
    if (perfect) {
      stats.perfect++;
      stats.streak++;
      stats.best = Math.max(stats.best, stats.streak);
    } else {
      stats.streak = 0;
    }
    store.set('wt:stats', JSON.stringify(stats));
    renderStats();
  }

  // ============================================================
  // THÈME
  // ============================================================
  themeToggle.textContent = root.dataset.theme === 'dark' ? '☀️' : '🌙';
  themeToggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    root.style.colorScheme = next;
    store.set('theme', next);
    themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // ============================================================
  // UTILITAIRES
  // ============================================================
  function setStatus(text, state = 'ready') {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
    statusEl.title = text; // utile quand le texte est tronqué
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randomMonthDay() {
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * DAYS_IN_MONTH[month - 1]) + 1;
    return { mm: String(month).padStart(2, '0'), dd: String(day).padStart(2, '0') };
  }

  function cleanText(text) {
    let t = (text || '').trim();
    t = t.replace(/_/g, ' ').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t.replace(/\.$/, '').trim();
  }

  // Année affichable : -44 → « 44 av. J.-C. »
  const formatYear = (y) => (y < 0 ? `${-y} av. J.-C.` : String(y));

  const eventKey = (e) => `${e.year}|${e.title}`;

  function isRecurringEvent(text) {
    const t = (text || '').toLowerCase();
    return RECURRING_KEYWORDS.some((k) => t.includes(k));
  }

  // L’année apparaît-elle dans la phrase affichée ? (spoiler)
  function leaksYear(e) {
    return new RegExp('\\b' + Math.abs(e.year) + '\\b').test(e.text || '');
  }

  function isUsableEvent(e) {
    return !isRecurringEvent(e.text) && !leaksYear(e) && !played.has(eventKey(e));
  }

  // Garde au plus `count` événements dont les années sont espacées d’au moins `minGap`
  function pickSpread(list, count, minGap) {
    const chosen = [];
    for (const e of list) {
      if (chosen.length >= count) break;
      if (chosen.every((c) => Math.abs(c.year - e.year) >= minGap)) chosen.push(e);
    }
    return chosen;
  }

  const isSorted = (arr) => arr.every((x, i) => i === 0 || arr[i - 1].year <= x.year);

  // ============================================================
  // DONNÉES (Wikipédia)
  // ============================================================
  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // On ne garde que l’essentiel de chaque événement (léger à mettre en cache)
  function normalizeEvent(e) {
    const p = e && e.pages && e.pages[0];
    if (!p || !p.title || !Number.isFinite(e.year) || !e.text) return null;
    return {
      text: e.text,
      year: e.year,
      title: p.title.replace(/_/g, ' '),
      url: (p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page) || null
    };
  }

  const eventsCache = new Map();

  async function fetchEventsForDate(mm, dd) {
    const key = `${mm}-${dd}`;
    if (eventsCache.has(key)) return eventsCache.get(key);

    const ssKey = `wt:ev:${key}`;
    try {
      const raw = sessionStorage.getItem(ssKey);
      if (raw) {
        const cached = JSON.parse(raw);
        eventsCache.set(key, cached);
        return cached;
      }
    } catch (e) { /* ignoré */ }

    const data = await fetchJson(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    if (!data) return []; // un échec n’est jamais mis en cache

    const events = (data.events || []).map(normalizeEvent).filter(Boolean);
    eventsCache.set(key, events);
    try { sessionStorage.setItem(ssKey, JSON.stringify(events)); } catch (e) { /* quota */ }
    return events;
  }

  // Vues sur 30 jours pour jusqu’à 50 articles, en UNE requête. Renvoie null
  // en cas d’échec : l’appelant ignore alors le filtre au lieu de tout rejeter.
  async function getBatchPageviews(titles) {
    if (!titles.length) return {};
    const url = 'https://fr.wikipedia.org/w/api.php?action=query&prop=pageviews&pvipdays=30'
      + '&format=json&origin=*&redirects=1&titles=' + encodeURIComponent(titles.join('|'));
    const data = await fetchJson(url);
    if (!data) return null;

    const q = data.query || {};
    // Chemin « titre demandé → titre normalisé → cible de redirection »
    const alias = {};
    (q.normalized || []).forEach((n) => { alias[n.from] = n.to; });
    (q.redirects || []).forEach((r) => { alias[r.from] = r.to; });

    const viewsByTitle = {};
    Object.values(q.pages || {}).forEach((p) => {
      viewsByTitle[p.title] = Object.values(p.pageviews || {}).reduce((sum, v) => sum + (v || 0), 0);
    });

    const out = {};
    titles.forEach((t) => {
      let x = t;
      for (let i = 0; i < 3 && alias[x]; i++) x = alias[x];
      if (x in viewsByTitle) out[t] = viewsByTitle[x];
    });
    return out;
  }

  async function filterByPopularity(list, minViews) {
    const sample = list.slice(0, CONFIG.SAMPLE);
    const chunks = [];
    for (let i = 0; i < sample.length; i += CONFIG.BATCH) chunks.push(sample.slice(i, i + CONFIG.BATCH));

    const parts = await Promise.all(chunks.map((c) => getBatchPageviews(c.map((e) => e.title))));
    if (parts.some((p) => p === null)) return sample; // stats indisponibles : pas de filtre

    const views = Object.assign({}, ...parts);
    return sample.filter((e) => (views[e.title] || 0) >= minViews);
  }

  // Construit une partie complète. Renvoie un tableau de CARDS événements, ou null.
  async function buildGame(mode, report = () => {}) {
    const attempts = CONFIG.ATTEMPTS[mode];

    for (let i = 0; i < attempts; i++) {
      const last = i === attempts - 1;
      // Dernière tentative : on assouplit pour ne jamais bloquer le jeu
      const minViews = last
        ? (mode === 'easy' ? CONFIG.THRESHOLDS.normal : 0)
        : CONFIG.THRESHOLDS[mode];
      const minGap = last ? 1 : CONFIG.MIN_YEAR_GAP;

      const { mm, dd } = randomMonthDay();
      report(`Chargement du ${dd}/${mm}…`);
      let usable = shuffle(await fetchEventsForDate(mm, dd)).filter(isUsableEvent);

      if (minViews > 0 && usable.length >= CONFIG.CARDS) {
        report('Analyse de la popularité…');
        usable = await filterByPopularity(usable, minViews);
      }

      const picked = pickSpread(usable, CONFIG.CARDS, minGap);
      if (picked.length === CONFIG.CARDS) return picked;
      if (!last) report('Recherche d’une autre date…');
    }
    return null;
  }

  // Prépare la prochaine partie pendant que le joueur réfléchit
  function prefetch(mode) {
    if (navigator.connection && navigator.connection.saveData) return;
    nextGame = { mode, promise: buildGame(mode).catch(() => null) };
  }

  // ============================================================
  // MISE EN PAGE
  // ============================================================
  function layout(excludeId) {
    // Lectures groupées, puis écritures : pas de recalcul de mise en page en boucle
    const heights = order.map((item) => (cardEls[item.id] ? cardEls[item.id].offsetHeight : 0));

    let y = 0;
    const centers = [];
    order.forEach((item, i) => {
      const el = cardEls[item.id];
      if (!el) return;
      if (item.id !== excludeId) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = `translateY(${y}px)`;
      }
      el.setAttribute('aria-posinset', i + 1);
      centers.push(y + heights[i] / 2);
      y += heights[i] + CONFIG.GAP;
    });

    const total = Math.max(0, y - CONFIG.GAP);
    boardEl.style.height = total + 'px';
    railEl.style.height = total + 'px';
    updateRail(centers);
  }

  function buildRail() {
    railEl.innerHTML = '';
    railLine = document.createElement('div');
    railLine.className = 'rail-line';
    railEl.appendChild(railLine);
    railTicks = [];
    for (let i = 0; i < CONFIG.CARDS; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      railEl.appendChild(tick);
      railTicks.push(tick);
    }
  }

  function updateRail(centers) {
    if (!centers.length || !railLine) return;
    railLine.style.top = centers[0] + 'px';
    railLine.style.height = (centers[centers.length - 1] - centers[0]) + 'px';
    railTicks.forEach((tick, i) => {
      if (centers[i] !== undefined) tick.style.top = centers[i] + 'px';
      tick.classList.toggle('revealed', solved);
    });
  }

  function clearBoard() {
    boardEl.innerHTML = '';
    boardEl.style.height = '0px';
    boardEl.classList.remove('solved');
    railEl.innerHTML = '';
    railEl.style.height = '0px';
    order = [];
    cardEls = {};
  }

  function render() {
    boardEl.innerHTML = '';
    cardEls = {};
    buildRail();

    const frag = document.createDocumentFragment();
    order.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = item.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-describedby', 'help');
      card.setAttribute('aria-setsize', order.length);
      card.style.transition = 'none'; // Pas d’animation au premier rendu

      const grip = document.createElement('div');
      grip.className = 'grip';
      grip.setAttribute('aria-hidden', 'true');

      const content = document.createElement('div');
      content.className = 'content';

      const title = document.createElement('div');
      title.className = 'title';
      if (item.url) {
        const a = document.createElement('a');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.tabIndex = -1; // activé après validation
        a.textContent = item.text;
        title.appendChild(a);
      } else {
        title.textContent = item.text;
      }
      content.appendChild(title);

      // L’année est à droite de la carte : elle réserve de la largeur, pas de hauteur
      const year = document.createElement('div');
      year.className = 'year';
      year.textContent = formatYear(item.year);

      card.append(grip, content, year);
      cardEls[item.id] = card;
      frag.appendChild(card);
    });
    boardEl.appendChild(frag);

    // On laisse le navigateur calculer les hauteurs avant de positionner
    requestAnimationFrame(() => {
      layout(null);
      Object.values(cardEls).forEach((el) => { el.style.transition = ''; });
    });
  }

  // Les hauteurs changent quand les polices finissent de charger ou quand la
  // largeur du plateau change (redimensionnement, rotation du téléphone).
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

  // ============================================================
  // DRAG & DROP (un seul jeu d’écouteurs sur le plateau)
  // ============================================================
  function announcePosition(id) {
    const pos = order.findIndex((o) => o.id === id) + 1;
    setStatus(`Carte en position ${pos} sur ${order.length}`, 'ready');
  }

  function dragLoop() {
    if (!dragState) return;
    const { card, clientY, offsetY } = dragState;

    // Défilement automatique près des bords de l’écran
    const edge = CONFIG.EDGE_SCROLL;
    if (clientY < edge) window.scrollBy(0, -Math.ceil((edge - clientY) / 5));
    else if (clientY > window.innerHeight - edge) window.scrollBy(0, Math.ceil((clientY - (window.innerHeight - edge)) / 5));

    const boardRect = boardEl.getBoundingClientRect();
    const maxT = boardEl.offsetHeight - card.offsetHeight;
    const t = Math.max(0, Math.min(maxT, clientY - boardRect.top - offsetY));
    card.style.transform = `translateY(${t}px)`;

    // Index cible selon le centre de la carte
    const center = t + card.offsetHeight / 2;
    let candidate = 0;
    let y = 0;
    for (let i = 0; i < order.length; i++) {
      const h = cardEls[order[i].id].offsetHeight;
      if (center > y + h / 2) candidate = i; else break;
      y += h + CONFIG.GAP;
    }
    // Carte plus haute que sa voisine : son centre n'atteint jamais le seuil.
    // Arrivée en butée basse/haute = dernière/première place.
    if (t >= maxT - 2) candidate = order.length - 1;
    else if (t <= 2) candidate = 0;

    const current = order.findIndex((o) => o.id === dragState.id);
    if (candidate !== current) {
      const [moved] = order.splice(current, 1);
      order.splice(candidate, 0, moved);
      layout(dragState.id);
    }

    rafId = requestAnimationFrame(dragLoop);
  }

  function onPointerDown(e) {
    const card = e.target.closest('.card');
    if (!card || solved || loading || dragState) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Au doigt, on ne déplace une carte que par sa poignée : le reste de la
    // carte reste utilisable pour faire défiler la page.
    if (e.pointerType === 'touch' && !e.target.closest('.grip')) return;

    card.setPointerCapture(e.pointerId);
    card.classList.remove('settling');
    card.classList.add('dragging');
    card.style.transition = 'none';

    dragState = {
      card,
      id: card.dataset.id,
      pointerId: e.pointerId,
      clientY: e.clientY,
      offsetY: e.clientY - card.getBoundingClientRect().top
    };
    rafId = requestAnimationFrame(dragLoop);
  }

  function onPointerMove(e) {
    if (dragState && e.pointerId === dragState.pointerId) dragState.clientY = e.clientY;
  }

  function onPointerEnd(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    cancelAnimationFrame(rafId);
    rafId = null;

    // dragState est libéré tout de suite : un nouveau drag peut démarrer
    // pendant l’animation de retour.
    const { card, id } = dragState;
    dragState = null;

    card.classList.remove('dragging');
    card.classList.add('settling');
    layout(null);
    announcePosition(id);

    const timer = setTimeout(() => {
      card.classList.remove('settling');
      card.style.transition = '';
    }, 320);
    settleTimers.push(timer);
  }

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerEnd);
  boardEl.addEventListener('pointercancel', onPointerEnd);

  // --- Clavier : flèches haut / bas sur une carte ---
  boardEl.addEventListener('keydown', (e) => {
    if (solved || loading || dragState) return;
    const card = e.target.closest('.card');
    if (!card || e.target !== card) return;

    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();

    const from = order.findIndex((o) => o.id === card.dataset.id);
    const to = from + dir;
    if (to < 0 || to >= order.length) return;

    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    layout(null);
    announcePosition(moved.id);
  });

  // ============================================================
  // VALIDATION
  // ============================================================
  function showResult(kind, message) {
    resultEl.className = 'result show ' + kind;
    resultEl.textContent = message;
    resultEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  function hideResult() {
    resultEl.className = 'result';
    resultEl.textContent = '';
  }

  resultEl.addEventListener('click', hideResult);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideResult(); });

  function checkOrder() {
    if (solved || loading || !order.length) return;
    solved = true;
    validateBtn.disabled = true;

    const correct = order.slice().sort((a, b) => a.year - b.year);
    const rightPlace = {};
    correct.forEach((item, i) => { rightPlace[item.id] = i; });

    let correctCount = 0;
    order.forEach((item, idx) => {
      const ok = rightPlace[item.id] === idx;
      if (ok) correctCount++;
      cardEls[item.id].classList.add(ok ? 'correct' : 'wrong');
      cardEls[item.id].classList.remove('settling', 'dragging');
      const link = cardEls[item.id].querySelector('a');
      if (link) link.tabIndex = 0; // les liens deviennent accessibles au clavier
    });

    boardEl.classList.add('solved');
    updateRail(railTicks.map((t) => parseFloat(t.style.top) || 0)); // révèle les repères

    const perfect = correctCount === CONFIG.CARDS;
    recordResult(perfect);

    if (perfect) {
      showResult('win', 'Parfait ! L’ordre est exact.');
    } else {
      showResult('lose', `Presque ! ${correctCount} carte(s) sur ${CONFIG.CARDS} à la bonne place.`);
    }
    setStatus(perfect ? 'Parfait !' : `${correctCount}/${CONFIG.CARDS} bien placées`, 'done');

    // Après un court instant, les cartes se rangent dans le bon ordre
    reorderTimer = setTimeout(() => {
      order = correct;
      layout(null);
      Object.values(cardEls).forEach((el) => el.setAttribute('aria-setsize', order.length));
    }, perfect ? 0 : CONFIG.REORDER_DELAY);

    newGameBtn.focus({ preventScroll: true });
  }

  // ============================================================
  // NOUVELLE PARTIE
  // ============================================================
  function setBusy(busy) {
    loading = busy;
    newGameBtn.disabled = busy;
    modeSelect.disabled = busy;
    if (busy) validateBtn.disabled = true;
  }

  async function newGame() {
    if (loading) return;
    setBusy(true);

    solved = false;
    dragState = null;
    cancelAnimationFrame(rafId);
    clearTimeout(reorderTimer);
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    hideResult();
    clearBoard();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });

    const mode = modeSelect.value;
    store.set('wt:mode', mode);
    setStatus('Chargement…', 'loading');

    let events = null;
    if (nextGame && nextGame.mode === mode) events = await nextGame.promise;
    nextGame = null;
    if (!events) events = await buildGame(mode, (t) => setStatus(t, 'loading'));

    if (!events) {
      setBusy(false);
      setStatus('Connexion impossible. Réessaie.', 'error');
      return;
    }

    events.forEach((e) => played.add(eventKey(e)));
    let items = events.map((e, i) => ({
      id: `c${i}`,
      text: cleanText(e.text),
      year: e.year,
      url: e.url
    }));
    do { items = shuffle(items); } while (isSorted(items)); // jamais déjà dans le bon ordre
    order = items;

    render();
    setBusy(false);
    validateBtn.disabled = false;
    setStatus('Prêt', 'ready');

    prefetch(mode);
  }

  // ============================================================
  // ÉVÉNEMENTS & DÉMARRAGE
  // ============================================================
  validateBtn.addEventListener('click', checkOrder);
  newGameBtn.addEventListener('click', newGame);

  modeSelect.addEventListener('change', () => {
    store.set('wt:mode', modeSelect.value);
    if (!loading) prefetch(modeSelect.value);
  });

  const savedMode = store.get('wt:mode', 'normal');
  modeSelect.value = MODES.includes(savedMode) ? savedMode : 'normal';

  renderStats();
  newGame();
})();
