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
import { getRunDate, writeArticleBatch } from './article-batch.js';
import { callClaudeWithFallback, callGeminiWithFallback } from './llm-fallback.js';
import { extractJSONWithRepair, JSON_ONLY_SYSTEM_PROMPT } from './json-utils.js';
import { getRunYear } from './runtime-context.js';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'ranked');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'articles');
const CONFIG_PATH = join(__dirname, '..', 'config', 'writing-prompts.json');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
// -- Load Config -------------------------------------------------------------

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

async function parseStructuredResponse(response, label, maxTokens = 2048) {
  return extractJSONWithRepair(response, {
    label,
    repair: repairPrompt => callClaudeWithFallback(repairPrompt, {
      model: 'claude-opus-4-20250514',
      maxTokens,
      system: JSON_ONLY_SYSTEM_PROMPT
    })
  });
}

// -- Tavily Deep Search ------------------------------------------------------

async function tavilyDeepSearch(topic) {
  console.log(`   🔍 Tavily 深度搜索...`);

  const queries = [
    topic.话题,
    ...topic.关键词.slice(0, 2).map(k => `${k} ${getRunYear()}`),
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
    const geminiResponse = await callGeminiWithFallback(geminiPrompt, {
      model: 'gemini-2.5-flash',
      maxTokens: 2048,
      system: JSON_ONLY_SYSTEM_PROMPT
    });
    draft = await parseStructuredResponse(geminiResponse, `${topic.话题} 的文章初稿`);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  } catch (err) {
    console.log(`      ✗ Gemini 失败: ${err.message}`);
    console.log(`      ⚠️  使用 Claude 生成初稿...`);
    const claudeResponse = await callClaudeWithFallback(geminiPrompt, {
      model: 'claude-opus-4-20250514',
      maxTokens: 2048,
      system: JSON_ONLY_SYSTEM_PROMPT
    });
    draft = await parseStructuredResponse(claudeResponse, `${topic.话题} 的文章初稿`);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  }

  // 4. Claude 优化润色
  console.log(`   ✨ Claude 优化润色...`);

  const claudePrompt = config.claude_polish_prompt
    .replace('{{gemini_draft}}', JSON.stringify(draft, null, 2));

  const polishedResponse = await callClaudeWithFallback(claudePrompt, {
    model: 'claude-opus-4-20250514',
    maxTokens: 2048,
    system: JSON_ONLY_SYSTEM_PROMPT
  });
  const polished = await parseStructuredResponse(polishedResponse, `${topic.话题} 的润色文章`);

  console.log(`      ✓ 润色完成 (${polished.字数}字)`);

  // 5. 生成多平台版本
  console.log(`   🎨 生成多平台版本...`);

  const platforms = {};
  for (const [platformName, platformConfig] of Object.entries(config.platform_prompts)) {
    try {
      const platformPrompt = platformConfig.prompt.replace('{{article}}', polished.正文);
      const platformResponse = await callClaudeWithFallback(platformPrompt, {
        model: 'claude-opus-4-20250514',
        maxTokens: 2048,
        system: JSON_ONLY_SYSTEM_PROMPT
      });
      const platformArticle = await parseStructuredResponse(
        platformResponse,
        `${topic.话题} 的 ${platformName} 平台版本`
      );
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
    参考素材: allMaterials.map(m => ({
      标题: m.标题,
      来源: m.来源,
      链接: m.链接 || m.url || ''
    })),
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
  const today = getRunDate();
  const inputPath = join(INPUT_DIR, `ranked-${today}.json`);

  console.log(`📂 读取数据: ${inputPath}`);
  const rankedData = JSON.parse(await readFile(inputPath, 'utf-8'));
  const topTopics = rankedData.推荐列表;

  console.log(`📊 Top ${topTopics.length} 话题\n`);

  // 3. 为每个话题生成文章
  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedArticleFiles = [];
  const failedTopics = [];

  for (const topic of topTopics) {
    try {
      const article = await generateArticle(topic, config);
      article.运行日期 = today;

      // 保存文章
      const outputPath = join(OUTPUT_DIR, `article-${topic.话题ID}-${today}.json`);
      await writeFile(outputPath, JSON.stringify(article, null, 2));
      generatedArticleFiles.push(outputPath);

      console.log(`   ✅ 文章已保存: ${outputPath}\n`);
    } catch (err) {
      failedTopics.push({
        话题ID: topic.话题ID,
        话题: topic.话题,
        错误: err.message
      });
      console.error(`   ❌ 生成失败: ${err.message}\n`);
    }
  }

  if (generatedArticleFiles.length === 0) {
    throw new Error('没有成功生成任何文章');
  }

  const { batchPath } = await writeArticleBatch({
    date: today,
    articleFiles: generatedArticleFiles,
    sourcePath: inputPath,
    mode: 'sequential',
    metadata: {
      计划话题数: topTopics.length,
      成功文章数: generatedArticleFiles.length,
      失败话题: failedTopics
    }
  });

  console.log(`📦 本次文章清单已保存: ${batchPath}`);

  if (failedTopics.length > 0) {
    console.log(`⚠️  部分文章生成失败: ${failedTopics.length}/${topTopics.length}`);
    return;
  }

  console.log('✅ 所有文章生成完成！');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
