#!/usr/bin/env node

// ============================================================================
// Writer Agent - 汽车内容作家
// ============================================================================
// 为单个话题生成高质量文章
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getRunDate, getRunYear } from '../../scripts/runtime-context.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ============================================================================
// 工具定义
// ============================================================================

const tools = [
  {
    name: 'search_tavily_deep',
    description: '深度搜索话题相关素材，用于补充写作内容',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '话题名称'
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词列表'
        }
      },
      required: ['topic']
    }
  },
  {
    name: 'generate_article_with_gemini',
    description: '使用 Gemini 生成文章初稿',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        materials: {
          type: 'array',
          description: '参考素材列表'
        },
        word_count: {
          type: 'number',
          description: '目标字数',
          default: 900
        }
      },
      required: ['topic', 'materials']
    }
  },
  {
    name: 'save_article',
    description: '保存生成的文章',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        article: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            word_count: { type: 'number' }
          }
        }
      },
      required: ['topic', 'article']
    }
  }
];

// ============================================================================
// 工具实现
// ============================================================================

async function searchTavilyDeep(topic, keywords = []) {
  console.log(`   🔍 深度搜索: ${topic}`);

  const queries = [
    topic,
    ...keywords.slice(0, 2).map(k => `${k} ${getRunYear()}`),
    `${topic} 最新消息`
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
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
  const unique = allResults.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  console.log(`      ✓ 找到 ${unique.length} 篇素材`);
  return unique;
}

async function generateArticleWithGemini(topic, materials, wordCount = 900) {
  console.log(`   ✍️  Gemini 生成文章...`);

  const materialsText = materials
    .slice(0, 20)
    .map((m, i) => `${i + 1}. ${m.title}\n   ${m.content || m.summary || ''}`)
    .join('\n\n');

  const prompt = `请根据以下素材，为话题"${topic}"写一篇${wordCount}字左右的文章。

参考素材：
${materialsText}

要求：
1. 字数：${wordCount}字左右
2. 结构：标题 + 正文
3. 风格：专业、客观、有深度
4. 内容：基于素材，不要编造
5. 格式：返回 JSON: {"title": "...", "content": "..."}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    // 提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const article = JSON.parse(jsonMatch[0]);
      console.log(`      ✓ 生成成功 (${article.content.length}字)`);
      return article;
    }

    throw new Error('无法解析 Gemini 返回的 JSON');
  } catch (err) {
    console.log(`      ✗ Gemini 失败: ${err.message}`);
    throw err;
  }
}

async function saveArticle(topic, article) {
  const date = getRunDate();
  const outputDir = join(PROJECT_ROOT, 'data', 'articles');
  const topicId = topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const outputPath = join(outputDir, `article-${topicId}-${date}.json`);

  await mkdir(outputDir, { recursive: true });

  const articleData = {
    生成时间: new Date().toISOString(),
    话题: topic,
    通用版本: {
      标题: article.title,
      正文: article.content,
      字数: article.content.length
    }
  };

  await writeFile(outputPath, JSON.stringify(articleData, null, 2));
  console.log(`   💾 已保存到: ${outputPath}`);

  return { success: true, path: outputPath };
}

// ============================================================================
// Agent 核心
// ============================================================================

async function processToolCall(toolName, toolInput) {
  switch (toolName) {
    case 'search_tavily_deep':
      return await searchTavilyDeep(toolInput.topic, toolInput.keywords);

    case 'generate_article_with_gemini':
      return await generateArticleWithGemini(
        toolInput.topic,
        toolInput.materials,
        toolInput.word_count
      );

    case 'save_article':
      return await saveArticle(toolInput.topic, toolInput.article);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export class WriterAgent {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
      baseURL: process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com'
    });

    this.model = 'claude-sonnet-4-20250514';
    this.maxIterations = 10;
  }

  async run(topic, keywords = []) {
    console.log('\n' + '='.repeat(60));
    console.log(`🤖 Writer Agent 启动 - 话题: ${topic}`);
    console.log('='.repeat(60));

    const messages = [
      {
        role: 'user',
        content: `请为话题"${topic}"写一篇文章。

关键词：${keywords.join(', ')}

工作流程：
1. 使用 search_tavily_deep 搜索素材（目标 20+ 篇）
2. 使用 generate_article_with_gemini 生成文章（800-1000字）
3. 使用 save_article 保存文章
4. 报告完成情况`
      }
    ];

    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;
      console.log(`\n--- 迭代 ${iteration} ---`);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        tools: tools,
        messages: messages
      });

      console.log(`Agent 思考: ${response.stop_reason}`);

      if (response.stop_reason === 'end_turn') {
        const finalMessage = response.content.find(c => c.type === 'text');
        console.log('\n✅ Agent 完成任务');
        console.log(finalMessage?.text || '');
        return { success: true, message: finalMessage?.text };
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({
          role: 'assistant',
          content: response.content
        });

        const toolResults = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`\n🔧 调用工具: ${block.name}`);

            try {
              const result = await processToolCall(block.name, block.input);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result)
              });

              console.log(`   ✓ 工具执行成功`);
            } catch (err) {
              console.log(`   ✗ 工具执行失败: ${err.message}`);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${err.message}`,
                is_error: true
              });
            }
          }
        }

        messages.push({
          role: 'user',
          content: toolResults
        });

        continue;
      }

      console.log('⚠️  未知的 stop_reason:', response.stop_reason);
      break;
    }

    if (iteration >= this.maxIterations) {
      console.log('\n❌ Agent 超过最大迭代次数');
      return { success: false, message: 'Max iterations reached' };
    }
  }

  getSystemPrompt() {
    return `你是汽车内容策展系统的作家 Agent。

你的职责：
1. 为单个话题生成高质量文章
2. 字数：800-1000字
3. 素材：20+ 篇参考资料

工作流程：
1. 深度搜索素材
2. 生成文章初稿
3. 保存文章
4. 报告完成情况

重要：
- 确保素材充足（≥20篇）
- 文章字数符合要求
- 内容基于素材，不编造`;
  }
}

// ============================================================================
// 命令行入口
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const topic = process.argv[2] || '小米SU7新车发布';
  const keywords = process.argv.slice(3);

  const agent = new WriterAgent();
  const result = await agent.run(topic, keywords);

  if (result.success) {
    console.log('\n🎉 任务完成！');
    process.exit(0);
  } else {
    console.log('\n❌ 任务失败');
    process.exit(1);
  }
}
