(() => {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================
  const CONFIG = {
    GAP: 12,
    CARDS: 5,
    ATTEMPTS: { easy: 10, normal: 6, hard: 6 },
    SAMPLE: 100,
    BATCH: 50,
    FETCH_TIMEOUT: 12000,
    MIN_YEAR_GAP: 2,
    THRESHOLDS: { easy: 30000, normal: 10000, hard: 0 },
    REORDER_DELAY: 1100,
    EDGE_SCROLL: 70
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
  let order = [];
  let solved = false;
  let loading = false;
  let cardEls = {};
  let railTicks = [];
  let railLine = null;
  let dragState = null;
  let rafId = null;
  let reorderTimer = null;
  let settleTimers = [];
  let nextGame = null;
  const played = new Set();

  // ============================================================
  // DOM (Corrigé pour correspondre à ton HTML)
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  
  const themeToggle = $('themeToggle');
  const statusEl = $('status');
  
  // On cible les éléments individuels des stats comme dans ton HTML
  const sStreak = $('s-streak');
  const sBest = $('s-best');
  const sPerfect = $('s-perfect');
  
  const boardEl = $('board');
  const railEl = $('rail');
  const validateBtn = $('validateBtn');
  const newGameBtn = $('newGameBtn');
  const modeSelect = $('modeSelect');
  
  // Note : on ne cherche plus 'resultEl' car il n'y a pas de div #result dans ton HTML
  // Le résultat s'affiche déjà via statusEl

  // ============================================================
  // STOCKAGE
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
    // Mise à jour des éléments individuels
    if (sStreak) sStreak.textContent = stats.streak;
    if (sBest) sBest.textContent = stats.best;
    if (sPerfect) sPerfect.textContent = `${stats.perfect}/${stats.played}`;
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
    statusEl.title = text;
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

  const formatYear = (y) => (y < 0 ? `${-y} av. J.-C.` : String(y));
  const eventKey = (e) => `${e.year}|${e.title}`;

  function isRecurringEvent(text) {
    const t = (text || '').toLowerCase();
    return RECURRING_KEYWORDS.some((k) => t.includes(k));
  }

  function leaksYear(e) {
    return new RegExp('\\b' + Math.abs(e.year) + '\\b').test(e.text || '');
  }

  function isUsableEvent(e) {
    return !isRecurringEvent(e.text) && !leaksYear(e) && !played.has(eventKey(e));
  }

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
    if (!data) return [];

    const events = (data.events || []).map(normalizeEvent).filter(Boolean);
    eventsCache.set(key, events);
    try { sessionStorage.setItem(ssKey, JSON.stringify(events)); } catch (e) { /* quota */ }
    return events;
  }

  const viewsCache = new Map();

  async function getBatchPageviews(titles) {
    const missing = titles.filter((t) => !viewsCache.has(t));

    if (missing.length) {
      const base = 'https://fr.wikipedia.org/w/api.php?action=query&prop=pageviews&pvipdays=30'
        + '&format=json&origin=*&redirects=1&titles=' + encodeURIComponent(missing.join('|'));
      const alias = {};
      const daily = {};
      let extra = '';
      let finished = false;

      for (let round = 0; round < 10; round++) {
        const data = await fetchJson(base + extra);
        if (!data) return null;
        const q = data.query || {};
        (q.normalized || []).forEach((n) => { alias[n.from] = n.to; });
        (q.redirects || []).forEach((r) => { alias[r.from] = r.to; });
        Object.values(q.pages || {}).forEach((p) => {
          daily[p.title] = Object.assign(daily[p.title] || {}, p.pageviews || {});
        });
        if (!data.continue) { finished = true; break; }
        extra = '&' + Object.entries(data.continue)
          .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      }

      missing.forEach((t) => {
        let x = t;
        for (let i = 0; i < 3 && alias[x]; i++) x = alias[x];
        const d = daily[x];
        if (d) viewsCache.set(t, Object.values(d).reduce((sum, v) => sum + (v || 0), 0));
        else if (finished) viewsCache.set(t, 0);
      });
    }

    const out = {};
    titles.forEach((t) => { if (viewsCache.has(t)) out[t] = viewsCache.get(t); });
    return out;
  }

  async function filterByPopularity(list, minViews) {
    const sample = list.slice(0, CONFIG.SAMPLE);
    const chunks = [];
    for (let i = 0; i < sample.length; i += CONFIG.BATCH) chunks.push(sample.slice(i, i + CONFIG.BATCH));

    const parts = await Promise.all(chunks.map((c) => getBatchPageviews(c.map((e) => e.title))));
    if (parts.some((p) => p === null)) return sample;

    const views = Object.assign({}, ...parts);
    return sample.filter((e) => (views[e.title] || 0) >= minViews);
  }

  async function buildGame(mode, report = () => {}) {
    const attempts = CONFIG.ATTEMPTS[mode];

    for (let i = 0; i < attempts; i++) {
      const last = i === attempts - 1;
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

  function prefetch(mode) {
    if (navigator.connection && navigator.connection.saveData) return;
    nextGame = { mode, promise: buildGame(mode).catch(() => null) };
  }

  // ============================================================
  // MISE EN PAGE
  // ============================================================
  function layout(excludeId) {
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
      card.style.transition = 'none';

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
        a.tabIndex = -1;
        a.textContent = item.text;
        title.appendChild(a);
      } else {
        title.textContent = item.text;
      }
      content.appendChild(title);

      const year = document.createElement('div');
      year.className = 'year';
      year.textContent = formatYear(item.year);

      card.append(grip, content, year);
      cardEls[item.id] = card;
      frag.appendChild(card);
    });
    boardEl.appendChild(frag);

    requestAnimationFrame(() => {
      layout(null);
      Object.values(cardEls).forEach((el) => { el.style.transition = ''; });
    });
  }

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
  // DRAG & DROP
  // ============================================================
  function announcePosition(id) {
    const pos = order.findIndex((o) => o.id === id) + 1;
    setStatus(`Carte en position ${pos} sur ${order.length}`, 'ready');
  }

  function dragLoop() {
    if (!dragState) return;
    const { card, clientY, offsetY } = dragState;

    const edge = CONFIG.EDGE_SCROLL;
    if (clientY < edge) window.scrollBy(0, -Math.ceil((edge - clientY) / 5));
    else if (clientY > window.innerHeight - edge) window.scrollBy(0, Math.ceil((clientY - (window.innerHeight - edge)) / 5));

    const boardRect = boardEl.getBoundingClientRect();
    const maxT = boardEl.offsetHeight - card.offsetHeight;
    const t = Math.max(0, Math.min(maxT, clientY - boardRect.top - offsetY));
    card.style.transform = `translateY(${t}px)`;

    const others = order.filter((o) => o.id !== dragState.id);
    let candidate = 0;
    let best = Infinity;
    let slotTop = 0;
    for (let i = 0; i <= others.length; i++) {
      const d = Math.abs(t - slotTop);
      if (d < best) { best = d; candidate = i; }
      if (i < others.length) slotTop += cardEls[others[i].id].offsetHeight + CONFIG.GAP;
    }

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
  // J'ai supprimé showResult/hideResult car la div #result n'existe pas. 
  // L'état est géré directement via setStatus()

  function longestOrderedSet(items) {
    const n = items.length;
    const len = new Array(n).fill(1);
    const prev = new Array(n).fill(-1);
    let end = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (items[j].year < items[i].year && len[j] + 1 > len[i]) {
          len[i] = len[j] + 1;
          prev[i] = j;
        }
      }
      if (len[i] > len[end]) end = i;
    }
    const ids = new Set();
    for (let k = end; k !== -1; k = prev[k]) ids.add(items[k].id);
    return ids;
  }

  function checkOrder() {
    if (solved || loading || !order.length) return;
    solved = true;
    validateBtn.disabled = true;

    const correct = order.slice().sort((a, b) => a.year - b.year);
    const inOrder = longestOrderedSet(order);

    let correctCount = 0;
    order.forEach((item) => {
      const ok = inOrder.has(item.id);
      if (ok) correctCount++;
      cardEls[item.id].classList.add(ok ? 'correct' : 'wrong');
      cardEls[item.id].classList.remove('settling', 'dragging');
      const link = cardEls[item.id].querySelector('a');
      if (link) link.tabIndex = 0;
    });

    boardEl.classList.add('solved');
    updateRail(railTicks.map((t) => parseFloat(t.style.top) || 0));

    const perfect = correctCount === CONFIG.CARDS;
    recordResult(perfect);

    // Affichage du résultat via le status
    if (perfect) {
      setStatus('Parfait ! L’ordre est exact.', 'win');
    } else {
      setStatus(`Presque ! ${correctCount} carte(s) sur ${CONFIG.CARDS} dans le bon ordre.`, 'lose');
    }

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
    do { items = shuffle(items); } while (isSorted(items));
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
