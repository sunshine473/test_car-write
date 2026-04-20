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

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'feeds');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'clustered');

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com';

// -- Call Claude API ---------------------------------------------------------

async function callClaude(prompt) {
  const response = await fetch(`${CLAUDE_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
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

  const response = await callClaude(prompt);

  // 提取 JSON（去掉可能的 markdown 代码块）
  const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude 返回的格式不正确');
  }

  const result = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  return result;
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 2: Cluster Topics');
  console.log('==================================================\n');

  // 1. 读取模块1的输出
  const today = new Date().toISOString().split('T')[0];
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
