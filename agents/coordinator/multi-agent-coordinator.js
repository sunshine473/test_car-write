#!/usr/bin/env node

// ============================================================================
// Coordinator Agent - 汽车内容策展系统协调者
// ============================================================================
// 管理整个工作流：Researcher → Analyst → Evaluator → Writer×3 → Publisher
// ============================================================================

import { ResearcherAgent } from '../researcher/researcher-agent.js';
import { WriterAgent } from '../writer/writer-agent.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ============================================================================
// Coordinator Agent
// ============================================================================

export class CoordinatorAgent {
  constructor() {
    this.startTime = Date.now();
    this.results = {
      researcher: null,
      writers: []
    };
  }

  async run() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 汽车内容策展系统 - 多 Agent 协作模式');
    console.log('='.repeat(80));

    try {
      // ========================================================================
      // 阶段 1：研究阶段（Researcher Agent）
      // ========================================================================
      console.log('\n📊 阶段 1/3：研究阶段');
      console.log('-'.repeat(80));

      const researcher = new ResearcherAgent();
      const researchResult = await researcher.run(`
        请抓取今天的汽车热点新闻。
        目标：50-80 条新闻。

        搜索关键词（6-8个）：
        - 小米汽车
        - 理想汽车
        - 蔚来汽车
        - 比亚迪
        - 特斯拉
        - 新能源汽车

        重要：只搜索一轮，搜索完立即保存，不要重复搜索。
      `);

      if (!researchResult.success) {
        throw new Error('Researcher Agent 失败');
      }

      this.results.researcher = researchResult;

      // ========================================================================
      // 阶段 2：分析和评估（简化版 - 直接选 Top 3 话题）
      // ========================================================================
      console.log('\n📈 阶段 2/3：分析和评估');
      console.log('-'.repeat(80));

      // 读取抓取的数据
      const date = new Date().toISOString().split('T')[0];
      const feedPath = join(PROJECT_ROOT, 'data', 'feeds', `feed-${date}.json`);
      const feedData = JSON.parse(await readFile(feedPath, 'utf-8'));

      // 简化版：直接从新闻中提取 Top 3 话题
      const topics = this.extractTopTopics(feedData.热点列表, 3);

      console.log(`\n✅ 选出 Top ${topics.length} 话题：`);
      topics.forEach((topic, i) => {
        console.log(`   ${i + 1}. ${topic.话题} (关键词: ${topic.关键词.join(', ')})`);
      });

      // ========================================================================
      // 阶段 3：写作阶段（Writer Agents 并行）
      // ========================================================================
      console.log('\n✍️  阶段 3/3：写作阶段（并行执行）');
      console.log('-'.repeat(80));

      // 🔥 关键：并行启动 3 个 Writer Agent
      const writerPromises = topics.map((topic, index) => {
        const writer = new WriterAgent();
        return writer
          .run(topic.话题, topic.关键词)
          .then(result => ({
            index,
            topic: topic.话题,
            success: true,
            result
          }))
          .catch(err => ({
            index,
            topic: topic.话题,
            success: false,
            error: err.message
          }));
      });

      // 等待所有 Writer 完成
      const writerResults = await Promise.all(writerPromises);

      this.results.writers = writerResults;

      // ========================================================================
      // 生成最终报告
      // ========================================================================
      this.generateReport();

      return { success: true };
    } catch (err) {
      console.log(`\n❌ 系统错误: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // 从新闻列表中提取 Top N 话题
  extractTopTopics(articles, topN = 3) {
    // 简化版：按关键词频率聚类
    const keywordMap = new Map();

    articles.forEach(article => {
      const title = article.标题 || '';

      // 提取品牌关键词
      const brands = [
        '小米',
        '理想',
        '蔚来',
        '比亚迪',
        '特斯拉',
        '华为',
        '问界',
        '吉利',
        '长城'
      ];

      brands.forEach(brand => {
        if (title.includes(brand)) {
          if (!keywordMap.has(brand)) {
            keywordMap.set(brand, []);
          }
          keywordMap.get(brand).push(article);
        }
      });
    });

    // 选出文章数最多的 Top N 品牌
    const sortedBrands = Array.from(keywordMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, topN);

    // 生成话题
    return sortedBrands.map(([brand, articles]) => {
      // 提取共同关键词
      const keywords = [brand];

      // 从标题中提取其他关键词
      const titleWords = articles
        .map(a => a.标题)
        .join(' ')
        .match(/新车|发布|销量|电动|自动驾驶|续航|上市/g);

      if (titleWords && titleWords.length > 0) {
        const topWord = titleWords
          .reduce((acc, word) => {
            acc[word] = (acc[word] || 0) + 1;
            return acc;
          }, {});

        const sortedWords = Object.entries(topWord)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([word]) => word);

        keywords.push(...sortedWords);
      }

      return {
        话题: `${brand}${keywords[1] || '最新动态'}`,
        关键词: keywords,
        文章数: articles.length
      };
    });
  }

  // 生成最终报告
  generateReport() {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(80));
    console.log('📋 执行报告');
    console.log('='.repeat(80));

    console.log(`\n⏱️  总耗时: ${totalTime}秒`);

    console.log('\n📊 各阶段结果:');
    console.log(`   ✅ Researcher Agent: 成功`);

    const successCount = this.results.writers.filter(w => w.success).length;
    const failCount = this.results.writers.filter(w => !w.success).length;

    console.log(
      `   ${successCount > 0 ? '✅' : '❌'} Writer Agents: ${successCount}/${this.results.writers.length} 成功`
    );

    if (failCount > 0) {
      console.log('\n⚠️  失败的任务:');
      this.results.writers
        .filter(w => !w.success)
        .forEach(w => {
          console.log(`   - ${w.topic}: ${w.error}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log(
      `🎉 系统完成！生成 ${successCount} 篇文章，耗时 ${totalTime}秒`
    );
    console.log('='.repeat(80) + '\n');
  }
}

// ============================================================================
// 命令行入口
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const coordinator = new CoordinatorAgent();
  const result = await coordinator.run();

  process.exit(result.success ? 0 : 1);
}
