#!/usr/bin/env node

function getCandidateBlocks(text) {
  const candidates = [];

  const fencedJsonBlocks = text.matchAll(/```json\s*([\s\S]*?)\s*```/gi);
  for (const match of fencedJsonBlocks) {
    candidates.push(match[1]);
  }

  const fencedBlocks = text.matchAll(/```\s*([\s\S]*?)\s*```/g);
  for (const match of fencedBlocks) {
    candidates.push(match[1]);
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.substring(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function sanitizeJsonCandidate(candidate) {
  return candidate
    .trim()
    .replace(/^json\s*/i, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function parseCandidate(candidate) {
  const normalized = sanitizeJsonCandidate(candidate);
  return JSON.parse(normalized);
}

export function extractJSONFromText(text) {
  const candidates = getCandidateBlocks(text);

  for (const candidate of candidates) {
    try {
      return parseCandidate(candidate);
    } catch {
      // Try next candidate.
    }
  }

  try {
    return parseCandidate(text);
  } catch {
    throw new Error('无法从响应中提取有效的 JSON');
  }
}
