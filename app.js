/**
 * WebAR Mural Guide - Core Controller (Com suporte a Freeze Frame 3D)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Referências da Cena A-Frame
  const markerAnchor = document.getElementById('marker-anchor');
  const worldLockAnchor = document.getElementById('world-lock-anchor');
  const muralRig = document.getElementById('mural-rig');

  const layerIds = ['layer-wireframe', 'layer-fill', 'layer-details'];
  const layerElements = {};

  layerIds.forEach((id) => {
    layerElements[id] = document.getElementById(id);
  });

  // Referências do HUD
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

  // Estado da Aplicação
  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isFrozen: false,
    isTargetVisible: false,
    hasLockedOnce: false,
    scaleMultiplier: 1.0,
    baseScale: { x: 2.5, y: 2.5, z: 1 },
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // Inicializa a escala base a partir do HTML
  muralRig.addEventListener('loaded', () => {
    const initialScale = muralRig.getAttribute('scale');
    if (initialScale) {
      state.baseScale = {
        x: parseFloat(initialScale.x) || 2.5,
        y: parseFloat(initialScale.y) || 2.5,
        z: 1,
      };
    }
    syncLayersVisualState();
  });

  /**
   * Atualiza o badge de status no topo conforme combinação de Tracking e Freeze
   */
  function updateTrackingBadge() {
    trackingBadge.classList.remove('status-searching', 'status-locked', 'status-frozen');

    if (state.isFrozen) {
      trackingBadge.classList.add('status-frozen');
      trackingText.textContent = 'Guia Travado (Freeze)';
    } else if (state.isTargetVisible) {
      trackingBadge.classList.add('status-locked');
      trackingText.textContent = 'Travado (Locked)';
    } else {
      trackingBadge.classList.add('status-searching');
      trackingText.textContent = 'Procurando alvo...';
    }
  }

  /**
   * Atualiza visibilidade e opacidade diretamente nas malhas Three.js
   */
  function syncLayersVisualState() {
    const effectiveOpacity = state.isPeeking ? 0 : state.globalOpacity;

    layerIds.forEach((id) => {
      const el = layerElements[id];
      if (!el) return;

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

  // 1. Eventos de Rastreamento do Marcador (MindAR)
  markerAnchor.addEventListener('targetFound', () => {
    state.isTargetVisible = true;
    state.hasLockedOnce = true;
    freezeBtn.disabled = false; // Habilita o Freeze após a primeira leitura válida
    updateTrackingBadge();
    syncLayersVisualState();
  });

  markerAnchor.addEventListener('targetLost', () => {
    state.isTargetVisible = false;
    updateTrackingBadge();
  });

  // 2. Lógica de Freeze Frame (Desacoplamento de Matriz 4x4)
  freezeBtn.addEventListener('click', () => {
    if (!state.hasLockedOnce && !state.isFrozen) return;

    state.isFrozen = !state.isFrozen;

    if (state.isFrozen) {
      // Força a atualização da matriz do marcador e copia para a âncora de mundo
      markerAnchor.object3D.updateMatrixWorld(true);
      worldLockAnchor.object3D.matrixAutoUpdate = false;
      worldLockAnchor.object3D.matrix.copy(markerAnchor.object3D.matrixWorld);
      worldLockAnchor.object3D.updateMatrixWorld(true);

      // Reparenta o rig do mural para a âncora que nunca é ocultada pelo MindAR
      worldLockAnchor.object3D.add(muralRig.object3D);
      worldLockAnchor.object3D.visible = true;

      freezeBtn.classList.add('frozen');
      freezeBtn.textContent = 'DESTRAVAR GUIA';
    } else {
      // Devolve o rig do mural para dentro da âncora rastreada pelo MindAR
      markerAnchor.object3D.add(muralRig.object3D);
      worldLockAnchor.object3D.visible = false;
      markerAnchor.object3D.visible = state.isTargetVisible;

      freezeBtn.classList.remove('frozen');
      freezeBtn.textContent = 'TRAVAR GUIA (FREEZE)';
    }

    updateTrackingBadge();
    syncLayersVisualState();
  });

  // 3. Toggle Individual de Camadas
  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const layerId = btn.getAttribute('data-layer');
      state.layers[layerId] = !state.layers[layerId];
      btn.classList.toggle('active', state.layers[layerId]);
      syncLayersVisualState();
    });
  });

  // 4. Controle de Opacidade Global
  opacitySlider.addEventListener('input', (e) => {
    const rawValue = parseInt(e.target.value, 10);
    state.globalOpacity = rawValue / 100;
    opacityValue.textContent = `${rawValue}%`;
    syncLayersVisualState();
  });

  // 5. Botão "Piscar / Ocultar Guia" (Hold-to-Hide)
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

  // 6. Ajuste Fino de Escala em Tempo Real (+ / -)
  const SCALE_STEP = 0.05;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3.0;

  function updateRigScale(delta) {
    const nextMultiplier = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, +(state.scaleMultiplier + delta).toFixed(2))
    );
    state.scaleMultiplier = nextMultiplier;

    const newX = (state.baseScale.x * state.scaleMultiplier).toFixed(3);
    const newY = (state.baseScale.y * state.scaleMultiplier).toFixed(3);

    muralRig.setAttribute('scale', `${newX} ${newY} 1`);
    scaleDisplay.textContent = `${Math.round(state.scaleMultiplier * 100)}%`;
  }

  scaleUpBtn.addEventListener('click', () => updateRigScale(SCALE_STEP));
  scaleDownBtn.addEventListener('click', () => updateRigScale(-SCALE_STEP));
});