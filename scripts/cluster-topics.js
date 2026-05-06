#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 2: Cluster Topics
// ============================================================================
// 去重与聚类：将热点新闻按话题分组
// 输出：data/clustered/clustered-{date}.json
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { callClaudeWithFallback } from './llm-fallback.js';
import { extractJSONWithRepair, JSON_ONLY_SYSTEM_PROMPT } from './json-utils.js';
import { getRunDate } from './runtime-context.js';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'feeds');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'clustered');

function isNumberArray(value) {
  return Array.isArray(value) && value.every(item => Number.isInteger(item));
}

function isGroupArray(value) {
  return Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item));
}

function getResultCandidates(result) {
  const candidates = [];
  const queue = [result];
  const seen = new Set();
  const wrapperKeys = ['result', 'data', 'output', 'json', '结果', '输出', '内容', 'response'];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      continue;
    }

    if (seen.has(current)) {
      continue;
    }

    seen.add(current);
    candidates.push(current);

    for (const key of wrapperKeys) {
      const wrapped = current[key];
      if (typeof wrapped === 'string') {
        try {
          queue.push(JSON.parse(wrapped));
        } catch {
          // Ignore non-JSON wrapper strings.
        }
      } else if (wrapped && typeof wrapped === 'object') {
        queue.push(wrapped);
      }
    }
  }

  return candidates;
}

function findIndicesArray(candidates) {
  const exactKeys = ['去重后的文章索引', '去重后的索引列表', '去重索引', 'deduplicated_indices'];
  for (const candidate of candidates) {
    for (const key of exactKeys) {
      if (isNumberArray(candidate[key])) {
        return candidate[key];
      }
    }
  }

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate)) {
      if (/(去重|索引)/.test(key) && isNumberArray(value)) {
        return value;
      }
    }
  }

  return null;
}

function findGroupArray(candidates) {
  const exactKeys = ['话题分组', '聚类结果', 'topics', 'groups'];
  for (const candidate of candidates) {
    for (const key of exactKeys) {
      if (isGroupArray(candidate[key])) {
        return candidate[key];
      }
    }
  }

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate)) {
      if (/(分组|聚类|话题|topic|group)/i.test(key) && isGroupArray(value)) {
        return value;
      }
    }
  }

  return null;
}

function findGroupField(group, patterns, validator) {
  for (const [key, value] of Object.entries(group || {})) {
    if (patterns.some(pattern => pattern.test(key)) && validator(value)) {
      return value;
    }
  }

  return null;
}

function normalizeClusterGroup(group) {
  const normalizedGroup = {
    主话题:
      group?.主话题 ??
      group?.话题名称 ??
      group?.主题 ??
      group?.topic ??
      findGroupField(group, [/主话题/, /话题/, /主题/, /topic/i], value => typeof value === 'string' && value.trim()),
    关键词:
      group?.关键词 ??
      group?.共同关键词 ??
      group?.keyWords ??
      group?.keywords ??
      findGroupField(group, [/关键词/, /key/i], value => Array.isArray(value)),
    文章索引:
      group?.文章索引 ??
      group?.包含的索引 ??
      group?.索引列表 ??
      group?.indices ??
      findGroupField(group, [/文章索引/, /索引/, /index/i], value => isNumberArray(value))
  };

  if (!normalizedGroup.主话题 || !Array.isArray(normalizedGroup.关键词) || !Array.isArray(normalizedGroup.文章索引)) {
    throw new Error('聚类结果字段不完整');
  }

  return normalizedGroup;
}

function normalizeClusterResult(result) {
  const candidates = getResultCandidates(result);
  const groups = findGroupArray(candidates);
  const deduplicatedIndices = findIndicesArray(candidates);

  if (!Array.isArray(groups)) {
    throw new Error('聚类结果结构不符合预期');
  }

  const normalizedGroups = groups.map(normalizeClusterGroup);
  const fallbackIndices = [...new Set(normalizedGroups.flatMap(group => group.文章索引))].sort((a, b) => a - b);

  return {
    去重后的文章索引: Array.isArray(deduplicatedIndices) ? deduplicatedIndices : fallbackIndices,
    话题分组: normalizedGroups
  };
}

function buildClusterSchemaPrompt(text) {
  return `请把下面这段内容整理成一个严格合法的 JSON 对象，并且只返回 JSON 本身，不要添加任何解释或 Markdown。

必须严格使用以下字段名：
{
  "去重后的文章索引": [0, 2, 5],
  "话题分组": [
    {
      "主话题": "示例话题",
      "关键词": ["关键词1", "关键词2"],
      "文章索引": [0, 2]
    }
  ]
}

要求：
1. 顶层必须是对象
2. "去重后的文章索引" 必须是整数数组
3. "话题分组" 必须是数组
4. 每个话题组只能包含 "主话题"、"关键词"、"文章索引" 这三个字段
5. 所有字段名都必须与上面的中文字段完全一致

原始内容：
<<<RAW
${text}
RAW>>>`;
}

