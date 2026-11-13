import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('webgl-container');
  const hudContainer = document.getElementById('hud-container');

  // Elementos do HUD
  const trackingBadge = document.getElementById('tracking-badge');
  const trackingText = document.getElementById('tracking-text');
  const startXRBtn = document.getElementById('btn-start-xr');
  const placeWallBtn = document.getElementById('btn-place-wall');
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

  // Estado da Aplicação
  const state = {
    globalOpacity: 0.85,
    isPeeking: false,
    isWallAnchored: false,
    scale: 1.0,
    offsetPos: { x: 0, y: 0, z: 0 },
    offsetRot: { x: 0, y: 0, z: 0 },
    layers: {
      'layer-wireframe': true,
      'layer-fill': true,
      'layer-details': true,
    },
  };

  // 1. Inicialização do Motor Three.js + WebXR 6DoF
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // 2. Mira Laser 3D (Reticle) que desliza na parede física durante o escaneamento
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.08, 32),
    new THREE.MeshBasicMaterial({ color: 0x00ff66, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // 3. Grupo Âncora da Parede (Cravado no mundo físico em metros reais)
  const wallAnchorGroup = new THREE.Group();
  wallAnchorGroup.position.set(0, 0, -1.5); // Posição inicial de preview a 1.5m
  scene.add(wallAnchorGroup);

  // Sub-grupo para ajustes finos de D-Pad, Escala e Rotação sem perder a âncora física
  const muralRigGroup = new THREE.Group();
  wallAnchorGroup.add(muralRigGroup);

  // Carregamento das 3 Camadas PNG em Alta Resolução
  const textureLoader = new THREE.TextureLoader();
  const layerMeshes = {};
  const planeGeo = new THREE.PlaneGeometry(1.2, 0.75); // 1.20m x 0.75m reais na parede (16:10)

  const layerConfigs = [
    { id: 'layer-wireframe', url: './assets/layer-wireframe.png', z: 0.002 },
    { id: 'layer-fill', url: './assets/layer-fill.png', z: 0.004 },
    { id: 'layer-details', url: './assets/layer-details.png', z: 0.006 },
  ];

  layerConfigs.forEach((cfg) => {
    const tex = textureLoader.load(cfg.url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: state.globalOpacity,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.z = cfg.z;
    muralRigGroup.add(mesh);
    layerMeshes[cfg.id] = mesh;
  });

  // Grade auxiliar discreta nas bordas do mural
  const borderEdges = new THREE.EdgesGeometry(planeGeo);
  const borderLine = new THREE.LineSegments(
    borderEdges,
    new THREE.LineBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.5 })
  );
  muralRigGroup.add(borderLine);

  // 4. Sincronização de Opacidade, Camadas e Transformações Locais
  function syncLayersVisuals() {
    const effectiveOpacity = state.isPeeking ? 0 : state.globalOpacity;
    Object.keys(layerMeshes).forEach((id) => {
      const mesh = layerMeshes[id];
      const isActive = state.layers[id];
      const targetOp = isActive ? effectiveOpacity : 0;
      mesh.visible = targetOp > 0.001;
      mesh.material.opacity = targetOp;
    });
    borderLine.visible = !state.isPeeking;
  }

  function applyLocalOffsets() {
    muralRigGroup.position.set(state.offsetPos.x, state.offsetPos.y, state.offsetPos.z);
    muralRigGroup.rotation.set(
      THREE.MathUtils.degToRad(state.offsetRot.x),
      THREE.MathUtils.degToRad(state.offsetRot.y),
      THREE.MathUtils.degToRad(state.offsetRot.z)
    );
    muralRigGroup.scale.set(state.scale, state.scale, 1);
    scaleDisplay.textContent = `${Math.round(state.scale * 100)}%`;
  }

  // 5. Sessão WebXR 6DoF (SLAM com Hit-Test Real)
  let hitTestSource = null;
  let hitTestSourceRequested = false;

  async function startWebXRSession() {
    if (!navigator.xr) {
      alert('Seu navegador atual bloqueia a API WebXR 6DoF. No Android, use o Google Chrome. No iPhone, abra este link pelo app gratuito "WebXR Viewer".');
      return;
    }

    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: hudContainer },
      });

      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(session);

      startXRBtn.style.display = 'none';
      trackingText.textContent = 'Aponte para a parede p/ escanear...';

      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
        startXRBtn.style.display = 'block';
      });
    } catch (err) {
      console.error('Erro ao iniciar WebXR:', err);
      alert('Não foi possível ativar o rastreamento 6DoF neste navegador: ' + err.message);
    }
  }

  startXRBtn.addEventListener('click', startWebXRSession);

  // 6. Botão "COLAR ARTE NA MIRA": Trava o plano nas coordenadas físicas da parede!
  placeWallBtn.addEventListener('click', () => {
    if (reticle.visible) {
      // Copia a posição exata que o laser encontrou na parede
      const hitPos = new THREE.Vector3();
      const hitQuat = new THREE.Quaternion();
      const hitScale = new THREE.Vector3();
      reticle.matrix.decompose(hitPos, hitQuat, hitScale);

      wallAnchorGroup.position.copy(hitPos);

      // Garante que o mural fique em pé (vertical) alinhado com a parede e olhando para o artista
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      const lookTarget = new THREE.Vector3(camPos.x, hitPos.y, camPos.z);
      wallAnchorGroup.lookAt(lookTarget);

      state.isWallAnchored = true;
      placeWallBtn.classList.add('anchored');
      placeWallBtn.textContent = '📌 REPOSICIONAR NA MIRA';

      trackingBadge.classList.remove('status-searching');
      trackingBadge.classList.add('status-locked');
      trackingText.textContent = '6DoF Cravado na Parede!';
    } else {
      // Se clicou fora do WebXR (modo preview), trava a 1.2m na frente da câmera atual
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3(0, 0, -1);
      camera.getWorldPosition(camPos);
      camDir.applyQuaternion(camera.quaternion);
      wallAnchorGroup.position.copy(camPos).add(camDir.multiplyScalar(1.2));
      wallAnchorGroup.lookAt(camPos);
    }
  });

  // 7. Loop de Renderização a 60fps (Atualiza o Hit-Test e mede a distância real em metros!)
  renderer.setAnimationLoop((timestamp, frame) => {
    if (frame) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const session = renderer.xr.getSession();

      if (!hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((viewerSpace) => {
          session.requestHitTestSource({ space: viewerSpace }).then((source) => {
            hitTestSource = source;
          });
        });
        hitTestSourceRequested = true;
      }

      if (hitTestSource) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);

          if (!state.isWallAnchored) {
            trackingText.textContent = 'Parede lida! Toque em COLAR ARTE';
          }
        } else {
          reticle.visible = false;
        }
      }

      // Calcula a distância física real (em metros) entre o celular e a parede!
      const camWorldPos = new THREE.Vector3();
      camera.getWorldPosition(camWorldPos);
      const distMeters = camWorldPos.distanceTo(wallAnchorGroup.position);
      coordsDisplay.textContent = `Distância Real: ${distMeters.toFixed(2)}m | Rot Y:${state.offsetRot.y}°`;
    }

    renderer.render(scene, camera);
  });

  // 8. Controles do HUD (D-Pad, Tilt, Escala, Opacidade e Peek)
  toggleDpadBtn.addEventListener('click', () => {
    const isHidden = dpadPanel.classList.toggle('hidden');
    toggleDpadBtn.classList.toggle('active', !isHidden);
  });

  dpadButtons.forEach((btn) => {
    const dx = parseFloat(btn.getAttribute('data-dx')) || 0;
    const dy = parseFloat(btn.getAttribute('data-dy')) || 0;
    btn.addEventListener('click', () => {
      state.offsetPos.x = +(state.offsetPos.x + dx).toFixed(3);
      state.offsetPos.y = +(state.offsetPos.y + dy).toFixed(3);
      applyLocalOffsets();
    });
  });

  tiltButtons.forEach((btn) => {
    const rx = parseFloat(btn.getAttribute('data-rx')) || 0;
    const ry = parseFloat(btn.getAttribute('data-ry')) || 0;
    const rz = parseFloat(btn.getAttribute('data-rz')) || 0;
    btn.addEventListener('click', () => {
      state.offsetRot.x += rx;
      state.offsetRot.y += ry;
      state.offsetRot.z += rz;
      applyLocalOffsets();
    });
  });

  resetPosBtn.add