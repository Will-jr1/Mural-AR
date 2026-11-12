const STORAGE_KEY = 'webar_mural_markerless_v1';

document.addEventListener('DOMContentLoaded', () => {
  const videoEl = document.getElementById('camera-feed');
  const stageEl = document.getElementById('projection-stage');
  const muralRig = document.getElementById('mural-rig');

  const layerIds = ['layer-wireframe', 'layer-fill', 'layer-details'];
  const layerElements = {};
  layerIds.forEach((id) => {
    layerElements[id] = document.getElementById(id);
  });

  const trackingBadge = document.getElementById('tracking-badge');
  const trackingText = document.getElementById('tracking-text');
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
  const freezeBtn = document.getElementById('btn-freeze');
  const peekBtn = document.getElementById('btn-peek');
  const layerButtons = document.querySelectorAll('.layer-btn');
  const scaleUpBtn = document.getElementById('btn-scale-up');
  const scaleDownBtn = document.getElementById('btn-scale-down');
  const scaleDisplay = document.getElementById('scale-display');

  const toggleDpadBtn = document.getElementById('btn-toggle-dpad');
  const dpadPanel = document.getElementById('dpad-panel');
  const coordsDisplay = document.getElementById('coords-display');
  const resetPosBtn = document.getElementById('btn-pos-reset');
  const rotLeftBtn = document.getElementById('btn-rot-left');
  const rotRightBtn = document.getElementById('btn-rot-right');
  const dpadButtons = document.querySelectorAll('.dpad-btn');

  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isLocked: false,
    x: 0,
    y: 0,
    scale: 1.0,
    rotation: 0,
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // 1. Inicializa a câmera traseira do celular (Sem precisar de marcador!)
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      videoEl.srcObject = stream;
    } catch (err) {
      console.error('Erro ao acessar câmera:', err);
      trackingText.textContent = 'Sem acesso à câmera';
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: state.x, y: state.y, scale: state.scale, rotation: state.rotation })
      );
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      state.x = Number(p.x) || 0;
      state.y = Number(p.y) || 0;
      state.scale = Number(p.scale) || 1.0;
      state.rotation = Number(p.rotation) || 0;
    } catch (e) {}
  }

  function applyTransform() {
    muralRig.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale}) rotate(${state.rotation}deg)`;
    scaleDisplay.textContent = `${Math.round(state.scale * 100)}%`;
    coordsDisplay.textContent = `X: ${Math.round(state.x)} | Y: ${Math.round(state.y)} | ${state.rotation}°`;
  }

  function syncLayers() {
    const effectiveOpacity = state.isPeeking ? 0 : state.globalOpacity;
    layerIds.forEach((id) => {
      const el = layerElements[id];
      if (!el) return;
      const active = state.layers[id];
      el.style.opacity = active ? effectiveOpacity : 0;
      el.style.visibility = active && effectiveOpacity > 0.001 ? 'visible' : 'hidden';
    });
  }

  // 2. Arrastar o lettering com o dedo diretamente na parede (quando não estiver travado)
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  stageEl.addEventListener('pointerdown', (e) => {
    if (state.isLocked) return;
    isDragging = true;
    startX = e.clientX - state.x;
    startY = e.clientY - state.y;
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging || state.isLocked) return;
    state.x = e.clientX - startX;
    state.y = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener('pointerup', () => {
    if (isDragging) {
      isDragging = false;
      saveState();
    }
  });

  // 3. Botão Travar na Tela (Lock)
  freezeBtn.addEventListener('click', () => {
    state.isLocked = !state.isLocked;
    freezeBtn.classList.toggle('frozen', state.isLocked);
    freezeBtn.textContent = state.isLocked ? 'DESTRAVAR AJUSTE' : 'TRAVAR NA TELA (LOCK)';

    trackingBadge.classList.toggle('status-locked', state.isLocked);
    trackingBadge.classList.toggle('status-unlocked', !state.isLocked);
    trackingText.textContent = state.isLocked ? 'Guia Travado (Locked)' : 'Modo Ajuste Livre';
  });

  // 4. D-Pad e Rotação
  toggleDpadBtn.addEventListener('click', () => {
    const isHidden = dpadPanel.classList.toggle('hidden');
    toggleDpadBtn.classList.toggle('active', !isHidden);
  });

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('click', () => {
      state.x += dx;
      state.y += dy;
      applyTransform();
      saveState();
    });
  });

  rotLeftBtn.addEventListener('click', () => {
    state.rotation -= 1;
    applyTransform();
    saveState();
  });

  rotRightBtn.addEventListener('click', () => {
    state.rotation += 1;
    applyTransform();
    saveState();
  });

  resetPosBtn.addEventListener('click', () => {
    state.x = 0;
    state.y = 0;
    state.scale = 1.0;
    state.rotation = 0;
    localStorage.removeItem(STORAGE_KEY);
    applyTransform();
  });

  // 5. Camadas, Opacidade, Peek e Escala
  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-layer');
      state.layers[id] = !state.layers[id];
      btn.classList.toggle('active', state.layers[id]);
      syncLayers();
    });
  });

  opacitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.globalOpacity = val / 100;
    opacityValue.textContent = `${val}%`;
    syncLayers();
  });

  const startPeek = (e) => {
    e.preventDefault();
    state.isPeeking = true;
    peekBtn.classList.add('peeking');
    syncLayers();
  };
  const endPeek = () => {
    if (!state.isPeeking) return;
    state.isPeeking = false;
    peekBtn.classList.remove('peeking');
    syncLayers();
  };
  peekBtn.addEventListener('pointerdown', startPeek);
  window.addEventListener('pointerup', endPeek);
  window.addEventListener('pointercancel', endPeek);

  function updateScale(delta) {
    state.scale = Math.min(4.0, Math.max(0.2, +(state.scale + delta).toFixed(2)));
    applyTransform();
    saveState();
  }
  scaleUpBtn.addEventListener('click', () => updateScale(0.05));
  scaleDownBtn.addEventListener('click', () => updateScale(-0.05));

  // Start!
  loadState();
  applyTransform();
  syncLayers();
  startCamera();
});