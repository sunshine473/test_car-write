import { setTimeout as delay } from 'node:timers/promises';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const DEFAULT_HEADERS = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

export function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export async function fetchWithRetry(url, options = {}, retries = 2) {
  const normalizedUrl = normalizeUrl(url);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

    try {
      const response = await fetch(normalizedUrl, {
        ...options,
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.headers ?? {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(500 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(options.headers ?? {})
    }
  });
  return response.json();
}

export async function postFormJson(url, form) {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: 'https://www.dongchedi.com',
      referer: 'https://www.dongchedi.com/auto/library/series'
    },
    body: new URLSearchParams(form)
  });
}
