import { createPushToTalkRecorder } from './audio.js';

export function createVoice({
  api,
  onTranscript,
  onRecordingChange,
  onTranscribingChange,
  onSpeakStart,
  onSpeakEnd,
  onSpeakError,
}) {
  let ttsEnabled = true;
  let transcribing = false;
  let endingPushToTalk = false;
  let speaking = false;
  let speakGeneration = 0;
  let playbackQueue = [];
  let processingPlayback = false;

  const recorder = createPushToTalkRecorder({
    onRecordingChange: (active) => onRecordingChange?.(active),
  });

  async function beginPushToTalk() {
    if (transcribing || recorder.isActive()) return { ok: true };
    stopSpeaking();
    return recorder.begin();
  }

  async function endPushToTalk() {
    if (!recorder.isActive() || transcribing) return { ok: false };

    endingPushToTalk = true;
    transcribing = true;
    onTranscribingChange?.(true);

    try {
      const recorded = await recorder.finish();
      if (!recorded.ok) return recorded;

      const result = await api.transcribeAudio(recorded.wav);
      if (!result?.ok) {
        return { ok: false, error: result?.error || 'Transcription failed.' };
      }

      const text = result.text?.trim();
      if (text) onTranscript?.(text);
      return { ok: true, text: text || '' };
    } finally {
      endingPushToTalk = false;
      transcribing = false;
      onTranscribingChange?.(false);
    }
  }

  function cancelPushToTalk() {
    recorder.cancel();
    transcribing = false;
    onTranscribingChange?.(false);
    onRecordingChange?.(false);
  }

  async function processPlaybackQueue() {
    if (processingPlayback || playbackQueue.length === 0) return;

    processingPlayback = true;
    while (playbackQueue.length > 0) {
      const job = playbackQueue.shift();
      try {
        const result = await job.run();
        job.resolve(result);
      } catch (error) {
        job.reject(error);
      }
    }
    processingPlayback = false;
  }

  function enqueuePlayback(run) {
    return new Promise((resolve, reject) => {
      playbackQueue.push({ run, resolve, reject });
      processPlaybackQueue();
    });
  }

  async function speak(text) {
    if (!ttsEnabled || !text?.trim() || !api?.speakText) return false;

    const generation = ++speakGeneration;
    const spokenText = stripActions(text);

    return enqueuePlayback(async () => {
      if (generation !== speakGeneration) return false;

      speaking = true;
      onSpeakStart?.();

      try {
        const result = await api.speakText(spokenText);

        if (!result?.ok || generation !== speakGeneration) {
          onSpeakError?.(result?.error || 'Voice synthesis failed.');
          return false;
        }

        return true;
      } catch (error) {
        onSpeakError?.(error.message || String(error));
        return false;
      } finally {
        if (generation === speakGeneration) {
          speaking = false;
          onSpeakEnd?.();
        }
      }
    });
  }

  function stopSpeaking() {
    speakGeneration += 1;
    playbackQueue = [];
    api?.stopSpeak?.();
    window.speechSynthesis?.cancel();
    if (speaking) {
      speaking = false;
      onSpeakEnd?.();
    }
  }

  function setTtsEnabled(enabled) {
    ttsEnabled = enabled;
    if (!enabled) stopSpeaking();
    return ttsEnabled;
  }

  function bindPushToTalkButton(button) {
    if (!button) return;

    button.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      api?.setIgnoreMouse?.(false);
      const result = await beginPushToTalk();
      if (!result.ok && result.error) onTranscript?.(null, result.error);
    });

    const release = async (event) => {
      if (!recorder.isActive()) return;
      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      const result = await endPushToTalk();
      if (!result.ok && result.error && result.error !== 'Recording too short.') {
        onTranscript?.(null, result.error);
      }
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', () => cancelPushToTalk());
    button.addEventListener('lostpointercapture', () => {
      if (endingPushToTalk) return;
      if (recorder.isActive()) cancelPushToTalk();
    });
  }

  return {
    speak,
    stopSpeaking,
    setTtsEnabled,
    isTtsEnabled: () => ttsEnabled,
    isRecording: () => recorder.isActive(),
    isTranscribing: () => transcribing,
    isSpeaking: () => speaking,
    bindPushToTalkButton,
    cancelPushToTalk,
    isSttAvailable: () => Boolean(api?.transcribeAudio),
    isTtsAvailable: () => Boolean(api?.speakText),
  };
}

function stripActions(text) {
  return text.replace(/\*[^*]+\*/g, '').replace(/\s+/g, ' ').trim();
}
