function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export async function blobToWav16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
  await decodeContext.close();

  const targetRate = 16000;
  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decoded.duration * targetRate)),
    targetRate,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), targetRate);
}

export function createPushToTalkRecorder({ onRecordingChange }) {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let active = false;

  async function begin() {
    if (active) return { ok: true };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
      active = true;
      onRecordingChange?.(true);
      return { ok: true };
    } catch (error) {
      onRecordingChange?.(false);
      return { ok: false, error: error.message || 'Microphone access denied.' };
    }
  }

  function cleanupStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    chunks = [];
    active = false;
    onRecordingChange?.(false);
  }

  async function finish() {
    if (!active || !recorder) {
      cleanupStream();
      return { ok: false, error: 'No active recording.' };
    }

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          cleanupStream();

          if (blob.size < 1200) {
            resolve({ ok: false, error: 'Recording too short.' });
            return;
          }

          const wav = await blobToWav16kMono(blob);
          resolve({ ok: true, wav });
        } catch (error) {
          cleanupStream();
          resolve({ ok: false, error: error.message || 'Could not process audio.' });
        }
      };

      recorder.stop();
    });
  }

  function cancel() {
    if (!active) return;
    try {
      recorder?.stop();
    } catch {
      cleanupStream();
    }
  }

  return {
    begin,
    finish,
    cancel,
    isActive: () => active,
  };
}