// -- Deduplicate and Cluster -------------------------------------------------

async function deduplicateAndCluster(articles) {
  console.log('🤖 调用 Claude 进行去重与聚类...');

  // 准备数据：只发送标题和关键词（减少 token）
  const simplifiedArticles = articles.map((item, index) => ({
    index,
    id: item.id,
    标题: item.标题,
    关键词: item.关键词,
    来源: item.来源
  }));

  const prompt = `你是汽车行业内容策展专家。请分析以下 ${articles.length} 条汽车新闻，完成去重和聚类任务。

# 新闻列表
${JSON.stringify(simplifiedArticles, null, 2)}

# 任务要求

## 1. 去重
- 识别标题高度相似的文章（相似度 > 80%）
- 对于重复的文章，只保留一条（优先保留来源权威的）
- 返回去重后的文章 index 列表

## 2. 聚类
- 将去重后的文章按话题分组
- 每组 2-5 篇文章
- 最多 8-10 个话题组
- 基于关键词和标题语义进行分组

## 3. 话题命名
- 为每个话题组生成一个简洁的主题名（5-10个字）
- 提取该组的共同关键词（3-5个）

# 输出格式

请严格按照以下 JSON 格式输出（不要有任何其他文字）：

\`\`\`json
{
  "去重后的文章索引": [0, 2, 5, 7, ...],
  "话题分组": [
    {
      "主话题": "小米汽车北京车展",
      "关键词": ["小米", "车展", "SU7"],
      "文章索引": [0, 2, 5]
    },
    {
      "主话题": "电动车续航突破",
      "关键词": ["续航", "电池", "技术"],
      "文章索引": [7, 9, 12]
    }
  ]
}
\`\`\``;

  const modelOptions = {
    model: 'claude-opus-4-20250514',
    maxTokens: 4096,
    system: JSON_ONLY_SYSTEM_PROMPT
  };

  const response = await callClaudeWithFallback(prompt, modelOptions);

  const result = await extractJSONWithRepair(response, {
    label: '汽车新闻去重聚类结果',
    repair: repairPrompt => callClaudeWithFallback(repairPrompt, modelOptions)
  });

  try {
    return normalizeClusterResult(result);
  } catch {
    const schemaResponse = await callClaudeWithFallback(buildClusterSchemaPrompt(response), modelOptions);
    const schemaResult = await extractJSONWithRepair(schemaResponse, {
      label: '汽车新闻去重聚类结果',
      repair: repairPrompt => callClaudeWithFallback(repairPrompt, modelOptions)
    });

    return normalizeClusterResult(schemaResult);
  }
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 2: Cluster Topics');
  console.log('==================================================\n');

  // 1. 读取模块1的输出
  const today = getRunDate();
  const inputPath = join(INPUT_DIR, `feed-${today}.json`);

  console.log(`📂 读取数据: ${inputPath}`);
  const feedData = JSON.parse(await readFile(inputPath, 'utf-8'));
  const articles = feedData.热点列表;

  console.log(`📊 原始文章数: ${articles.length}`);

  // 2. 调用 Claude 进行去重与聚类
  const clusterResult = await deduplicateAndCluster(articles);

  // 3. 构建输出数据
  const deduplicatedIndices = clusterResult.去重后的文章索引;
  const deduplicatedArticles = deduplicatedIndices.map(i => articles[i]);

  console.log(`🔄 去重后文章数: ${deduplicatedArticles.length}`);
  console.log(`📦 话题组数: ${clusterResult.话题分组.length}`);

  // 4. 为每个话题组添加完整的文章信息
  const topicGroups = clusterResult.话题分组.map((group, index) => {
    const groupArticles = group.文章索引.map(i => articles[i]);

    // 计算平均热度
    const avgHotness = groupArticles.reduce((sum, a) => sum + a.热度指数, 0) / groupArticles.length;

    return {
      话题ID: `topic_${String(index + 1).padStart(3, '0')}`,
      主话题: group.主话题,
      关键词: group.关键词,
      文章数: groupArticles.length,
      平均热度: Math.round(avgHotness * 100) / 100,
      相关文章: groupArticles
    };
  });

  // 5. 按平均热度排序
  topicGroups.sort((a, b) => b.平均热度 - a.平均热度);

  // 6. 输出
  const output = {
    时间: new Date().toISOString(),
    去重前文章数: articles.length,
    去重后文章数: deduplicatedArticles.length,
    话题数: topicGroups.length,
    话题分组: topicGroups
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `clustered-${today}.json`);
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✅ 聚类完成: ${outputPath}`);
  console.log('\n📋 话题列表:');
  topicGroups.forEach((group, i) => {
    console.log(`   ${i + 1}. ${group.主话题} (${group.文章数}篇, 热度${group.平均热度})`);
  });
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
