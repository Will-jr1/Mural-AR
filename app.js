const STORAGE_KEY = 'webar_mural_pro_3d_v1';

document.addEventListener('DOMContentLoaded', () => {
  const sceneEl = document.getElementById('main-scene');
  const videoEl = document.getElementById('camera-feed');
  const arCamera = document.getElementById('ar-camera');
  const wallAnchor = document.getElementById('wall-anchor');
  const muralRig = document.getElementById('mural-rig');
  const perspectiveGrid = document.getElementById('perspective-grid');

  const layerIds = ['layer-wireframe', 'layer-fill', 'layer-details'];
  const layerElements = {};
  layerIds.forEach((id) => {
    layerElements[id] = document.getElementById(id);
  });

  const hardLockBtn = document.getElementById('btn-hard-lock');
  const recenterWallBtn = document.getElementById('btn-recenter-wall');
  const startWebXRBtn = document.getElementById('btn-start-webxr');
  const toggleGridBtn = document.getElementById('btn-toggle-grid');
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
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
  const tiltButtons = document.querySelectorAll('.tilt-btn');

  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isHardLocked: false, // Quando true, mata 100% do drift do giroscópio!
    showGrid: true,
    scale: 1.0,
    baseScale: 1.5,
    pos: { x: 0, y: 0, z: 0 },
    rot: { x: 0, y: 0, z: 0 },
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // 1. Inicia câmera traseira com foco e resolução travados
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      videoEl.srcObject = stream;
    } catch (e) {
      console.error('Erro ao abrir câmera:', e);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ pos: state.pos, rot: state.rot, scale: state.scale })
      );
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.pos) state.pos = p.pos;
      if (p.rot) state.rot = p.rot;
      if (p.scale) state.scale = p.scale;
    } catch (e) {}
  }

  function applyTransform3D() {
    if (!muralRig || !muralRig.object3D) return;
    muralRig.setAttribute('position', `${state.pos.x} ${state.pos.y} ${state.pos.z}`);
    muralRig.setAttribute('rotation', `${state.rot.x} ${state.rot.y} ${state.rot.z}`);

    const s = +(state.baseScale * state.scale).toFixed(3);
    muralRig.setAttribute('scale', `${s} ${s} 1`);

    scaleDisplay.textContent = `${Math.round(state.scale * 100)}%`;
    coordsDisplay.textContent = `Y:${state.rot.y}° | X:${state.rot.x}° | Z:${state.rot.z}°`;
  }

  function syncLayers3D() {
    const effectiveOpacity = state.isPeeking ? 0 : state.globalOpacity;
    layerIds.forEach((id) => {
      const el = layerElements[id];
      if (!el || !el.object3D) return;
      const active = state.layers[id];
      const targetOpacity = active ? effectiveOpacity : 0;

      el.object3D.visible = targetOpacity > 0.001;
      const mesh = el.getObject3D('mesh');
      if (mesh && mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = targetOpacity;
        mesh.material.needsUpdate = true;
      }
    });

    if (perspectiveGrid && perspectiveGrid.object3D) {
      perspectiveGrid.object3D.visible = state.showGrid && !state.isPeeking;
    }
  }

  // 2. Centraliza a âncora na frente da câmera atual
  function pullWallAnchorToFront() {
    const camObj = arCamera.object3D;
    const distance = 2.2;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camObj.quaternion);
    const targetPos = new THREE.Vector3().copy(camObj.position).add(dir.multiplyScalar(distance));

    wallAnchor.object3D.position.copy(targetPos);
    wallAnchor.object3D.lookAt(camObj.position);
  }

  recenterWallBtn.addEventListener('click', async () => {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (e) {}
    }
    pullWallAnchorToFront();
  });

  // 3. BOTÃO HARD LOCK (Trava Absoluta na Tela — Zero Esbarrão / Zero Drift do Giroscópio)
  hardLockBtn.addEventListener('click', () => {
    state.isHardLocked = !state.isHardLocked;

    if (state.isHardLocked) {
      // Desliga a leitura do giroscópio para congelar a matriz 3D exatamente como está na tela!
      arCamera.setAttribute('look-controls', 'magicWindowTrackingEnabled', false);
      hardLockBtn.classList.add('locked');
      hardLockBtn.textContent = '🔒 FIXADO 100% (ZERO DRIFT) — TOQUE P/ SOLTAR';
    } else {
      // Religa o giroscópio e puxa a arte para a visão atual
      arCamera.setAttribute('look-controls', 'magicWindowTrackingEnabled', true);
      setTimeout(pullWallAnchorToFront, 60);
      hardLockBtn.classList.remove('locked');
      hardLockBtn.textContent = '🔓 GIROSCÓPIO LIVRE (TOQUE P/ TRAVAR FIXO)';
    }
  });

  // 4. Arrastar com 1 dedo direto na tela para mover o mural 3D (quando destravado)
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('pointerdown', (e) => {
    // Ignora se clicou nos botões do HUD
    if (e.target.closest('.hud-top') || e.target.closest('.hud-bottom')) return;
    if (state.isHardLocked) return;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging || state.isHardLocked) return;
    const dx = (e.clientX - lastX) * 0.0035;
    const dy = (lastY - e.clientY) * 0.0035;
    lastX = e.clientX;
    lastY = e.clientY;

    state.pos.x = +(state.pos.x + dx).toFixed(3);
    state.pos.y = +(state.pos.y + dy).toFixed(3);
    applyTransform3D();
  });

  window.addEventListener('pointerup', () => {
    if (isDragging) {
      isDragging = false;
      saveState();
    }
  });

  // 5. Verifica se o celular suporta WebXR Nativo 6DoF (ARCore no Android Chrome)
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (supported) {
        startWebXRBtn.style.display = 'block';
        startWebXRBtn.addEventListener('click', () => {
          sceneEl.enterAR();
        });
      }
    });
  }

  // 6. Controles de Perspectiva 3D (Tilt X, Y, Z) e D-Pad
  toggleDpadBtn.addEventListener('click', () => {
    const isHidden = dpadPanel.classList.toggle('hidden');
    toggleDpadBtn.classList.toggle('active', !isHidden);
  });

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('click', () => {
      state.pos.x = +(state.pos.x + dx).toFixed(3);
      state.pos.y = +(state.pos.y + dy).toFixed(3);
      applyTransform3D();
      saveState();
    });
  });

  tiltButtons.forEach((btn) => {
    const rx = parseFloat(btn.getAttribute('data-rx')) || 0;
    const ry = parseFloat(btn.getAttribute('data-ry')) || 0;
    const rz = parseFloat(btn.getAttribute('data-rz')) || 0;
    btn.addEventListener('click', () => {
      state.rot.x = +(state.rot.x + rx).toFixed(1);
      state.rot.y = +(state.rot.y + ry).toFixed(1);
      state.rot.z = +(state.rot.z + rz).toFixed(1);
      applyTransform3D();
      saveState();
    });
  });

  resetPosBtn.addEventListener('click', () => {
    state.pos = { x: 0, y: 0, z: 0 };
    state.rot = { x: 0, y: 0, z: 0 };
    state.scale = 1.0;
    localStorage.removeItem(STORAGE_KEY);
    applyTransform3D();
  });

  // 7. Grid, Camadas, Opacidade, Peek e Escala
  toggleGridBtn.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    toggleGridBtn.classList.toggle('active', state.showGrid);
    toggleGridBtn.textContent = state.showGrid ? 'GRID 3D: ON' : 'GRID 3D: OFF';
    syncLayers3D();
  });

  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-layer');
      state.layers[id] = !state.layers[id];
      btn.classList.toggle('active', state.layers[id]);
      syncLayers3D();
    });
  });

  opacitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.globalOpacity = val / 100;
    opacityValue.textContent = `${val}%`;
    syncLayers3D();
  });

  const startPeek = (e) => {
    e.preventDefault();
    state.isPeeking = true;
    peekBtn.classList.add('peeking');
    syncLayers3D();
  };
  const endPeek = () => {
    if (!state.isPeeking) return;
    state.isPeeking = false;
    peekBtn.classList.remove('peeking');
    syncLayers3D();
  };
  peekBtn.addEventListener('pointerdown', startPeek);
  window.addEventListener('pointerup', endPeek);
  window.addEventListener('pointercancel', endPeek);

  scaleUpBtn.addEventListener('click', () => {
    state.scale = Math.min(4.0, +(state.scale + 0.08).toFixed(2));
    applyTransform3D();
    saveState();
  });
  scaleDownBtn.addEventListener('click', () => {
    state.scale = Math.max(0.2, +(state.scale - 0.08).toFixed(2));
    applyTransform3D();
    saveState();
  });

  muralRig.addEventListener('loaded', () => {
    loadState();
    applyTransform3D();
    syncLayers3D();
  });

  startCamera();
});