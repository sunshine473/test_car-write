#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Coordinator Agent
// ============================================================================
// 协调整个工作流，管理所有子 Agent
// ============================================================================

import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// -- Agent 配置 ---------------------------------------------------------------

const AGENTS = {
  researcher: {
    name: 'Researcher Agent',
    script: 'scripts/generate-feed.js',
    timeout: 300000, // 5分钟
    retries: 3
  },
  analyst: {
    name: 'Analyst Agent',
    script: 'scripts/cluster-topics.js',
    timeout: 60000, // 1分钟
    retries: 3
  },
  evaluator: {
    name: 'Evaluator Agent',
    script: 'scripts/rank-topics.js',
    timeout: 120000, // 2分钟
    retries: 3
  },
  writer: {
    name: 'Writer Agent',
    script: 'scripts/write-articles.js',
    timeout: 600000, // 10分钟
    retries: 2
  },
  publisher: {
    name: 'Publisher Agent',
    script: 'scripts/deliver.js',
    timeout: 30000, // 30秒
    retries: 3
  }
};

// -- 工具函数 -----------------------------------------------------------------

class CoordinatorAgent {
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
    const { retryCount = 0 } = params;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 启动 ${agent.name}`);
    console.log(`${'='.repeat(60)}`);

    const startTime = Date.now();

    try {
      const result = await this.runScript(agent.script, agent.timeout);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`✅ ${agent.name} 完成 (耗时: ${duration}秒)`);

      return { success: true, result, duration };

    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`❌ ${agent.name} 失败: ${err.message} (耗时: ${duration}秒)`);

      // 重试逻辑
      if (retryCount < agent.retries) {
        const nextRetry = retryCount + 1;
        console.log(`🔄 重试 ${agent.name} (${nextRetry}/${agent.retries})...`);

        await this.sleep(5000 * nextRetry); // 指数退避

        return this.spawnAgent(agentType, { ...params, retryCount: nextRetry });
      }

      this.errors.push({
        agent: agent.name,
        error: err.message,
        duration
      });

      return { success: false, error: err.message, duration };
    }
  }

  // 并行启动多个 Writer Agents
  async spawnWriters(topics) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 并行启动 ${topics.length} 个 Writer Agents`);
    console.log(`${'='.repeat(60)}`);

    // 注意：这里我们复用同一个脚本，但它会处理所有话题
    // 真正的并行需要修改 write-articles.js 来支持单个话题
    const result = await this.spawnAgent('writer');

    return [result]; // 返回数组以保持接口一致
  }

  // 运行脚本
  runScript(scriptPath, timeout) {
    return new Promise((resolve, reject) => {
      const fullPath = join(PROJECT_ROOT, scriptPath);

      const child = spawn('node', [fullPath], {
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

  // 睡眠
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
      const writerDuration = this.results.writers[0].duration;
      console.log(`  Writers: ${writerDuration}秒`);
    }
    if (this.results.publisher) {
      console.log(`  Publisher: ${this.results.publisher.duration}秒`);
    }

    console.log(``);

    // 错误统计
    if (this.errors.length > 0) {
      console.log(`❌ 失败的 Agent:`);
      this.errors.forEach(err => {
        console.log(`  - ${err.agent}: ${err.error}`);
      });
    } else {
      console.log(`✅ 所有 Agent 执行成功`);
    }

    console.log(`\n${'='.repeat(60)}`);
  }

  // 主工作流
  async run() {
    console.log(`🚗 汽车内容策展系统 - Subagent 协调者`);
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
      const today = new Date().toISOString().split('T')[0];
      const rankedPath = join(PROJECT_ROOT, 'data', 'ranked', `ranked-${today}.json`);
      const rankedData = JSON.parse(await readFile(rankedPath, 'utf-8'));
      const topTopics = rankedData.推荐列表;

      console.log(`\n📋 Top ${topTopics.length} 话题:`);
      topTopics.forEach((topic, i) => {
        console.log(`  ${i + 1}. ${topic.话题} (得分: ${topic.最终得分})`);
      });

      // 阶段4: Writers (并行)
      this.results.writers = await this.spawnWriters(topTopics);

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

const coordinator = new CoordinatorAgent();
coordinator.run().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
