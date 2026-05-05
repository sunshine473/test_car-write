#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Writer Agent (Single Topic)
// ============================================================================
// 为单个话题生成文章（支持并行执行）
// 用法: node write-single.js <topicId>
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { callClaudeWithFallback, callGeminiWithFallback } from './llm-fallback.js';
import { extractJSONFromText } from './json-utils.js';
import { getRunDate, getRunYear } from './runtime-context.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(__dirname, '..', 'data', 'ranked');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'articles');
const CONFIG_PATH = join(__dirname, '..', 'config', 'writing-prompts.json');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// 获取命令行参数
const topicId = process.argv[2];

if (!topicId) {
  console.error('❌ 用法: node write-single.js <topicId>');
  process.exit(1);
}

// 导入现有的函数（从 write-articles.js）
async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

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

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`      ✗ "${query}": HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        allResults.push(...data.results);
        console.log(`      ✓ "${query}": ${data.results.length} 条`);
      } else {
        console.log(`      ⚠️  "${query}": 无结果`);
      }
    } catch (err) {
      console.log(`      ✗ "${query}": ${err.message}`);
      // 继续下一个查询
    }
  }

  const seen = new Set();
  const uniqueResults = allResults.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  console.log(`      ✓ 找到 ${uniqueResults.length} 篇新素材`);
  return uniqueResults;
}

async function generateArticle(topic, config) {
  console.log(`\n📝 生成文章: ${topic.话题}`);
  console.log('='.repeat(60));

  const tavilyResults = await tavilyDeepSearch(topic);

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

  console.log(`   🤖 Gemini 生成初稿...`);

  const materialsText = allMaterials.map((m, i) =>
    `${i + 1}. ${m.标题}\n   来源: ${m.来源}\n   摘要: ${m.摘要.slice(0, 200)}...`
  ).join('\n\n');

  // 改进的 Prompt，明确要求返回纯 JSON
  const improvedPrompt = `
你是一个专业的汽车内容作家。请根据以下素材生成一篇文章。

话题：${topic.话题}
建议角度：${topic.建议角度 || '全面分析'}
素材数量：${allMaterials.length}

素材列表：
${materialsText}

要求：
1. 字数：800-1000字
2. 结构清晰，逻辑连贯
3. 语言专业但易懂
4. 包含数据和事实

重要：你必须返回一个严格的 JSON 对象，不要包含任何其他文字。

返回格式（直接返回JSON，不要用markdown代码块）：
{
  "标题": "文章标题（吸引人，10-20字）",
  "正文": "文章正文内容（800-1000字，段落之间用\\n\\n分隔）",
  "字数": 900
}

现在请生成文章（只返回JSON对象，不要其他内容）：
`;

  let draft;
  try {
    const geminiResponse = await callGeminiWithFallback(improvedPrompt, {
      model: 'gemini-2.5-flash',
      maxTokens: 2048
    });
    draft = extractJSONFromText(geminiResponse);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  } catch (err) {
    console.log(`      ✗ Gemini 失败: ${err.message}`);
    console.log(`      ⚠️  使用 Claude 生成初稿...`);
    const claudeResponse = await callClaudeWithFallback(improvedPrompt, {
      model: 'claude-opus-4-20250514',
      maxTokens: 2048
    });
    draft = extractJSONFromText(claudeResponse);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  }

  console.log(`   ✨ Claude 优化润色...`);

  const claudePrompt = config.claude_polish_prompt
    .replace('{{gemini_draft}}', JSON.stringify(draft, null, 2));

  const polishedResponse = await callClaudeWithFallback(claudePrompt, {
    model: 'claude-opus-4-20250514',
    maxTokens: 2048
  });
  const polished = extractJSONFromText(polishedResponse);

  console.log(`      ✓ 润色完成 (${polished.字数}字)`);

  console.log(`   🎨 生成多平台版本...`);

  const platforms = {};
  for (const [platformName, platformConfig] of Object.entries(config.platform_prompts)) {
    try {
      const platformPrompt = platformConfig.prompt.replace('{{article}}', polished.正文);
      const platformResponse = await callClaudeWithFallback(platformPrompt, {
        model: 'claude-opus-4-20250514',
        maxTokens: 2048
      });
      const platformArticle = extractJSONFromText(platformResponse);
      platforms[platformName] = platformArticle;
      console.log(`      ✓ ${platformName}: ${platformArticle.字数}字`);
    } catch (err) {
      console.log(`      ✗ ${platformName}: ${err.message}`);
    }
  }

  const qualityCheck = {
    字数: polished.字数 >= 800 && polished.字数 <= 1000 ? '✅ 符合要求' : `⚠️ ${polished.字数}字`,
    素材数: allMaterials.length >= 20 ? '✅ 符合要求' : `⚠️ ${allMaterials.length}篇`,
    平台版本: Object.keys(platforms).length === 5 ? '✅ 全部生成' : `⚠️ ${Object.keys(platforms).length}/5`
  };

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

async function main() {
  console.log(`🚗 Writer Agent - 单话题模式`);
  console.log(`话题ID: ${topicId}`);

  const config = await loadConfig();

  const today = getRunDate();
  const inputPath = join(INPUT_DIR, `ranked-${today}.json`);

  const rankedData = JSON.parse(await readFile(inputPath, 'utf-8'));
  const topic = rankedData.推荐列表.find(t => t.话题ID === topicId);

  if (!topic) {
    throw new Error(`找不到话题: ${topicId}`);
  }

  const article = await generateArticle(topic, config);
  article.运行日期 = today;

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `article-${topic.话题ID}-${today}.json`);
  await writeFile(outputPath, JSON.stringify(article, null, 2));

  console.log(`   ✅ 文章已保存: ${outputPath}\n`);
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
