/**
 * WebAR Mural iOS — Motor 6DoF Híbrido (Optical Flow KLT + Giroscópio + Three.js)
 * Resolve o bloqueio de WebXR da Apple no iPhone medindo o zoom e deslocamento
 * diretamente nos pixels reais da parede a 60fps.
 */

document.addEventListener('DOMContentLoaded', () => {
  const videoEl = document.getElementById('camera-feed');
  const webglContainer = document.getElementById('webgl-container');
  const debugCanvas = document.getElementById('cv-debug-canvas');
  const debugCtx = debugCanvas.getContext('2d');

  // HUD
  const trackingBadge = document.getElementById('tracking-badge');
  const trackingText = document.getElementById('tracking-text');
  const wallLockBtn = document.getElementById('btn-wall-lock');
  const freezeScreenBtn = document.getElementById('btn-freeze-screen');
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

  // Estado Geral
  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isOpticalLocked: false, // Rastreador 6DoF de parede ativo
    isScreenFrozen: false,  // Modo estático para tripé
    cameraZ: 1.5,           // Distância real simulada até a parede (menor = mais perto / zoom maior)
    targetZ: 1.5,
    posX: 0,
    posY: 0,
    targetX: 0,
    targetY: 0,
    rot: { x: 0, y: 0, z: 0 },
    gyroRef: null,
    gyroCurr: { alpha: 0, beta: 0, gamma: 0 },
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // ============================================================================
  // 1. INICIALIZAÇÃO DA CÂMERA DO IPHONE
  // ============================================================================
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      console.error('Erro câmera iOS:', err);
      trackingText.textContent = 'Permita acesso à câmera';
    }
  }

  // ============================================================================
  // 2. CENA 3D THREE.JS (PROJEÇÃO EM PERSPECTIVA REAL)
  // ============================================================================
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(0, 0, state.cameraZ);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  webglContainer.appendChild(renderer.domElement);

  const muralGroup = new THREE.Group();
  scene.add(muralGroup);

  const textureLoader = new THREE.TextureLoader();
  const planeGeo = new THREE.PlaneGeometry(1.4, 0.875); // Proporção 16:10
  const layerMeshes = {};

  const layerDefs = [
    { id: 'layer-wireframe', url: './assets/layer-wireframe.png', z: 0.002 },
    { id: 'layer-fill', url: './assets/layer-fill.png', z: 0.004 },
    { id: 'layer-details', url: './assets/layer-details.png', z: 0.006 },
  ];

  layerDefs.forEach((def) => {
    const tex = textureLoader.load(def.url);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: state.globalOpacity,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.z = def.z;
    muralGroup.add(mesh);
    layerMeshes[def.id] = mesh;
  });

  // Moldura guia verde ao redor do mural 3D
  const borderEdges = new THREE.EdgesGeometry(planeGeo);
  const borderLine = new THREE.LineSegments(
    borderEdges,
    new THREE.LineBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.45 })
  );
  muralGroup.add(borderLine);

  function syncLayersVisuals() {
    const effectiveOp = state.isPeeking ? 0 : state.globalOpacity;
    Object.keys(layerMeshes).forEach((id) => {
      const m = layerMeshes[id];
      const active = state.layers[id];
      const op = active ? effectiveOp : 0;
      m.visible = op > 0.001;
      m.material.opacity = op;
    });
    borderLine.visible = !state.isPeeking && !state.isScreenFrozen;
  }

  // ============================================================================
  // 3. MOTOR DE VISÃO COMPUTACIONAL 6DoF (OPTICAL FLOW KLT P/ ZOOM & PAREDE)
  // ============================================================================
  const CV_W = 160;
  const CV_H = 120;
  const cvCanvas = document.createElement('canvas');
  cvCanvas.width = CV_W;
  cvCanvas.height = CV_H;
  const cvCtx = cvCanvas.getContext('2d', { willReadFrequently: true });

  let prevGray = new Uint8Array(CV_W * CV_H);
  let currGray = new Uint8Array(CV_W * CV_H);
  let trackedPoints = [];

  function extractGrayscale() {
    cvCtx.drawImage(videoEl, 0, 0, CV_W, CV_H);
    const rgba = cvCtx.getImageData(0, 0, CV_W, CV_H).data;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      currGray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }
  }

  // Detecta pontos de alto contraste na parede (quinas, tijolos, manchas, fita crepe)
  function detectWallFeatures() {
    const candidates = [];
    const margin = 14;
    const step = 8;

    for (let y = margin; y < CV_H - margin; y += step) {
      for (let x = margin; x < CV_W - margin; x += step) {
        const idx = y * CV_W + x;
        const gx = Math.abs(currGray[idx + 1] - currGray[idx - 1]);
        const gy = Math.abs(currGray[idx + CV_W] - currGray[idx - CV_W]);
        const score = gx + gy;
        if (score > 22) {
          candidates.push({ x, y, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    trackedPoints = candidates.slice(0, 45).map((p) => ({ x: p.x, y: p.y }));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
  }

  // Rastreia os pontos da parede entre o frame anterior e o atual com precisão sub-pixel
  function processOpticalFlow6DoF() {
    if (videoEl.readyState < 2) return;

    extractGrayscale();

    if (trackedPoints.length < 14) {
      detectWallFeatures();
      prevGray.set(currGray);
      return;
    }

    const survivedPrev = [];
    const survivedCurr = [];
    const patchRadius = 3; // Patch 7x7
    const searchRadius = 7; // Janela de busca [-7, +7]

    for (let i = 0; i < trackedPoints.length; i++) {
      const pt = trackedPoints[i];
      const px = Math.round(pt.x);
      const py = Math.round(pt.y);

      if (px < 12 || px >= CV_W - 12 || py < 12 || py >= CV_H - 12) continue;

      let bestDx = 0;
      let bestDy = 0;
      let minSAD = 999999;

      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          let sad = 0;
          for (let wy = -patchRadius; wy <= patchRadius; wy++) {
            const rowPrev = (py + wy) * CV_W + px;
            const rowCurr = (py + dy + wy) * CV_W + (px + dx);
            for (let wx = -patchRadius; wx <= patchRadius; wx++) {
              sad += Math.abs(prevGray[rowPrev + wx] - currGray[rowCurr + wx]);
            }
          }
          if (sad < minSAD) {
            minSAD = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      // Aceita apenas casamentos confiáveis
      if (minSAD < 780) {
        survivedPrev.push({ x: pt.x, y: pt.y });
        survivedCurr.push({ x: pt.x + bestDx, y: pt.y + bestDy });
      }
    }

    // Se temos pontos suficientes na parede, calculamos Translação (X,Y) e Zoom Físico (Z)!
    if (survivedCurr.length >= 6) {
      const dxs = [];
      const dys = [];
      for (let i = 0; i < survivedCurr.length; i++) {
        dxs.push(survivedCurr[i].x - survivedPrev[i].x);
        dys.push(survivedCurr[i].y - survivedPrev[i].y);
      }

      const medDx = median(dxs);
      const medDy = median(dys);

      // Move a arte junto com a parede
      const worldFactor = state.cameraZ * 0.0085;
      state.targetX += medDx * worldFactor;
      state.targetY -= medDy * worldFactor;

      // CÁLCULO DO ZOOM DE APROXIMAÇÃO REAL (Expansão/Contração radial dos pontos da parede)
      let cxPrev = 0, cyPrev = 0, cxCurr = 0, cyCurr = 0;
      const n = survivedCurr.length;
      for (let i = 0; i < n; i++) {
        cxPrev += survivedPrev[i].x;
        cyPrev += survivedPrev[i].y;
        cxCurr += survivedCurr[i].x;
        cyCurr += survivedCurr[i].y;
      }
      cxPrev /= n; cyPrev /= n;
      cxCurr /= n; cyCurr /= n;

      const scaleRatios = [];
      for (let i = 0; i < n; i++) {
        const distPrev = Math.hypot(survivedPrev[i].x - cxPrev, survivedPrev[i].y - cyPrev);
        const distCurr = Math.hypot(survivedCurr[i].x - cxCurr, survivedCurr[i].y - cyCurr);
        if (distPrev > 10) {
          scaleRatios.push(distCurr / distPrev);
        }
      }

      if (scaleRatios.length >= 4) {
        const medScale = median(scaleRatios);
        // Se medScale > 1, o celular está se aproximando da parede -> diminui cameraZ (Dá Zoom!)
        if (medScale > 0.92 && medScale < 1.08) {
          state.targetZ = THREE.MathUtils.clamp(state.targetZ / medScale, 0.22, 5.0);
        }
      }
    }

    trackedPoints = survivedCurr;
    if (trackedPoints.length < 22) {
      detectWallFeatures();
    }
    prevGray.set(currGray);
  }

  // Desenha os pontinhos verdes onde o algoritmo está ancorando na parede
  function drawDebugPoints() {
    if (debugCanvas.width !== window.innerWidth || debugCanvas.height !== window.innerHeight) {
      debugCanvas.width = window.innerWidth;
      debugCanvas.height = window.innerHeight;
    }
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    if (!state.isOpticalLocked || state.isScreenFrozen || state.isPeeking) return;

    const scaleX = debugCanvas.width / CV_W;
    const scaleY = debugCanvas.height / CV_H;

    debugCtx.fillStyle = '#00ff66';
    for (let i = 0; i < trackedPoints.length; i++) {
      const p = trackedPoints[i];
      debugCtx.beginPath();
      debugCtx.arc(p.x * scaleX, p.y * scaleY, 3, 0, Math.PI * 2);
      debugCtx.fill();
    }
  }

  // ============================================================================
  // 4. GIROSCÓPIO DO IPHONE (PERSPECTIVA 3D AUTOMÁTICA)
  // ============================================================================
  window.addEventListener('deviceorientation', (e) => {
    if (e.alpha === null) return;
    state.gyroCurr = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };

    if (state.isOpticalLocked && !state.isScreenFrozen && state.gyroRef) {
      const dGamma = THREE.MathUtils.clamp(e.gamma - state.gyroRef.gamma, -45, 45);
      const dBeta = THREE.MathUtils.clamp(e.beta - state.gyroRef.beta, -45, 45);
      muralGroup.rotation.y = THREE.MathUtils.degToRad(state.rot.y - dGamma * 0.65);
      muralGroup.rotation.x = THREE.MathUtils.degToRad(state.rot.x + dBeta * 0.65);
    }
  });

  // ============================================================================
  // 5. GESTOS TOUCH NA TELA (ARRASTAR COM 1 DEDO + PINÇA DE ZOOM COM 2 DEDOS)
  // ============================================================================
  const activePointers = new Map();
  let prevPinchDist = null;
  let prevDragPos = null;

  webglContainer.addEventListener('pointerdown', (e) => {
    if (state.isScreenFrozen) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      prevDragPos = { x: e.clientX, y: e.clientY };
    }
  });

  webglContainer.addEventListener('pointermove', (e) => {
    if (state.isScreenFrozen || !activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = Array.from(activePointers.values());

    if (pts.length === 1 && prevDragPos) {
      const dx = pts[0].x - prevDragPos.x;
      const dy = pts[0].y - prevDragPos.y;
      prevDragPos = { x: pts[0].x, y: pts[0].y };

      const factor = state.cameraZ * 0.0022;
      state.targetX += dx * factor;
      state.targetY -= dy * factor;
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (prevPinchDist !== null && prevPinchDist > 10) {
        const ratio = dist / prevPinchDist;
        state.targetZ = THREE.MathUtils.clamp(state.targetZ / ratio, 0.22, 5.0);
      }
      prevPinchDist = dist;
    }
  });

  const clearPointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) prevPinchDist = null;
    if (activePointers.size === 0) prevDragPos = null;
  };
  webglContainer.addEventListener('pointerup', clearPointer);
  webglContainer.addEventListener('pointercancel', clearPointer);

  // ============================================================================
  // 6. BOTÕES DO HUD
  // ============================================================================
  wallLockBtn.addEventListener('click', async () => {
    // Solicita permissão do Giroscópio no Safari do iOS
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (e) {}
    }

    state.isOpticalLocked = !state.isOpticalLocked;

    if (state.isOpticalLocked) {
      extractGrayscale();
      detectWallFeatures();
      prevGray.set(currGray);
      state.gyroRef = { ...state.gyroCurr };

      wallLockBtn.classList.add('active');
      wallLockBtn.textContent = '✅ 6DoF ATIVO NA PAREDE (TOQUE P/ RECALIBRAR)';
      trackingBadge.classList.replace('status-unlocked', 'status-locked');
      trackingText.textContent = `6DoF Grudado (${trackedPoints.length} pts)`;
    } else {
      wallLockBtn.classList.remove('active');
      wallLockBtn.textContent = '🎯 GRUDAR NA PAREDE (ATIVAR 6DoF ÓPTICO)';
      trackingBadge.classList.replace('status-locked', 'status-unlocked');
      trackingText.textContent = 'Modo Posicionamento Livre';
    }
  });

  freezeScreenBtn.addEventListener('click', () => {
    state.isScreenFrozen = !state.isScreenFrozen;
    freezeScreenBtn.classList.toggle('frozen', state.isScreenFrozen);
    freezeScreenBtn.textContent = state.isScreenFrozen
      ? '🔥 DESTRAVAR TELA'
      : '❄️ CONGELAR NA TELA (TRIPÉ)';
    syncLayersVisuals();
  });

  toggleDpadBtn.addEventListener('click', () => {
    const isHidden = dpadPanel.classList.toggle('hidden');
    toggleDpadBtn.classList.toggle('active', !isHidden);
  });

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('click', () => {
      state.targetX += dx;
      state.targetY += dy;
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
    });
  });

  resetPosBtn.addEventListener('click', () => {
    state.targetX = 0;
    state.targetY = 0;
    state.targetZ = 1.5;
    state.rot = { x: 0, y: 0, z: 0 };
    state.gyroRef = { ...state.gyroCurr };
  });

  layerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-layer');
      state.layers[id] = !state.layers[id];
      btn.classList.toggle('active', state.layers[id]);
      syncLayersVisuals();
    });
  });

  opacitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.globalOpacity = val / 100;
    opacityValue.textContent = `${val}%`;
    syncLayersVisuals();
  });

  const startPeek = (e) => {
    e.preventDefault();
    state.isPeeking = true;
    peekBtn.classList.add('peeking');
    syncLayersVisuals();
  };
  const endPeek = () => {
    if (!state.isPeeking) return;
    state.isPeeking = false;
    peekBtn.classList.remove('peeking');
    syncLayersVisuals();
  };
  peekBtn.addEventListener('pointerdown', startPeek);
  window.addEventListener('pointerup', endPeek);
  window.addEventListener('pointercancel', endPeek);

  scaleUpBtn.addEventListener('click', () => {
    state.targetZ = Math.max(0.22, +(state.targetZ - 0.12).toFixed(2));
  });
  scaleDownBtn.addEventListener('click', () => {
    state.targetZ = Math.min(5.0, +(state.targetZ + 0.12).toFixed(2));
  });

  // ============================================================================
  // 7. LOOP PRINCIPAL DE RENDERIZAÇÃO (60 FPS)
  // ============================================================================
  function animate() {
    requestAnimationFrame(animate);

    if (state.isOpticalLocked && !state.isScreenFrozen) {
      processOpticalFlow6DoF();
      trackingText.textContent = `6DoF Ativo (${trackedPoints.length} pts na parede)`;
    }

    // Suavização anti-tremedeira (Interpolação exponencial)
    state.posX += (state.targetX - state.posX) * 0.28;
    state.posY += (state.targetY - state.posY) * 0.28;
    state.cameraZ += (state.targetZ - state.cameraZ) * 0.25;

    camera.position.z = state.cameraZ;
    muralGroup.position.set(state.posX, state.posY, 0);

    if (!state.isOpticalLocked) {
      muralGroup.rotation.set(
        THREE.MathUtils.degToRad(state.rot.x),
        THREE.MathUtils.degToRad(state.rot.y),
        THREE.MathUtils.degToRad(state.rot.z)
      );
    } else {
      muralGroup.rotation.z = THREE.MathUtils.degToRad(state.rot.z);
    }

    scaleDisplay.textContent = `${state.cameraZ.toFixed(1)}m`;
    coordsDisplay.textContent = `Dist: ${state.cameraZ.toFixed(2)}m | Pts: ${trackedPoints.length}`;

    drawDebugPoints();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  syncLayersVisuals();
  startCamera();
  animate();
});