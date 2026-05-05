#!/usr/bin/env node

// ============================================================================
// Researcher Agent - 汽车内容研究员
// ============================================================================
// 使用 Claude API 实现智能 Agent
// 可以自主决策、调用工具、处理错误
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getRunDate } from '../../scripts/runtime-context.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ============================================================================
// 工具定义：Agent 可以调用的函数
// ============================================================================

const tools = [
  {
    name: 'search_tavily',
    description: '使用 Tavily API 搜索汽车相关新闻。返回标题、链接、摘要、发布时间。',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，例如："小米汽车 2026"'
        },
        max_results: {
          type: 'number',
          description: '返回结果数量，默认 5',
          default: 5
        }
      },
      required: ['query']
    }
  },
  {
    name: 'save_feed',
    description: '保存抓取的新闻数据到文件。',
    input_schema: {
      type: 'object',
      properties: {
        articles: {
          type: 'array',
          description: '新闻列表，每条包含 title, url, summary, published_date'
        }
      },
      required: ['articles']
    }
  },
  {
    name: 'get_current_date',
    description: '获取当前日期，格式 YYYY-MM-DD',
    input_schema: {
      type: 'object',
      properties: {}
    }
  }
];

// ============================================================================
// 工具实现：真正执行的函数
// ============================================================================

async function searchTavily(query, maxResults = 5) {
  console.log(`   🔍 Tavily 搜索: "${query}"`);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        days: 1
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.statusText}`);
    }

    const data = await response.json();
    const results = (data.results || []).map(item => ({
      title: item.title,
      url: item.url,
      summary: item.content || '',
      published_date: item.published_date || new Date().toISOString()
    }));

    console.log(`      ✓ 找到 ${results.length} 条结果`);
    return results;

  } catch (err) {
    console.log(`      ✗ 搜索失败: ${err.message}`);
    return [];
  }
}

async function saveFeed(articles) {
  const date = getRunDate();
  const outputDir = join(PROJECT_ROOT, 'data', 'feeds');
  const outputPath = join(outputDir, `feed-${date}.json`);

  await mkdir(outputDir, { recursive: true });

  const feedData = {
    生成时间: new Date().toISOString(),
    时间窗口: '24h',
    总文章数: articles.length,
    来源统计: {
      'Tavily搜索': articles.length
    },
    热点列表: articles.map((article, index) => ({
      id: `tavily_${Date.now()}_${index}`,
      标题: article.title,
      链接: article.url,
      来源: 'Tavily',
      来源类型: 'Tavily搜索',
      发布时间: article.published_date,
      内容摘要: article.summary,
      热度指数: 0.5,
      媒体类型: 'text',
      关键词: []
    }))
  };

  await writeFile(outputPath, JSON.stringify(feedData, null, 2));
  console.log(`   💾 已保存到: ${outputPath}`);

  return { success: true, path: outputPath, count: articles.length };
}

function getCurrentDate() {
  return getRunDate();
}

// ============================================================================
// Agent 核心：处理工具调用
// ============================================================================

async function processToolCall(toolName, toolInput) {
  switch (toolName) {
    case 'search_tavily':
      return await searchTavily(toolInput.query, toolInput.max_results || 5);

    case 'save_feed':
      return await saveFeed(toolInput.articles);

    case 'get_current_date':
      return getCurrentDate();

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================================
// Agent 主循环：思考 → 调用工具 → 再思考 → ...
// ============================================================================

export class ResearcherAgent {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
      baseURL: process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com'
    });

    this.model = 'claude-sonnet-4-20250514';
    this.maxIterations = 10; // 防止无限循环
  }

  async run(userPrompt) {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 Researcher Agent 启动');
    console.log('='.repeat(60));

    const messages = [
      {
        role: 'user',
        content: userPrompt
      }
    ];

    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;
      console.log(`\n--- 迭代 ${iteration} ---`);

      // 调用 Claude API
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        tools: tools,
        messages: messages
      });

      console.log(`Agent 思考: ${response.stop_reason}`);

      // 如果 Agent 完成了任务
      if (response.stop_reason === 'end_turn') {
        const finalMessage = response.content.find(c => c.type === 'text');
        console.log('\n✅ Agent 完成任务');
        console.log(finalMessage?.text || '');
        return { success: true, message: finalMessage?.text };
      }

      // 如果 Agent 需要调用工具
      if (response.stop_reason === 'tool_use') {
        // 添加 Agent 的响应到对话历史
        messages.push({
          role: 'assistant',
          content: response.content
        });

        // 执行所有工具调用
        const toolResults = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`\n🔧 调用工具: ${block.name}`);
            console.log(`   参数: ${JSON.stringify(block.input, null, 2)}`);

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

        // 将工具结果返回给 Agent
        messages.push({
          role: 'user',
          content: toolResults
        });

        // 继续下一轮循环，让 Agent 思考下一步
        continue;
      }

      // 其他情况（不应该发生）
      console.log('⚠️  未知的 stop_reason:', response.stop_reason);
      break;
    }

    if (iteration >= this.maxIterations) {
      console.log('\n❌ Agent 超过最大迭代次数');
      return { success: false, message: 'Max iterations reached' };
    }
  }

  getSystemPrompt() {
    return `你是汽车内容策展系统的研究员 Agent。

你的职责：
1. 抓取今天的汽车热点新闻
2. 目标：获取 50-80 条新闻（不要太多）
3. 数据源：Tavily 搜索

搜索策略（重要：只搜索一轮，不要重复搜索）：
- 使用 6-8 个关键词
- 每个关键词搜索 10 条
- 总计约 60-80 条

工作流程（严格按顺序，不要额外搜索）：
1. 调用 get_current_date 获取今天日期
2. 一次性调用多个 search_tavily（6-8个关键词）
3. 立即调用 save_feed 保存所有结果
4. 报告完成情况

重要：
- 只搜索一轮，不要判断"是否够100条"再搜索
- 50-80 条已经足够，不需要更多
- 搜索完立即保存，不要再搜索`;
  }
}

// ============================================================================
// 命令行入口
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new ResearcherAgent();

  const result = await agent.run(`
    请抓取今天的汽车热点新闻。
    目标：80-100 条新闻。
    使用多个关键词搜索，确保覆盖主流品牌和热点话题。
  `);

  if (result.success) {
    console.log('\n🎉 任务完成！');
    process.exit(0);
  } else {
    console.log('\n❌ 任务失败');
    process.exit(1);
  }
}
