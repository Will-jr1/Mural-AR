const STORAGE_KEY = 'webar_mural_calibration_v2';

document.addEventListener('DOMContentLoaded', () => {
  const markerAnchor = document.getElementById('marker-anchor');
  const worldLockAnchor = document.getElementById('world-lock-anchor');
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
  const dpadButtons = document.querySelectorAll('.dpad-btn');

  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isFrozen: false,
    isTargetVisible: false,
    scaleMultiplier: 1.0,
    baseScale: { x: 1.5, y: 1.5, z: 1 },
    defaultPosition: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  function saveCalibrationToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ position: state.position, scaleMultiplier: state.scaleMultiplier })
      );
    } catch (e) {}
  }

  function loadCalibrationFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.position) {
        state.position.x = Number(parsed.position.x) || 0;
        state.position.y = Number(parsed.position.y) || 0;
      }
      if (parsed.scaleMultiplier) {
        state.scaleMultiplier = Number(parsed.scaleMultiplier) || 1.0;
      }
    } catch (e) {}
  }

  function applyTransformToRig() {
    if (!muralRig || !muralRig.object3D) return;
    muralRig.object3D.position.set(state.position.x, state.position.y, state.position.z);
    muralRig.setAttribute('position', `${state.position.x} ${state.position.y} ${state.position.z}`);
    if (coordsDisplay) {
      coordsDisplay.textContent = `X: ${state.position.x.toFixed(2)} | Y: ${state.position.y.toFixed(2)}`;
    }

    const sx = +(state.baseScale.x * state.scaleMultiplier).toFixed(3);
    const sy = +(state.baseScale.y * state.scaleMultiplier).toFixed(3);
    muralRig.object3D.scale.set(sx, sy, 1);
    muralRig.setAttribute('scale', `${sx} ${sy} 1`);
    if (scaleDisplay) {
      scaleDisplay.textContent = `${Math.round(state.scaleMultiplier * 100)}%`;
    }
  }

  if (muralRig) {
    muralRig.addEventListener('loaded', () => {
      loadCalibrationFromStorage();
      applyTransformToRig();
      syncLayersVisualState();
    });
  }

  function updateTrackingBadge() {
    if (!trackingBadge || !trackingText) return;
    trackingBadge.classList.remove('status-searching', 'status-locked', 'status-frozen');
    if (state.isFrozen) {
      trackingBadge.classList.add('status-frozen');
      trackingText.textContent = 'Guia Travado (Tela)';
    } else if (state.isTargetVisible) {
      trackingBadge.classList.add('status-locked');
      trackingText.textContent = 'Travado (Locked)';
    } else {
      trackingBadge.classList.add('status-searching');
      trackingText.textContent = 'Procurando alvo...';
    }
  }

  function syncLayersVisualState() {
    const effectiveOpacity = state.isPeeking ? 0 : state.globalOpacity;
    layerIds.forEach((id) => {
      const el = layerElements[id];
      if (!el || !el.object3D) return;
      const isLayerActive = state.layers[id];
      const targetOpacity = isLayerActive ? effectiveOpacity : 0;
      el.object3D.visible = targetOpacity > 0.001;

      const mesh = el.getObject3D('mesh');
      if (mesh && mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = targetOpacity;
        mesh.material.needsUpdate = true;
      } else {
        el.setAttribute('material', 'opacity', targetOpacity);
      }
    });
  }

  if (markerAnchor) {
    markerAnchor.addEventListener('targetFound', () => {
      state.isTargetVisible = true;
      updateTrackingBadge();
      syncLayersVisualState();
    });

    markerAnchor.addEventListener('targetLost', () => {
      state.isTargetVisible = false;
      updateTrackingBadge();
    });
  }

  // Botão Freeze / Modo Livre (Funciona com marcador ou sem marcador para teste rápido)
  if (freezeBtn) {
    freezeBtn.addEventListener('click', () => {
      state.isFrozen = !state.isFrozen;

      if (state.isFrozen) {
        if (state.isTargetVisible) {
          // Se o marcador está na câmera, trava na posição exata dele
          markerAnchor.object3D.updateMatrixWorld(true);
          worldLockAnchor.object3D.matrixAutoUpdate = false;
          worldLockAnchor.object3D.matrix.copy(markerAnchor.object3D.matrixWorld);
          worldLockAnchor.object3D.updateMatrixWorld(true);
        } else {
          // Se ainda não leu o marcador, projeta reto na frente da câmera (Modo Livre)
          worldLockAnchor.object3D.matrixAutoUpdate = true;
          worldLockAnchor.object3D.position.set(0, 0, -2.2);
          worldLockAnchor.object3D.rotation.set(0, 0, 0);
          worldLockAnchor.object3D.scale.set(1, 1, 1);
        }

        worldLockAnchor.object3D.add(muralRig.object3D);
        worldLockAnchor.object3D.visible = true;
        freezeBtn.classList.add('frozen');
        freezeBtn.textContent = 'VOLTAR P/ MARCADOR';
      } else {
        markerAnchor.object3D.add(muralRig.object3D);
        worldLockAnchor.object3D.visible = false;
        markerAnchor.object3D.visible = state.isTargetVisible;
        freezeBtn.classList.remove('frozen');
        freezeBtn.textContent = 'MODO LIVRE / FREEZE';
      }

      updateTrackingBadge();
      syncLayersVisualState();
    });
  }

  if (toggleDpadBtn && dpadPanel) {
    toggleDpadBtn.addEventListener('click', () => {
      const isHidden = dpadPanel.classList.toggle('hidden');
      toggleDpadBtn.classList.toggle('active', !isHidden);
    });
  }

  function nudgePosition(dx, dy) {
    state.position.x = +(state.position.x + dx).toFixed(3);
    state.position.y = +(state.position.y + dy).toFixed(3);
    applyTransformToRig();
    saveCalibrationToStorage();
  }

  let repeatTimer = null;
  let repeatInterval = null;
  function stopContinuousMove() {
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
  }

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stopContinuousMove();
      nudgePosition(dx, dy);
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => nudgePosition(dx, dy), 70);
      }, 300);
    });
  });

  window.addEventListener('pointerup', stopContinuousMove);
  window.addEventListener('pointercancel', stopContinuousMove);

  if (resetPosBtn) {
    resetPosBtn.addEventListener('click', () => {
      state.position = { ...state.defaultPosition };
      state.scaleMultiplier = 1.0;
      localStorage.removeItem(STORAGE_KEY);
      applyTransformToRig();
    });
  }

  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const layerId = btn.getAttribute('data-layer');
      state.layers[layerId] = !state.layers[layerId];
      btn.classList.toggle('active', state.layers[layerId]);
      syncLayersVisualState();
    });
  });

  if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
      const rawValue = parseInt(e.target.value, 10);
      state.globalOpacity = rawValue / 100;
      if (opacityValue) opacityValue.textContent = `${rawValue}%`;
      syncLayersVisualState();
    });
  }

  if (peekBtn) {
    const startPeek = (e) => {
      e.preventDefault();
      state.isPeeking = true;
      peekBtn.classList.add('peeking');
      syncLayersVisualState();
    };
    const endPeek = (e) => {
      if (!state.isPeeking) return;
      e.preventDefault();
      state.isPeeking = false;
      peekBtn.classList.remove('peeking');
      syncLayersVisualState();
    };
    peekBtn.addEventListener('pointerdown', startPeek);
    window.addEventListener('pointerup', endPeek);
    window.addEventListener('pointercancel', endPeek);
  }

  function updateRigScale(delta) {
    state.scaleMultiplier = Math.min(3.0, Math.max(0.25, +(state.scaleMultiplier + delta).toFixed(2)));
    applyTransformToRig();
    saveCalibrationToStorage();
  }

  if (scaleUpBtn) scaleUpBtn.addEventListener('click', () => updateRigScale(0.05));
  if (scaleDownBtn) scaleDownBtn.addEventListener('click', () => updateRigScale(-0.05));
});