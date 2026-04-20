import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RULES_PATH = fileURLToPath(new URL('../../参考/懂车帝采集规则.md', import.meta.url));

function extractConfigBlock(markdown, rulesPath) {
  const match = markdown.match(/```json\s+config\s*\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error(`规则文档缺少 json config 配置块：${rulesPath}`);
  }
  return JSON.parse(match[1]);
}

export async function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  const absolutePath = path.resolve(rulesPath);
  const markdown = await readFile(absolutePath, 'utf8');
  const rules = extractConfigBlock(markdown, absolutePath);

  return {
    path: absolutePath,
    coreParamKeywords: rules.core_param_keywords ?? [],
    smartGroupNames: rules.smart_group_names ?? [],
    smartParamKeywords: rules.smart_param_keywords ?? [],
    imageSelection: rules.image_selection ?? []
  };
}

export function keywordMatcher(keywords) {
  const escaped = keywords
    .filter(Boolean)
    .map((keyword) => String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (!escaped.length) {
    return () => false;
  }

  const pattern = new RegExp(escaped.join('|'), 'i');
  return (text) => pattern.test(String(text ?? ''));
}
