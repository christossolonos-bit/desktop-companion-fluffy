const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b';

async function ollamaRequest(path, body) {
  const response = await fetch(`${OLLAMA_HOST}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Ollama request failed (${response.status}).`);
  }

  return response.json();
}

async function chat(messages, options = {}) {
  const body = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
  };

  if (options.format) {
    body.format = options.format;
  }

  const data = await ollamaRequest('/api/chat', body);

  return {
    ok: true,
    content: data.message?.content ?? '',
    model: OLLAMA_MODEL,
  };
}

async function status() {
  try {
    await ollamaRequest('/api/tags');
    return { ok: true, model: OLLAMA_MODEL, host: OLLAMA_HOST };
  } catch (error) {
    return { ok: false, error: error.message, model: OLLAMA_MODEL, host: OLLAMA_HOST };
  }
}

module.exports = {
  OLLAMA_MODEL,
  OLLAMA_HOST,
  chat,
  status,
};
