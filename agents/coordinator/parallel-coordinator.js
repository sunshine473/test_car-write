#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Parallel Coordinator Agent
// ============================================================================
// 协调整个工作流，支持并行执行 Writer Agents
// ============================================================================

import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getRunDate, writeArticleBatch } from '../../scripts/article-batch.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// -- Agent 配置 ---------------------------------------------------------------

const AGENTS = {
  researcher: {
    name: 'Researcher Agent',
    script: 'scripts/generate-feed.js',
    timeout: 300000,
    retries: 3
  },
  analyst: {
    name: 'Analyst Agent',
    script: 'scripts/cluster-topics.js',
    timeout: 60000,
    retries: 3
  },
  evaluator: {
    name: 'Evaluator Agent',
    script: 'scripts/rank-topics.js',
    timeout: 300000, // 增加到 300 秒（5分钟）
    retries: 3
  },
  writer: {
    name: 'Writer Agent',
    script: 'scripts/write-single.js',
    timeout: 600000,
    retries: 2
  },
  publisher: {
    name: 'Publisher Agent',
    script: 'scripts/deliver.js',
    timeout: 30000,
    retries: 3
  }
};

// -- 工具函数 -----------------------------------------------------------------

class ParallelCoordinator {
  constructor() {
    this.startTime = Date.now();
    this.results = {
      researcher: null,
      analyst: null,
      evaluator: null,
      writers: [],
      publisher: null
    };
    this.errors = [];
  }

  // 启动单个 Agent
  async spawnAgent(agentType, params = {}) {
    const agent = AGENTS[agentType];
    const { retryCount = 0, args = [] } = params;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 启动 ${agent.name}${args.length > 0 ? ` (${args.join(' ')})` : ''}`);
    console.log(`${'='.repeat(60)}`);

    const startTime = Date.now();

    try {
      const result = await this.runScript(agent.script, args, agent.timeout);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`✅ ${agent.name} 完成 (耗时: ${duration}秒)`);

      return { success: true, result, duration, args };

    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`❌ ${agent.name} 失败: ${err.message} (耗时: ${duration}秒)`);

      // 重试逻辑
      if (retryCount < agent.retries) {
        const nextRetry = retryCount + 1;
        console.log(`🔄 重试 ${agent.name} (${nextRetry}/${agent.retries})...`);

        await this.sleep(5000 * nextRetry);

        return this.spawnAgent(agentType, { ...params, retryCount: nextRetry });
      }

      this.errors.push({
        agent: agent.name,
        error: err.message,
        duration,
        args
      });

      return { success: false, error: err.message, duration, args };
    }
  }

  // 并行启动多个 Writer Agents
  async spawnWritersParallel(topics) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 并行启动 ${topics.length} 个 Writer Agents`);
    console.log(`${'='.repeat(60)}`);

    const writerPromises = topics.map(topic =>
      this.spawnAgent('writer', { args: [topic.话题ID] })
    );

    // 等待所有 Writer 完成（允许部分失败）
    const results = await Promise.allSettled(writerPromises);

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failCount = results.length - successCount;

