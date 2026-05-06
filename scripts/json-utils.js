#!/usr/bin/env node

export const JSON_ONLY_SYSTEM_PROMPT = [
  'You are a JSON-only service.',
  'Return exactly one valid JSON object or array.',
  'Do not include Markdown fences, explanations, or any surrounding text.'
].join(' ');

function collectBalancedBlocks(text, openChar, closeChar) {
  const candidates = [];

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (char === closeChar && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.substring(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

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

  candidates.push(...collectBalancedBlocks(text, '{', '}'));
  candidates.push(...collectBalancedBlocks(text, '[', ']'));

  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  const firstCandidate = [firstObject, firstArray]
    .filter(index => index !== -1)
    .sort((a, b) => a - b)[0];

  const lastObject = text.lastIndexOf('}');
  const lastArray = text.lastIndexOf(']');
  const lastCandidate = [lastObject, lastArray]
    .filter(index => index !== -1)
    .sort((a, b) => b - a)[0];

  if (firstCandidate !== undefined && lastCandidate !== undefined && lastCandidate > firstCandidate) {
    candidates.push(text.slice(firstCandidate, lastCandidate + 1));
  }

  return candidates;
}

function sanitizeJsonCandidate(candidate) {
  return candidate
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
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

function buildJsonRepairPrompt(text, label) {
  return `下面这段模型输出本应是“${label}”，但格式不合法。请将它修复成一个严格合法的 JSON，并且只返回 JSON 本身，不要添加任何解释、Markdown 代码块或额外文字。

要求：
1. 保留原始字段和数据含义
2. 去掉多余说明文字或代码块标记
3. 修复缺失括号、引号、逗号等格式问题
4. 如果原文里存在多个 JSON 片段，只保留最完整、最合理的那一个

原始内容：
<<<RAW
${text}
RAW>>>`;
}

export async function extractJSONWithRepair(text, { label = 'JSON 数据', repair } = {}) {
  try {
    return extractJSONFromText(text);
  } catch (initialError) {
    if (!repair) {
      throw initialError;
    }

    const repairedText = await repair(buildJsonRepairPrompt(text, label));

    try {
      return extractJSONFromText(repairedText);
    } catch (repairError) {
      throw new Error(`${initialError.message}；JSON 修复后仍然无效`);
    }
  }
}
