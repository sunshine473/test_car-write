#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 3: Rank Topics
// ============================================================================
// 筛选与排序：从话题组中选出 Top 3 最值得写的话题
// 双模型评分：Gemini 初评 + Claude 复评 + Claude 最终决策
// 输出：data/ranked/ranked-{date}.json
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'clustered');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'ranked');
const CONFIG_PATH = join(__dirname, '..', 'config', 'ranking-prompts.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com';

// 禁用不稳定的 Gemini API
const USE_GEMINI = false;

// -- Load Config -------------------------------------------------------------

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

// -- Call Gemini API ---------------------------------------------------------

async function callGemini(prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

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
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// -- Extract JSON from response ----------------------------------------------

function extractJSON(text) {
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('无法从响应中提取 JSON');
  }
  return JSON.parse(jsonMatch[1] || jsonMatch[0]);
}

// -- Gemini Score ------------------------------------------------------------

async function geminiScore(topic, config) {
  const articleTitles = topic.相关文章.map((a, i) => `${i + 1}. ${a.标题}`).join('\n');

  const prompt = config.gemini_prompt
    .replace('{{topic_name}}', topic.主话题)
    .replace('{{keywords}}', topic.关键词.join('、'))
    .replace('{{article_count}}', topic.文章数)
    .replace('{{article_titles}}', articleTitles);

  const response = await callGemini(prompt);
  return extractJSON(response);
}

// -- Claude Score ------------------------------------------------------------

async function claudeScore(topic, geminiResult, config) {
  const articleTitles = topic.相关文章.map((a, i) => `${i + 1}. ${a.标题}`).join('\n');

  const prompt = config.claude_prompt
    .replace('{{topic_name}}', topic.主话题)
    .replace('{{keywords}}', topic.关键词.join('、'))
    .replace('{{article_count}}', topic.文章数)
    .replace('{{article_titles}}', articleTitles)
    .replace('{{gemini_result}}', JSON.stringify(geminiResult, null, 2));

  const response = await callClaude(prompt);
  return extractJSON(response);
}

// -- Claude Final Decision ---------------------------------------------------

async function claudeFinalDecision(topics, geminiScores, claudeScores, config) {
  const topicsWithScores = topics.map((topic, i) => ({
    话题ID: topic.话题ID,
    话题: topic.主话题,
    关键词: topic.关键词,
    文章数: topic.文章数,
    Gemini评分: geminiScores[i],
    Claude评分: claudeScores[i]
  }));

  const prompt = config.claude_final_decision_prompt
    .replace('{{topic_count}}', topics.length)
    .replace('{{topics_with_scores}}', JSON.stringify(topicsWithScores, null, 2));

  const response = await callClaude(prompt);
  return extractJSON(response);
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 3: Rank Topics');
  console.log('================================================\n');

  // 1. 读取配置
  const config = await loadConfig();
  console.log('📋 配置加载完成');

  // 2. 读取模块2的输出
  const today = new Date().toISOString().split('T')[0];
  const inputPath = join(INPUT_DIR, `clustered-${today}.json`);

  console.log(`📂 读取数据: ${inputPath}`);
  const clusteredData = JSON.parse(await readFile(inputPath, 'utf-8'));
  const topics = clusteredData.话题分组;

  console.log(`📊 话题数: ${topics.length}\n`);

  // 3. Gemini 初评（可选）
  let geminiScores = [];

  if (USE_GEMINI) {
    console.log('1️⃣  Gemini 初评:');
    for (const topic of topics) {
      try {
        const score = await geminiScore(topic, config);
        geminiScores.push(score);
        console.log(`   ✓ ${topic.主话题}: ${score.综合得分}分`);
      } catch (err) {
        console.log(`   ✗ ${topic.主话题}: ${err.message}`);
        geminiScores.push({ 综合得分: 0, 评分: {}, 推荐理由: '评分失败' });
      }
    }
  } else {
    console.log('1️⃣  Gemini 初评: 已禁用，跳过');
    // 使用默认分数
    geminiScores = topics.map(() => ({ 综合得分: 80, 评分: {}, 推荐理由: '使用默认评分' }));
  }

  // 4. Claude 复评
  console.log('\n2️⃣  Claude 复评:');
  const claudeScores = [];
  for (let i = 0; i < topics.length; i++) {
    try {
      const score = await claudeScore(topics[i], geminiScores[i], config);
      claudeScores.push(score);
      console.log(`   ✓ ${topics[i].主话题}: ${score.综合得分}分`);
    } catch (err) {
      console.log(`   ✗ ${topics[i].主话题}: ${err.message}`);
      claudeScores.push({ 综合得分: 0, 评分: {}, 推荐理由: '评分失败' });
    }
  }

  // 5. Claude 最终决策
  console.log('\n3️⃣  Claude 最终决策:');
  const finalDecision = await claudeFinalDecision(topics, geminiScores, claudeScores, config);

  // 6. 构建输出数据
  const recommendedTopics = finalDecision.推荐列表.map(rec => {
    const topic = topics.find(t => t.话题ID === rec.话题ID);
    const geminiScore = geminiScores[topics.indexOf(topic)];
    const claudeScore = claudeScores[topics.indexOf(topic)];

    return {
      排名: rec.排名,
      话题ID: rec.话题ID,
      话题: rec.话题,
      关键词: topic.关键词,
      文章数: topic.文章数,
      最终得分: rec.最终得分,
      评分详情: {
        Gemini评分: geminiScore,
        Claude评分: claudeScore
      },
      为什么推荐: rec.为什么推荐,
      建议角度: rec.建议角度,
      相关文章: topic.相关文章
    };
  });

  // 7. 输出
  const output = {
    时间: new Date().toISOString(),
    总话题数: topics.length,
    推荐话题数: recommendedTopics.length,
    评分模型: {
      初评: 'Gemini 2.0 Flash',
      复评: 'Claude Opus 4',
      决策: 'Claude Opus 4'
    },
    推荐列表: recommendedTopics,
    未推荐话题: topics
      .filter(t => !recommendedTopics.find(r => r.话题ID === t.话题ID))
      .map(t => ({
        话题ID: t.话题ID,
        话题: t.主话题,
        综合得分: claudeScores[topics.indexOf(t)].综合得分,
        未推荐原因: '得分低于Top 3'
      }))
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `ranked-${today}.json`);
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✅ 排序完成: ${outputPath}`);
  console.log('\n🏆 Top 3 推荐话题:');
  recommendedTopics.forEach(topic => {
    console.log(`   ${topic.排名}. ${topic.话题} (得分: ${topic.最终得分})`);
    console.log(`      ${topic.为什么推荐.slice(0, 60)}...`);
  });
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
