#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 4: Write Articles
// ============================================================================
// 为 Top 3 话题生成完整文章
// 流程：Tavily深度搜索 → Gemini初稿 → Claude润色 → 多平台版本
// 输出：data/articles/article-{topicId}-{date}.json
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'ranked');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'articles');
const CONFIG_PATH = join(__dirname, '..', 'config', 'writing-prompts.json');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com';

// -- Load Config -------------------------------------------------------------

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

// -- Tavily Deep Search ------------------------------------------------------

async function tavilyDeepSearch(topic) {
  console.log(`   🔍 Tavily 深度搜索...`);

  const queries = [
    topic.话题,
    ...topic.关键词.slice(0, 2).map(k => `${k} 2026`),
    `${topic.话题} 最新消息`
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          max_results: 5,
          search_depth: 'advanced',
          days: 7
        })
      });

      if (response.ok) {
        const data = await response.json();
        allResults.push(...(data.results || []));
      }
    } catch (err) {
      console.log(`      ✗ "${query}": ${err.message}`);
    }
  }

  // 去重
  const seen = new Set();
  const uniqueResults = allResults.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  console.log(`      ✓ 找到 ${uniqueResults.length} 篇新素材`);
  return uniqueResults;
}

// -- Call Gemini API ---------------------------------------------------------

async function callGemini(prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
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
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// -- Extract JSON ------------------------------------------------------------

function extractJSON(text) {
  // 尝试多种方式提取JSON

  // 方式1：从markdown代码块提取
  let jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (err) {
      console.log('      ⚠️  Markdown JSON解析失败，尝试其他方式...');
    }
  }

  // 方式2：查找第一个完整的JSON对象（使用括号计数）
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          return JSON.parse(text.substring(start, i + 1));
        } catch (err) {
          // 继续查找下一个
          start = -1;
        }
      }
    }
  }

  throw new Error('无法从响应中提取有效的 JSON');
}

// -- Generate Article --------------------------------------------------------

async function generateArticle(topic, config) {
  console.log(`\n📝 生成文章: ${topic.话题}`);
  console.log('='.repeat(60));

  // 1. Tavily 深度搜索
  const tavilyResults = await tavilyDeepSearch(topic);

  // 2. 合并所有素材
  const allMaterials = [
    ...topic.相关文章.map(a => ({
      标题: a.标题,
      链接: a.链接,
      摘要: a.内容摘要,
      来源: a.来源
    })),
    ...tavilyResults.map(r => ({
      标题: r.title,
      链接: r.url,
      摘要: r.content,
      来源: new URL(r.url).hostname
    }))
  ];

  console.log(`   📚 总素材数: ${allMaterials.length} 篇`);

  // 3. Gemini 生成初稿
  console.log(`   🤖 Gemini 生成初稿...`);

  const materialsText = allMaterials.map((m, i) =>
    `${i + 1}. ${m.标题}\n   来源: ${m.来源}\n   摘要: ${m.摘要.slice(0, 200)}...`
  ).join('\n\n');

  const geminiPrompt = config.gemini_draft_prompt
    .replace('{{topic}}', topic.话题)
    .replace('{{suggested_angle}}', topic.建议角度 || '全面分析')
    .replace('{{material_count}}', allMaterials.length)
    .replace('{{materials}}', materialsText);

  let draft;
  try {
    const geminiResponse = await callGemini(geminiPrompt);
    draft = extractJSON(geminiResponse);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  } catch (err) {
    console.log(`      ✗ Gemini 失败: ${err.message}`);
    console.log(`      ⚠️  使用 Claude 生成初稿...`);
    const claudeResponse = await callClaude(geminiPrompt);
    draft = extractJSON(claudeResponse);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  }

  // 4. Claude 优化润色
  console.log(`   ✨ Claude 优化润色...`);

  const claudePrompt = config.claude_polish_prompt
    .replace('{{gemini_draft}}', JSON.stringify(draft, null, 2));

  const polishedResponse = await callClaude(claudePrompt);
  const polished = extractJSON(polishedResponse);

  console.log(`      ✓ 润色完成 (${polished.字数}字)`);

  // 5. 生成多平台版本
  console.log(`   🎨 生成多平台版本...`);

  const platforms = {};
  for (const [platformName, platformConfig] of Object.entries(config.platform_prompts)) {
    try {
      const platformPrompt = platformConfig.prompt.replace('{{article}}', polished.正文);
      const platformResponse = await callClaude(platformPrompt);
      const platformArticle = extractJSON(platformResponse);
      platforms[platformName] = platformArticle;
      console.log(`      ✓ ${platformName}: ${platformArticle.字数}字`);
    } catch (err) {
      console.log(`      ✗ ${platformName}: ${err.message}`);
    }
  }

  // 6. 质量检查
  const qualityCheck = {
    字数: polished.字数 >= 800 && polished.字数 <= 1000 ? '✅ 符合要求' : `⚠️ ${polished.字数}字`,
    素材数: allMaterials.length >= 20 ? '✅ 符合要求' : `⚠️ ${allMaterials.length}篇`,
    平台版本: Object.keys(platforms).length === 5 ? '✅ 全部生成' : `⚠️ ${Object.keys(platforms).length}/5`
  };

  // 7. 返回结果
  return {
    生成时间: new Date().toISOString(),
    话题ID: topic.话题ID,
    话题: topic.话题,
    关键词: topic.关键词,
    素材统计: {
      原有文章: topic.相关文章.length,
      Tavily搜索: tavilyResults.length,
      总计: allMaterials.length
    },
    通用版本: polished,
    知乎版本: platforms.zhihu,
    小红书版本: platforms.xiaohongshu,
    YouTube脚本: platforms.youtube,
    今日头条版本: platforms.toutiao,
    微信公众号版本: platforms.weixin,
    参考素材: allMaterials.map(m => `${m.标题} (${m.来源})`),
    质量检查: qualityCheck
  };
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 4: Write Articles');
  console.log('==================================================\n');

  // 1. 读取配置
  const config = await loadConfig();
  console.log('📋 配置加载完成');

  // 2. 读取模块3的输出
  const today = new Date().toISOString().split('T')[0];
  const inputPath = join(INPUT_DIR, `ranked-${today}.json`);

  console.log(`📂 读取数据: ${inputPath}`);
  const rankedData = JSON.parse(await readFile(inputPath, 'utf-8'));
  const topTopics = rankedData.推荐列表;

  console.log(`📊 Top ${topTopics.length} 话题\n`);

  // 3. 为每个话题生成文章
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const topic of topTopics) {
    try {
      const article = await generateArticle(topic, config);

      // 保存文章
      const outputPath = join(OUTPUT_DIR, `article-${topic.话题ID}-${today}.json`);
      await writeFile(outputPath, JSON.stringify(article, null, 2));

      console.log(`   ✅ 文章已保存: ${outputPath}\n`);
    } catch (err) {
      console.error(`   ❌ 生成失败: ${err.message}\n`);
    }
  }

  console.log('✅ 所有文章生成完成！');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
