(function() {
  const CARD_H = 90; 
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

  const MOCK_DATA = [
    { text: "Le premier pas sur la Lune par Neil Armstrong", year: 1969 },
    { text: "Chute du mur de Berlin", year: 1989 },
    { text: "Fin de la Seconde Guerre mondiale", year: 1945 },
    { text: "Premier vol motorisé des frères Wright", year: 1903 },
    { text: "Découverte de la pénicilline par Fleming", year: 1928 }
  ];

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

  // --- Logique ---
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function slotY(index) { return index * (CARD_H + GAP); }

  // --- Rail corrigé via JS ---
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
      title.textContent = item.text;
      
      const year = document.createElement('div');
      year.className = 'year';
      
      content.appendChild(title);
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

  // --- Validation Intelligente ---
  function checkOrder() {
    if (solved) return;
    solved = true;
    validateBtn.disabled = true;
    statusEl.textContent = 'Vérification...';

    // On trie une copie de l'ordre pour avoir la référence parfaite
    const correctOrder = order.slice().sort((a, b) => a.year - b.year);
    
    // On crée un dictionnaire des positions parfaites
    const correctPositions = {};
    correctOrder.forEach((item, index) => {
      correctPositions[item._id] = index;
    });

    let allCorrect = true;

    order.forEach((item, idx) => {
      const card = cardEls[item._id];
      const yearEl = card.querySelector('.year');
      
      yearEl.textContent = item.year;
      
      // On compare l'index actuel de la carte avec son index parfait
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
      // On compte combien de cartes sont bien placées
      const correctCount = order.filter((item, idx) => correctPositions[item._id] === idx).length;
      resultEl.textContent = `Presque ! ${correctCount} carte(s) sur 5 sont à la bonne place.`;
    }
    
    statusEl.textContent = 'Fini';
  }

  function newGame() {
    solved = false;
    dragState = null;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    resultEl.className = 'result';
    railEl.querySelectorAll('.tick').forEach(t => t.classList.remove('revealed'));
    validateBtn.disabled = false;
    statusEl.textContent = 'Prêt';

    const enriched = MOCK_DATA.map((e, i) => ({
      ...e,
      _id: i + '-' + Date.now(),
    }));

    order = shuffle(enriched);
    buildRail(order.length);
    render();
  }

  validateBtn.addEventListener('click', checkOrder);
  newGameBtn.addEventListener('click', newGame);

  newGame();
})();
