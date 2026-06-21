import {
  BUNNY_PERSONA,
  buildChatMessages,
  buildInitiativeRequest,
  parseInitiativeReply,
} from './persona.js';
import { getLocalTimeContext } from './time-context.js';
import { createVoice } from './voice.js';

const MOUTH_OPEN_PARAMS = ['ParamMouthOpenY', 'ParamMouthForm'];

export function initChat({ api, getModel, getAvatarLayout, onPlacementUpdate }) {
  const bubble = document.getElementById('chat-bubble');
  const bubbleText = document.getElementById('chat-bubble-text');
  const panel = document.getElementById('chat-panel');
  const log = document.getElementById('chat-log');
  const input = document.getElementById('chat-input');
  const btnSend = document.getElementById('chat-send');
  const btnToggle = document.getElementById('btn-chat');
  const btnClear = document.getElementById('chat-clear');
  const btnMic = document.getElementById('btn-mic');
  const btnVoice = document.getElementById('btn-voice');
  const chatMic = document.getElementById('chat-mic');

  let history = [];
  let panelOpen = false;
  let speakingTimer = null;
  let busy = false;
  let initiativeGeneration = 0;
  let cachedScreenContext = null;
  let cachedScreenContextAt = 0;
  let cachedMediaContext = null;
  let cachedMediaContextAt = 0;

  function setBubble(text) {
    bubbleText.textContent = text;
    bubble.classList.toggle('hidden', !text);
    positionChatUi();
  }

  function positionChatUi() {
    const model = getModel();
    if (!model || !getAvatarLayout) return;

    const layout = getAvatarLayout();
    bubble.style.left = `${layout.centerX}px`;
    bubble.style.top = `${layout.headY - 16}px`;
    bubble.style.transform = 'translate(-50%, -100%)';

    panel.style.left = `${layout.centerX}px`;
    panel.style.top = `${layout.feetY + 4}px`;
    panel.style.transform = 'translate(-50%, -100%)';

    onPlacementUpdate?.();
  }

  function appendLog(role, text) {
    const item = document.createElement('div');
    item.className = `chat-log-item chat-log-${role}`;
    item.textContent = role === 'user' ? `You: ${text}` : `${BUNNY_PERSONA.name}: ${text}`;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  function setModelParameter(model, ids, value) {
    const core = model?.internalModel?.coreModel;
    if (!core) return;

    for (const id of ids) {
      const index = core.getParameterIndex?.(id);
      if (index != null && index >= 0) {
        core.setParameterValueByIndex(index, value);
        return;
      }
    }
  }

  function startSpeakingAnimation() {
    const model = getModel();
    if (!model) return;

    if (speakingTimer) clearInterval(speakingTimer);
    let t = 0;
    speakingTimer = setInterval(() => {
      t += 0.25;
      const open = (Math.sin(t * 8) + 1) * 0.35;
      setModelParameter(model, MOUTH_OPEN_PARAMS, open);
    }, 50);
  }

  function stopSpeakingAnimation() {
    if (speakingTimer) {
      clearInterval(speakingTimer);
      speakingTimer = null;
    }
    setModelParameter(getModel(), MOUTH_OPEN_PARAMS, 0);
  }

  function setMicUi(active) {
    btnMic?.setAttribute('aria-pressed', String(active));
    btnMic?.classList.toggle('dock-btn-active', active);
    chatMic?.setAttribute('aria-pressed', String(active));
    input.placeholder = active ? 'Listening…' : 'Talk to me…';
  }

  const voice = createVoice({
    api,
    onTranscript: (text, error) => {
      if (error) {
        setBubble(error);
        return;
      }
      if (text) {
        input.value = text;
        sendUserMessage(text);
      }
    },
    onRecordingChange: (active) => {
      setMicUi(active);
    },
    onTranscribingChange: (active) => {
      if (active) setBubble('Transcribing…');
      setInputEnabled(!active && !busy);
    },
    onSpeakStart: startSpeakingAnimation,
    onSpeakEnd: stopSpeakingAnimation,
    onSpeakError: (message) => setBubble(`Voice error: ${message}`),
  });

  async function speakReply(text) {
    stopSpeakingAnimation();
    await voice.speak(text);
  }

  function setPanelOpen(open) {
    panelOpen = open;
    panel.classList.toggle('hidden', !open);
    btnToggle.setAttribute('aria-pressed', String(open));
    positionChatUi();
    requestAnimationFrame(() => {
      onPlacementUpdate?.();
    });
    if (open) input.focus();
  }

  function setInputEnabled(enabled) {
    input.disabled = !enabled;
    btnSend.disabled = !enabled;
    btnMic.disabled = !enabled;
    chatMic.disabled = !enabled;
  }

  function getTimeContext() {
    return getLocalTimeContext();
  }

  async function getScreenContextCached(maxAgeMs = 4000) {
    const now = Date.now();
    if (cachedScreenContext && now - cachedScreenContextAt < maxAgeMs) {
      return cachedScreenContext;
    }

    if (!api?.getScreenContext) {
      return { ok: false, activeWindow: '', otherWindows: [] };
    }

    try {
      cachedScreenContext = await api.getScreenContext();
      cachedScreenContextAt = now;
      return cachedScreenContext;
    } catch {
      return { ok: false, activeWindow: '', otherWindows: [] };
    }
  }

  async function getMediaContextCached(maxAgeMs = 4000) {
    const now = Date.now();
    if (cachedMediaContext && now - cachedMediaContextAt < maxAgeMs) {
      return cachedMediaContext;
    }

    if (!api?.getMediaContext) {
      return { ok: false, playing: false, title: '', artist: '', album: '', app: '' };
    }

    try {
      cachedMediaContext = await api.getMediaContext();
      cachedMediaContextAt = now;
      return cachedMediaContext;
    } catch {
      return { ok: false, playing: false, title: '', artist: '', album: '', app: '' };
    }
  }

  async function getPromptContext() {
    const [timeContext, screenContext, mediaContext] = await Promise.all([
      Promise.resolve(getTimeContext()),
      getScreenContextCached(),
      getMediaContextCached(),
    ]);

    return { timeContext, screenContext, mediaContext };
  }

  function canOfferInitiative() {
    if (busy || !api?.ollamaChat) return false;
    if (voice.isRecording() || voice.isTranscribing() || voice.isSpeaking()) return false;
    return true;
  }

  async function offerInitiative() {
    if (!canOfferInitiative()) return;

    const generation = initiativeGeneration;

    try {
      const { timeContext, screenContext, mediaContext } = await getPromptContext();
      const { messages, format } = buildInitiativeRequest(history, timeContext, screenContext, mediaContext);
      const result = await api.ollamaChat(messages, { format });

      if (generation !== initiativeGeneration || !result?.ok) return;

      const line = parseInitiativeReply(result.content);
      if (!line) return;

      history.push({ role: 'assistant', content: line });
      if (history.length > 20) {
        history = history.slice(-20);
      }

      appendLog('assistant', line);
      setBubble(line);
      await speakReply(line);

      if (generation === initiativeGeneration && canOfferInitiative()) {
        await offerInitiative();
      }
    } catch (error) {
      console.error('Initiative chat failed:', error);
    }
  }

  async function sendUserMessage(text) {
    const message = text.trim();
    if (!message || !api?.ollamaChat || busy) return;

    initiativeGeneration += 1;
    voice.cancelPushToTalk();
    voice.stopSpeaking();
    busy = true;
    setInputEnabled(false);
    appendLog('user', message);
    setBubble('…');

    try {
      const { timeContext, screenContext, mediaContext } = await getPromptContext();
      const messages = buildChatMessages(history, message, timeContext, screenContext, mediaContext);
      const result = await api.ollamaChat(messages);

      if (!result?.ok) {
        throw new Error(result?.error || 'Chat failed.');
      }

      const reply = result.content?.trim() || '…';
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: reply });

      if (history.length > 20) {
        history = history.slice(-20);
      }

      appendLog('assistant', reply);
      setBubble(reply);
      await speakReply(reply);
    } catch (error) {
      console.error(error);
      const errMessage = error.message || 'Could not reach Ollama.';
      setBubble(errMessage);
      appendLog('assistant', errMessage);
    } finally {
      busy = false;
      setInputEnabled(true);
      input.value = '';
      setMicUi(false);
      if (panelOpen) input.focus();
      void offerInitiative();
    }
  }

  async function sendMessage() {
    await sendUserMessage(input.value);
  }

  btnToggle.addEventListener('click', () => {
    setPanelOpen(!panelOpen);
  });

  btnSend.addEventListener('click', sendMessage);
  btnClear.addEventListener('click', () => {
    history = [];
    log.innerHTML = '';
    setBubble('');
    voice.stopSpeaking();
    voice.cancelPushToTalk();
    setMicUi(false);
    initiativeGeneration += 1;
    void offerInitiative();
  });

  voice.bindPushToTalkButton(btnMic);
  voice.bindPushToTalkButton(chatMic);

  btnMic?.addEventListener('pointerdown', () => setPanelOpen(true));
  chatMic?.addEventListener('pointerdown', () => setPanelOpen(true));

  btnVoice?.addEventListener('click', () => {
    const enabled = !voice.isTtsEnabled();
    voice.setTtsEnabled(enabled);
    btnVoice.setAttribute('aria-pressed', String(enabled));
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  panel.addEventListener('mouseenter', () => {
    api?.setIgnoreMouse(false);
  });

  async function checkOllama() {
    if (!api?.ollamaStatus) return;
    const status = await api.ollamaStatus();
    if (!status?.ok) {
      setBubble('Ollama is offline — start it and pull the model to chat with Fluffy.');
    }
  }

  async function checkWhisper() {
    if (!api?.whisperStatus) return;
    const status = await api.whisperStatus();
    if (!status?.ok) {
      setBubble(status.error || 'Whisper is not ready. Run: pip install faster-whisper');
    }
  }

  async function checkXtts() {
    if (!api?.xttsStatus) return;
    const status = await api.xttsStatus();
    if (!status?.ok) {
      setBubble(status.error || 'XTTS is not ready. Run: npm run setup:xtts');
    }
  }

  btnVoice?.setAttribute('aria-pressed', 'true');
  btnMic?.setAttribute('title', 'Hold to talk (Whisper)');
  chatMic?.setAttribute('title', 'Hold to talk (Whisper)');

  return {
    positionChatUi,
    onModelLoaded: async () => {
      positionChatUi();
      await checkWhisper();
      await checkXtts();
      await checkOllama();
      void offerInitiative();
    },
    dispose: () => {
      initiativeGeneration += 1;
    },
  };
}
