(function() {
  const GAP = 12; // Espace entre les cartes
  
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

  // --- Utilitaires de nettoyage ---
  const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
  const RECURRING_KEYWORDS = ['élection', 'référendum', 'referendum', 'jeux olympiques', 'jeux paralympiques', 'championnat', 'coupe du monde', 'grand prix', 'festival de cannes', 'oscars', 'grammy', 'eurovision', 'sommet'];

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

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ============================================================
  // OPTIMISATION RÉSEAU
  // ============================================================
  async function getBatchPageviews(articleTitles) {
    if (!articleTitles || articleTitles.length === 0) return {};
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const start = `${lastMonth.getFullYear()}${String(lastMonth.getMonth() + 1).padStart(2, '0')}01`;
    const end = `${lastMonth.getFullYear()}${String(lastMonth.getMonth() + 1).padStart(2, '0')}28`;
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
          viewsMap[title] = (viewsMap[title] || 0) + item.views;
        });
      }
      return viewsMap;
    } catch (e) { return {}; }
  }

  async function fetchEventsForDate(mm, dd) {
    try {
      const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
      if (!res.ok) return [];
      return (await res.json()).events || [];
    } catch (e) { return []; }
  }

  async function prepareGameData(isHardMode = false) {
    const { mm, dd } = randomMonthDay();
    statusEl.textContent = `Chargement du ${dd}/${mm}...`;
    const events = await fetchEventsForDate(mm, dd);
    let usable = shuffle(events).filter(e => e.year && e.pages && e.pages[0] && e.pages[0].extract && !isRecurringEvent(e.text));

    if (usable.length === 0) return [];

    if (!isHardMode) {
      statusEl.textContent = 'Analyse de la popularité...';
      const titlesToCheck = usable.slice(0, 50).map(e => e.pages[0].title);
      const viewsMap = await getBatchPageviews(titlesToCheck);
      usable = usable.filter(e => (viewsMap[e.pages[0].title] || 0) >= 10000);
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

  // ============================================================
  // LOGIQUE DE RENDU DYNAMIQUE
  // ============================================================
  
  // Recalcule la position de toutes les cartes en fonction de leur hauteur réelle
  function layout(excludeId) {
    let currentY = 0;
    order.forEach((item) => {
      const el = cardEls[item._id];
      if (!el) return;

      // Si la carte est celle qu'on drag, on ne touche pas à son Y
      if (item._id !== excludeId) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = `translateY(${currentY}px)`;
      }
      
      // On ajoute la hauteur de la carte (offsetHeight) + l'espace
      currentY += el.offsetHeight + GAP;
    });

    // On ajuste la hauteur du conteneur principal
    boardEl.style.height = (currentY - GAP) + 'px';
    railEl.style.height = (currentY - GAP) + 'px';

    // On redessine le rail
    updateRail();
  }

  // Met à jour la ligne et les points
  function updateRail() {
    railEl.innerHTML = '';
    if (order.length === 0) return;

    let currentY = 0;
    const ticksData = [];

    // On calcule les positions des ticks
    order.forEach((item, i) => {
      const el = cardEls[item._id];
      if (!el) return;
      
      const cardHeight = el.offsetHeight;
      ticksData.push({ top: currentY + cardHeight / 2, index: i });
      currentY += cardHeight + GAP;
    });

    const totalHeight = currentY - GAP;

    // La ligne
    const line = document.createElement('div');
    line.className = 'rail-line';
    line.style.top = (ticksData[0].top) + 'px';
    line.style.height = (ticksData[ticksData.length - 1].top - ticksData[0].top) + 'px';
    railEl.appendChild(line);

    // Les points
    ticksData.forEach(t => {
      const tick = document.createElement('div');
      tick.className = 'tick';
      if (solved && resultEl.classList.contains('win')) tick.classList.add('revealed');
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

    // On laisse le navigateur calculer la hauteur des textes
    requestAnimationFrame(() => {
      layout(null);
      Object.values(cardEls).forEach(el => { el.style.transition = ''; });
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
        startIndex
      };

      function animate() {
        if (!dragState) return;

        const boardRect = boardEl.getBoundingClientRect();
        const pointerY = dragState.pointerY - boardRect.top;
        
        let t = pointerY - dragState.offsetY;
        
        // Limites (haut et bas)
        const totalHeight = boardEl.offsetHeight - dragState.card.offsetHeight;
        t = Math.max(0, Math.min(totalHeight, t));
        
        dragState.card.style.transform = `translateY(${t}px)`;

        // Détection du changement de place basé sur le centre de la carte
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
          layout(dragState.item._id); // On repositionne les autres cartes
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
          dragState.card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
          layout(null); // On le remet à sa place exacte
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
      } else {
        card.classList.add('wrong');
        allCorrect = false;
      }
    });

    // Mise à jour du rail pour allumer les points
    updateRail();
    const ticks = railEl.querySelectorAll('.tick');
    ticks.forEach(t => t.classList.add('revealed'));

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
    
    // Remonte en haut de page
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resultEl.className = 'result';
    validateBtn.disabled = true;
    newGameBtn.disabled = true;

    const isHardMode = modeSelect.value === 'hard';

    boardEl.innerHTML = '';
    boardEl.style.height = '0px';
    railEl.style.height = '0px';
    
    let events = await prepareGameData(isHardMode);

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

    const enriched = events.map((e, i) => {
      const articleTitle = e.pages[0].title;
      return {
        text: cleanArticleTitle(articleTitle), 
        description: cleanText(e.text),         
        year: e.year,
        _id: i + '-' + Date.now(),
      };
    });

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
