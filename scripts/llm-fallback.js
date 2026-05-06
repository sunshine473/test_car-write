#!/usr/bin/env node

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function getEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return '';
}

function getClaudeBaseUrl() {
  return getEnvValue('CLAUDE_BASE_URL', 'claude_base_url') || 'https://api.anthropic.com';
}

function getMiniMaxBaseUrl() {
  return getEnvValue('MINIMAX_BASE_URL', 'minimax_base_url');
}

function getMiniMaxModel() {
  return getEnvValue('MINIMAX_MODEL', 'minimax_model') || 'MiniMax-M2.7';
}

function getMiniMaxBaseUrlCandidates() {
  const configured = getMiniMaxBaseUrl();
  if (configured) {
    return [configured];
  }

  return [
    'https://api.minimaxi.com/anthropic',
    'https://api.minimax.io/anthropic'
  ];
}

class ProviderHttpError extends Error {
  constructor(provider, status, statusText, body) {
    super(`${provider} API error: ${statusText}`);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

function parseGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

function parseAnthropicStyleText(data) {
  const contentBlocks = Array.isArray(data?.content) ? data.content : [];
  const textBlocks = contentBlocks
    .map(item => item?.text)
    .filter(text => typeof text === 'string' && text.trim());

  if (textBlocks.length > 0) {
    return textBlocks.join('\n').trim();
  }

  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const choiceContent = data?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.trim()) {
    return choiceContent.trim();
  }

  if (Array.isArray(choiceContent)) {
    const choiceText = choiceContent
      .map(item => item?.text)
      .filter(text => typeof text === 'string' && text.trim())
      .join('\n')
      .trim();

    if (choiceText) {
      return choiceText;
    }
  }

  return '';
}

function hasMiniMaxConfig() {
  return Boolean(getEnvValue('MINIMAX_API_KEY', 'minimax_api_key'));
}

function isCredentialFailure(error) {
  if (!(error instanceof ProviderHttpError)) {
    return false;
  }

  if (error.status === 401 || error.status === 403) {
    return true;
  }

  const body = String(error.body || '').toLowerCase();
  return (
    body.includes('expired_api_key') ||
    body.includes('api key has expired') ||
    body.includes('reported as leaked') ||
    body.includes('invalid api key') ||
    body.includes('unauthorized') ||
    body.includes('permission_denied')
  );
}

async function parseErrorBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function callGeminiRaw(prompt, { model = 'gemini-2.5-flash' } = {}) {
  const apiKey = getEnvValue('GEMINI_API_KEY', 'gemini_api_key');
  if (!apiKey) {
    throw new Error('缺少 GEMINI_API_KEY');
  }

  const response = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new ProviderHttpError('Gemini', response.status, response.statusText, await parseErrorBody(response));
  }

  const data = await response.json();
  const text = parseGeminiText(data);
  if (!text) {
    throw new Error('Gemini 返回内容为空');
  }

  return text;
}

async function callClaudeRaw(prompt, { model = 'claude-opus-4-20250514', maxTokens = 4096, system } = {}) {
  const apiKey = getEnvValue('CLAUDE_API_KEY', 'claude_api_key');
  if (!apiKey) {
    throw new Error('缺少 CLAUDE_API_KEY');
  }

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };

  if (system) {
    body.system = system;
  }

  const response = await fetch(`${getClaudeBaseUrl()}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new ProviderHttpError('Claude', response.status, response.statusText, await parseErrorBody(response));
  }

  const data = await response.json();
  const text = parseAnthropicStyleText(data);
  if (!text) {
    throw new Error('Claude 返回内容为空');
  }

  return text;
}

export async function callMiniMax(prompt, {
  model = getMiniMaxModel(),
  maxTokens = 2048,
  system
} = {}) {
  const apiKey = getEnvValue('MINIMAX_API_KEY', 'minimax_api_key');
  if (!apiKey) {
    throw new Error('缺少 MINIMAX_API_KEY');
  }

  const body = {
    model,
    max_tokens: Math.min(maxTokens, 2048),
    messages: [{ role: 'user', content: prompt }]
  };

  if (system) {
    body.system = system;
  }

  const baseUrls = getMiniMaxBaseUrlCandidates();
  let lastError = null;

  for (const baseUrl of baseUrls) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        lastError = new ProviderHttpError('MiniMax', response.status, response.statusText, await parseErrorBody(response));
        const shouldTryNextBaseUrl = !getMiniMaxBaseUrl() && baseUrls.indexOf(baseUrl) < baseUrls.length - 1;
        if (shouldTryNextBaseUrl) {
          break;
        }
        throw lastError;
      }

      const data = await response.json();
      const text = parseAnthropicStyleText(data);
      if (text) {
        return text;
      }

      lastError = new Error('MiniMax 返回内容为空');

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error('MiniMax 请求失败');
}

function shouldFallbackToMiniMax(error) {
  return hasMiniMaxConfig() && (error.message.startsWith('缺少 ') || isCredentialFailure(error));
}

export async function callClaudeWithFallback(prompt, options = {}) {
  try {
    return await callClaudeRaw(prompt, options);
  } catch (error) {
    if (!shouldFallbackToMiniMax(error)) {
      throw error;
    }

    console.log(`   ↺ Claude 不可用，回退到 MiniMax: ${error.message}`);
    return callMiniMax(prompt, {
      model: options.minimaxModel || getMiniMaxModel(),
      maxTokens: options.maxTokens || 2048,
      system: options.system
    });
  }
}

export async function callGeminiWithFallback(prompt, options = {}) {
  try {
    return await callGeminiRaw(prompt, options);
  } catch (error) {
    if (!shouldFallbackToMiniMax(error)) {
      throw error;
    }

    console.log(`      ↺ Gemini 不可用，回退到 MiniMax: ${error.message}`);
    return callMiniMax(prompt, {
      model: options.minimaxModel || getMiniMaxModel(),
      maxTokens: options.maxTokens || 2048,
      system: options.system
    });
  }
}
