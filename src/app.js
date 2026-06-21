import * as PIXI from 'pixi.js';
import { install } from '@pixi/unsafe-eval';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { initChat } from './chat.js';

install(PIXI);
window.PIXI = PIXI;

const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const dock = document.getElementById('dock');
const dockHandle = document.getElementById('dock-handle');
const btnOpen = document.getElementById('btn-open');
const btnPin = document.getElementById('btn-pin');
const btnClickthrough = document.getElementById('btn-clickthrough');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

const api = window.live2dViewer;

let app = null;
let currentModel = null;
let clickThrough = true;
let passthroughSuspended = false;
let lastPointer = { x: 0, y: 0 };
let statusHideTimer = null;
let avatarPlacement = { x: 0, y: 0 };
let chatUi = null;

function setStatus(message, isError = false) {
  if (!message) {
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
    statusEl.classList.remove('error');
    return;
  }

  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
  statusEl.classList.toggle('error', isError);
}

function scheduleStatusHide() {
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
  }

  statusHideTimer = setTimeout(() => {
    if (currentModel) {
      statusEl.classList.add('hidden');
    }
  }, 3000);
}

function clampAvatarPlacement(x, y) {
  const pad = 48;
  return {
    x: Math.min(Math.max(pad, x), window.innerWidth - pad),
    y: Math.min(Math.max(pad, y), window.innerHeight - pad),
  };
}

function getAvatarLayout() {
  const centerX = avatarPlacement.x;
  const centerY = avatarPlacement.y;
  let halfW = 130;
  let halfH = 180;

  if (currentModel) {
    const internal = currentModel.internalModel;
    const scaledW = (internal?.width ?? 0) * currentModel.scale.x;
    const scaledH = (internal?.height ?? 0) * currentModel.scale.y;

    if (scaledW > 32 && scaledH > 32) {
      halfW = scaledW / 2;
      halfH = scaledH / 2;
    } else {
      const bounds = currentModel.getBounds();
      if (bounds.width > 32 && bounds.height > 32 && bounds.width < window.innerWidth * 0.8) {
        halfW = bounds.width / 2;
        halfH = bounds.height / 2;
      }
    }
  }

  return {
    centerX,
    centerY,
    halfW,
    halfH,
    headY: centerY - halfH,
    feetY: centerY + halfH,
  };
}

function updateDockForAvatar() {
  const layout = getAvatarLayout();
  const panel = document.getElementById('chat-panel');
  let dockTop = layout.feetY + 12;

  if (panel && !panel.classList.contains('hidden')) {
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.height > 0) {
      dockTop = panelRect.bottom + 8;
    }
  }

  dock.style.left = `${layout.centerX}px`;
  dock.style.top = `${dockTop}px`;
  dock.style.transform = 'translate(-50%, 0)';
  chatUi?.positionChatUi();
}

function applyAvatarPlacement(x, y) {
  avatarPlacement = clampAvatarPlacement(x, y);

  if (currentModel) {
    currentModel.position.set(avatarPlacement.x, avatarPlacement.y);
  }

  updateDockForAvatar();
}

function saveAvatarPlacement() {
  if (api?.setAvatarPlacement) {
    api.setAvatarPlacement(avatarPlacement);
  }
}

function initDockDrag() {
  let dragging = false;
  let dragStart = null;

  const onPointerMove = (event) => {
    if (!dragging || !dragStart) return;
    const dx = event.clientX - dragStart.pointerX;
    const dy = event.clientY - dragStart.pointerY;
    applyAvatarPlacement(dragStart.modelX + dx, dragStart.modelY + dy);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    dragStart = null;
    passthroughSuspended = false;
    dock.classList.remove('dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    saveAvatarPlacement();
    applyMousePassthrough(lastPointer.x, lastPointer.y);
  };

  dockHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    passthroughSuspended = true;
    api.setIgnoreMouse(false);
    dragStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      modelX: avatarPlacement.x,
      modelY: avatarPlacement.y,
    };
    dock.classList.add('dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });
}

async function restoreAvatarPlacement() {
  const saved = api?.getAvatarPlacement ? await api.getAvatarPlacement() : null;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    avatarPlacement = clampAvatarPlacement(saved.x, saved.y);
  } else {
    avatarPlacement = clampAvatarPlacement(
      window.innerWidth / 2,
      window.innerHeight * 0.58,
    );
  }
  updateDockForAvatar();
}

