document.addEventListener('DOMContentLoaded', () => {
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

  const recenterWallBtn = document.getElementById('btn-recenter-wall');
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
    showGrid: true,
    scale: 1.0,
    baseScale: 1.5,
    pos: { x: 0, y: 0, z: 0 },
    rot: { x: 0, y: 0, z: 0 }, // Inclinação 3D (Pitch, Yaw, Roll) para perspectiva de parede
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // 1. Inicia câmera traseira
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      videoEl.srcObject = stream;
    } catch (e) {
      console.error('Erro câmera:', e);
    }
  }

  // 2. Aplica Posição, Escala e Perspectiva 3D (Rotação X, Y, Z) no A-Frame
  function applyTransform3D() {
    if (!muralRig || !muralRig.object3D) return;

    muralRig.setAttribute('position', `${state.pos.x} ${state.pos.y} ${state.pos.z}`);
    muralRig.setAttribute('rotation', `${state.rot.x} ${state.rot.y} ${state.rot.z}`);

    const s = +(state.baseScale * state.scale).toFixed(3);
    muralRig.setAttribute('scale', `${s} ${s} 1`);

    scaleDisplay.textContent = `${Math.round(state.scale * 100)}%`;
    coordsDisplay.textContent = `Perspectiva Y:${state.rot.y}° | X:${state.rot.x}°`;
  }

  // 3. Atualiza Opacidade das Camadas 3D
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

  // 4. Botão "CRAVAR NA PAREDE AQUI": Ativa Giroscópio no iOS e posiciona o mural 3D onde a câmera olha!
  recenterWallBtn.addEventListener('click', async () => {
    // No iPhone (iOS 13+), pede permissão explícita para ler o Giroscópio 3D
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (e) {
        console.warn('Permissão de giroscópio negada:', e);
      }
    }

    // Pega a direção atual para onde o celular está apontando no mundo 3D
    const camObj = arCamera.object3D;
    const distance = 2.2; // 2.2 metros na frente da lente
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camObj.quaternion);

    const targetPos = new THREE.Vector3().copy(camObj.position).add(dir.multiplyScalar(distance));

    // Coloca a âncora naquele ponto da parede e vira de frente para o usuário
    wallAnchor.object3D.position.copy(targetPos);
    wallAnchor.object3D.lookAt(camObj.position);

    // Feedback visual no botão
    recenterWallBtn.textContent = '✅ PAREDE TRAVADA (3D)';
    setTimeout(() => {
      recenterWallBtn.textContent = '🎯 CRAVAR NA PAREDE AQUI';
    }, 1500);
  });

  // 5. Controles de Perspectiva 3D (Inclinacão da Parede) e D-Pad
  toggleDpadBtn.addEventListener('click', () => {
    const isHidden = dpadPanel.classList.toggle('hidden');
    toggleDpadBtn.classList.toggle('active', !isHidden);
  });

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('click', () => {
      state.pos.x = +(state.pos.x + dx).toFixed(2);
      state.pos.y = +(state.pos.y + dy).toFixed(2);
      applyTransform3D();
    });
  });

  tiltButtons.forEach((btn) => {
    const rx = parseFloat(btn.getAttribute('data-rx')) || 0;
    const ry = parseFloat(btn.getAttribute('data-ry')) || 0;
    const rz = parseFloat(btn.getAttribute('data-rz')) || 0;
    btn.addEventListener('click', () => {
      state.rot.x += rx;
      state.rot.y += ry;
      state.rot.z += rz;
      applyTransform3D();
    });
  });

  resetPosBtn.addEventListener('click', () => {
    state.pos = { x: 0, y: 0, z: 0 };
    state.rot = { x: 0, y: 0, z: 0 };
    state.scale = 1.0;
    applyTransform3D();
  });

  // 6. Grid 3D Auxiliar (ajuda muito a alinhar as bordas com o teto e chão da parede)
  toggleGridBtn.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    toggleGridBtn.classList.toggle('active', state.showGrid);
    toggleGridBtn.textContent = state.showGrid ? 'GRID 3D: ON' : 'GRID 3D: OFF';
    syncLayers3D();
  });

  // 7. Camadas, Opacidade, Peek e Escala
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
    state.scale = Math.min(3.5, +(state.scale + 0.08).toFixed(2));
    applyTransform3D();
  });
  scaleDownBtn.addEventListener('click', () => {
    state.scale = Math.max(0.25, +(state.scale - 0.08).toFixed(2));
    applyTransform3D();
  });

  muralRig.addEventListener('loaded', () => {
    applyTransform3D();
    syncLayers3D();
  });

  startCamera();
});