    console.log(`\n📊 Writer 执行结果:`);
    console.log(`   ✅ 成功: ${successCount}/${topics.length}`);
    if (failCount > 0) {
      console.log(`   ❌ 失败: ${failCount}/${topics.length}`);
    }

    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason });
  }

  // 运行脚本
  runScript(scriptPath, args = [], timeout) {
    return new Promise((resolve, reject) => {
      const fullPath = join(PROJECT_ROOT, scriptPath);

      const child = spawn('node', [fullPath, ...args], {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: 'inherit'
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`超时 (${timeout}ms)`));
      }, timeout);

      child.on('exit', (code) => {
        clearTimeout(timer);

        if (code === 0) {
          resolve({ code });
        } else {
          reject(new Error(`退出码: ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 生成报告
  generateReport() {
    const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(1);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 执行报告`);
    console.log(`${'='.repeat(60)}`);
    console.log(`总耗时: ${totalDuration}秒`);
    console.log(``);

    // 各阶段耗时
    console.log(`各阶段耗时:`);
    if (this.results.researcher) {
      console.log(`  Researcher: ${this.results.researcher.duration}秒`);
    }
    if (this.results.analyst) {
      console.log(`  Analyst: ${this.results.analyst.duration}秒`);
    }
    if (this.results.evaluator) {
      console.log(`  Evaluator: ${this.results.evaluator.duration}秒`);
    }
    if (this.results.writers.length > 0) {
      const successWriters = this.results.writers.filter(w => w.success);
      const maxDuration = Math.max(...successWriters.map(w => parseFloat(w.duration)));
      console.log(`  Writers (并行): ${maxDuration.toFixed(1)}秒`);
      console.log(`    成功: ${successWriters.length}/${this.results.writers.length}`);
    }
    if (this.results.publisher) {
      console.log(`  Publisher: ${this.results.publisher.duration}秒`);
    }

    console.log(``);

    // 性能提升
    if (this.results.writers.length > 0) {
      const successWriters = this.results.writers.filter(w => w.success);
      const totalWriterTime = successWriters.reduce((sum, w) => sum + parseFloat(w.duration), 0);
      const parallelTime = Math.max(...successWriters.map(w => parseFloat(w.duration)));
      const timeSaved = totalWriterTime - parallelTime;

      console.log(`⚡ 并行执行优势:`);
      console.log(`  串行耗时: ${totalWriterTime.toFixed(1)}秒`);
      console.log(`  并行耗时: ${parallelTime.toFixed(1)}秒`);
      console.log(`  节省时间: ${timeSaved.toFixed(1)}秒 (${((timeSaved / totalWriterTime) * 100).toFixed(0)}%)`);
      console.log(``);
    }

    // 错误统计
    if (this.errors.length > 0) {
      console.log(`❌ 失败的 Agent:`);
      this.errors.forEach(err => {
        const argsStr = err.args && err.args.length > 0 ? ` (${err.args.join(' ')})` : '';
        console.log(`  - ${err.agent}${argsStr}: ${err.error}`);
      });
    } else {
      console.log(`✅ 所有 Agent 执行成功`);
    }

    console.log(`\n${'='.repeat(60)}`);
  }

  // 主工作流
  async run() {
    console.log(`🚗 汽车内容策展系统 - 并行协调者`);
    console.log(`${'='.repeat(60)}`);
    console.log(`开始时间: ${new Date().toLocaleString('zh-CN')}`);

    try {
      // 阶段1: Researcher
      this.results.researcher = await this.spawnAgent('researcher');
      if (!this.results.researcher.success) {
        throw new Error('Researcher Agent 失败，无法继续');
      }

      // 阶段2: Analyst
      this.results.analyst = await this.spawnAgent('analyst');
      if (!this.results.analyst.success) {
        throw new Error('Analyst Agent 失败，无法继续');
      }

      // 阶段3: Evaluator
      this.results.evaluator = await this.spawnAgent('evaluator');
      if (!this.results.evaluator.success) {
        throw new Error('Evaluator Agent 失败，无法继续');
      }

      // 读取 Top 3 话题
      const today = getRunDate();
      const rankedPath = join(PROJECT_ROOT, 'data', 'ranked', `ranked-${today}.json`);
      const rankedData = JSON.parse(await readFile(rankedPath, 'utf-8'));
      const topTopics = rankedData.推荐列表;

      // 检查是否有话题
      if (!topTopics || topTopics.length === 0) {
        console.log(`\n⚠️  今天没有推荐话题`);
        console.log(`💡 可能原因：`);
        console.log(`   1. 新数据太少（去重后不足）`);
        console.log(`   2. 话题质量不够高`);
        console.log(`   3. 评分标准过于严格`);
        console.log(`\n💡 建议：`);
        console.log(`   1. 调整去重策略（放宽标准）`);
        console.log(`   2. 降低评分阈值`);
        console.log(`   3. 明天再运行`);

        this.generateReport();
        return;
      }

      console.log(`\n📋 Top ${topTopics.length} 话题:`);
      topTopics.forEach((topic, i) => {
        console.log(`  ${i + 1}. ${topic.话题} (得分: ${topic.最终得分})`);
      });

      // 阶段4: Writers (并行)
      this.results.writers = await this.spawnWritersParallel(topTopics);

      // 检查是否至少有一篇文章成功
      const successCount = this.results.writers.filter(w => w.success).length;
      if (successCount === 0) {
        throw new Error('所有 Writer Agent 都失败了');
      }

      const generatedArticleFiles = this.results.writers
        .filter(w => w.success && w.args && w.args.length > 0)
        .map(w => join(PROJECT_ROOT, 'data', 'articles', `article-${w.args[0]}-${today}.json`));

      const { batchPath } = await writeArticleBatch({
        date: today,
        articleFiles: generatedArticleFiles,
        sourcePath: rankedPath,
        mode: 'parallel',
        metadata: {
          计划话题数: topTopics.length,
          成功文章数: generatedArticleFiles.length,
          失败Writer数: this.results.writers.length - generatedArticleFiles.length
        }
      });

      console.log(`\n📦 本次文章清单已保存: ${batchPath}`);

      // 阶段5: Publisher
      this.results.publisher = await this.spawnAgent('publisher');

      // 生成报告
      this.generateReport();

      console.log(`\n✅ 所有任务完成！`);
      console.log(`💡 请查看 Telegram 消息`);

    } catch (err) {
      console.error(`\n❌ 工作流失败: ${err.message}`);
      this.generateReport();
      process.exit(1);
    }
  }
}

// -- Main --------------------------------------------------------------------

const coordinator = new ParallelCoordinator();
coordinator.run().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