function ensureApp() {
  if (app) return app;

  app = new PIXI.Application({
    view: canvas,
    backgroundAlpha: 0,
    resizeTo: document.getElementById('stage-wrap'),
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  app.stage.interactive = true;
  app.stage.hitArea = app.screen;

  return app;
}

function scaleModelToFit(model) {
  const internal = model.internalModel;
  const rawW = internal?.width ?? model.getLocalBounds().width ?? 512;
  const rawH = internal?.height ?? model.getLocalBounds().height ?? 512;
  const modelW = Math.max(rawW, 64);
  const modelH = Math.max(rawH, 64);
  const margin = 0.32;
  const stageW = app.screen.width;
  const stageH = app.screen.height;
  const scale = Math.min(stageW / modelW, stageH / modelH) * margin;
  const clampedScale = Math.min(Math.max(scale, 0.1), 0.85);

  model.scale.set(clampedScale);
  model.anchor.set(0.5, 0.5);
}

function startIdleMotion(model) {
  const groups = model.internalModel?.motionManager?.groups ?? {};
  const idleGroup = Object.keys(groups).find((name) => name.toLowerCase() === 'idle');
  if (!idleGroup || !model.internalModel?.motionManager?.definitions?.[idleGroup]?.length) {
    return;
  }
  model.motion(idleGroup);
}

function wireModelInteractions(model) {
  model.interactive = true;
  model.buttonMode = true;

  model.on('hit', (hitAreas) => {
    const motionGroups = model.internalModel?.motionManager?.groups ?? {};
    const groupNames = Object.keys(motionGroups);

    for (const area of hitAreas) {
      const tapName = `Tap${area}`;
      const tapLower = `tap${area.toLowerCase()}`;
      const match = groupNames.find(
        (name) => name === tapName || name.toLowerCase() === tapLower || name.toLowerCase() === `tap_${area.toLowerCase()}`,
      );
      if (match) {
        model.motion(match);
        return;
      }
    }

    const fallback = groupNames.find((name) => name.toLowerCase().startsWith('tap'));
    if (fallback) {
      model.motion(fallback);
    }
  });
}

async function loadModel(modelUrl) {
  if (typeof Live2DCubismCore === 'undefined') {
    throw new Error(
      'Live2D Cubism Core is missing. Run "npm run setup" to download live2dcubismcore.min.js.',
    );
  }

  ensureApp();
  setStatus('Loading model…');

  if (currentModel) {
    app.stage.removeChild(currentModel);
    currentModel.destroy();
    currentModel = null;
  }

  const model = await Live2DModel.from(modelUrl, {
    autoInteract: true,
  });

  currentModel = model;
  app.stage.addChild(model);
  scaleModelToFit(model);
  applyAvatarPlacement(avatarPlacement.x, avatarPlacement.y);
  wireModelInteractions(model);
  startIdleMotion(model);
  requestAnimationFrame(() => updateDockForAvatar());

  document.body.classList.add('has-model');
  const label = decodeURIComponent(modelUrl.split(/[/\\]/).pop() || 'model');
  setStatus(`Loaded: ${label}`);
  scheduleStatusHide();
  await chatUi?.onModelLoaded?.();
}

async function openModelDialog() {
  try {
    const result = await api.openModelDialog();
    if (!result?.ok) {
      setStatus(result?.error || 'Failed to open model.', true);
      return;
    }
    if (!result.modelUrl) return;
    await loadModel(result.modelUrl);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Failed to open model.', true);
  }
}

function isPointerOverInteractiveUi(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return Boolean(el?.closest('#dock, #status, #chat-bubble, #chat-panel'));
}

function applyMousePassthrough(clientX, clientY) {
  lastPointer = { x: clientX, y: clientY };

  if (!clickThrough || passthroughSuspended) {
    api.setIgnoreMouse(false);
    return;
  }

  api.setIgnoreMouse(!isPointerOverInteractiveUi(clientX, clientY), true);
}

function initMousePassthrough() {
  window.addEventListener('mousemove', (event) => {
    applyMousePassthrough(event.clientX, event.clientY);
  });

  window.addEventListener('mouseleave', () => {
    if (clickThrough && !passthroughSuspended) {
      api.setIgnoreMouse(true, true);
    }
  });

  dock.addEventListener('mouseenter', () => {
    if (clickThrough && !passthroughSuspended) {
      api.setIgnoreMouse(false);
    }
  });

  for (const el of [document.getElementById('chat-bubble'), document.getElementById('chat-panel')]) {
    el?.addEventListener('mouseenter', () => {
      if (clickThrough && !passthroughSuspended) {
        api.setIgnoreMouse(false);
      }
    });
  }
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  document.body.classList.toggle('click-through', enabled);
  btnClickthrough.setAttribute('aria-pressed', String(enabled));

  if (!enabled) {
    api.setIgnoreMouse(false);
    return;
  }

  applyMousePassthrough(lastPointer.x, lastPointer.y);
}

btnOpen.addEventListener('click', openModelDialog);
btnMinimize.addEventListener('click', () => api.minimize());
btnClose.addEventListener('click', () => api.close());

btnPin.addEventListener('click', () => {
  const pressed = btnPin.getAttribute('aria-pressed') !== 'true';
  btnPin.setAttribute('aria-pressed', String(pressed));
  api.setAlwaysOnTop(pressed);
});

btnClickthrough.addEventListener('click', () => {
  setClickThrough(!clickThrough);
});

window.addEventListener('resize', () => {
  if (currentModel) {
    scaleModelToFit(currentModel);
    applyAvatarPlacement(avatarPlacement.x, avatarPlacement.y);
  } else {
    avatarPlacement = clampAvatarPlacement(avatarPlacement.x, avatarPlacement.y);
    updateDockForAvatar();
  }
});

async function init() {
  initDockDrag();
  initMousePassthrough();
  chatUi = initChat({
    api,
    getModel: () => currentModel,
    getAvatarLayout,
    onPlacementUpdate: () => applyMousePassthrough(lastPointer.x, lastPointer.y),
  });
  await restoreAvatarPlacement();
  ensureApp();
  setClickThrough(true);

  if (typeof Live2DCubismCore === 'undefined') {
    setStatus('Run "npm run setup" to download the Live2D Cubism Core runtime.', true);
    return;
  }

  if (api?.getStartupModel) {
    try {
      const result = await api.getStartupModel();
      if (!result?.ok) {
        setStatus(result.error || 'Default model is incomplete.', true);
        return;
      }
      if (result.modelUrl) {
        await loadModel(result.modelUrl);
        return;
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Failed to load default model.', true);
      return;
    }
  }

  setStatus('Open a model with the folder icon on the dock.');
  setTimeout(() => {
    if (!currentModel) statusEl.classList.add('hidden');
  }, 5000);
}

init();
