#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 5: Deliver to Telegram
// ============================================================================
// 将生成的文章全文直接推送到 Telegram
// ============================================================================

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getRunDate, readArticleBatch, resolveProjectPath } from './article-batch.js';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'data', 'articles');
const CONFIG_PATH = join(__dirname, '..', 'config', 'telegram-config.json');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function validateTelegramEnv() {
  const missing = [];
  if (!TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');

  if (missing.length > 0) {
    throw new Error(`缺少 Telegram 环境变量: ${missing.join(', ')}`);
  }
}

// -- Load Config -------------------------------------------------------------

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

// -- Send Telegram Message ---------------------------------------------------

async function sendTelegramMessage(text, options = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      ...options
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }

  return response.json();
}

// -- Format Article ----------------------------------------------------------

function formatArticle(article, rank) {
  const title = article.通用版本?.标题 || '无标题';
  const topic = article.话题 || '未知话题';
  const runDate = article.运行日期 || article.生成时间?.slice(0, 10) || '未知日期';
  const wordCount = article.通用版本?.字数 || 0;
  const materialCount = article.素材统计?.总计 || 0;
  const content = article.通用版本?.正文 || '';

  return `🏆 今日推荐 #${rank}

📌 话题：${topic}
📅 日期：${runDate}

━━━━━━━━━━━━━━━━

📝 标题：
${title}

📄 全文：
${content}

━━━━━━━━━━━━━━━━

📊 字数：${wordCount}字
📚 参考素材：${materialCount}篇
🤖 生成模型：Gemini + Claude`;
}

function splitLongText(text, maxLength = 4000) {
  const paragraphs = text.split('\n\n').filter(paragraph => paragraph.trim());
  const chunks = [];
  let current = '';

  const appendChunk = (chunk) => {
    if (chunk.trim()) {
      chunks.push(chunk.trimEnd());
    }
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      appendChunk(current);
      current = '';
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += maxLength) {
      appendChunk(paragraph.slice(index, index + maxLength));
    }
  }

  appendChunk(current);

  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) => (
    index === 0 ? chunk : `（续 ${index + 1}/${chunks.length}）\n\n${chunk}`
  ));
}

async function sendArticle(article, config, rank) {
  console.log(`📤 发送文章 ${rank}: ${article.话题}`);

  const maxLength = Math.min(config.send_options?.max_message_length || 4096, 4000);
  const chunks = splitLongText(formatArticle(article, rank), maxLength);

  for (let index = 0; index < chunks.length; index++) {
    await sendTelegramMessage(chunks[index]);
    if (index < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log('   ✓ 发送成功');
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 5: Deliver to Telegram');
  console.log('========================================================\n');

  validateTelegramEnv();

  // 1. 读取配置
  const config = await loadConfig();
  console.log('📋 配置加载完成');

  // 2. 读取本次批次清单
  const today = getRunDate();
  const { batchPath, payload } = await readArticleBatch(today);
  const articleFiles = (payload.文章文件 || []).map(resolveProjectPath);

  if (articleFiles.length === 0) {
    throw new Error(`本次批次没有可发送的文章: ${batchPath}`);
  }

  console.log(`📦 使用文章清单: ${batchPath}`);
  console.log(`📂 找到 ${articleFiles.length} 篇本次文章\n`);

  // 3. 发送每篇文章全文
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < articleFiles.length; i++) {
    const filePath = articleFiles[i];
    const article = JSON.parse(await readFile(filePath, 'utf-8'));

    try {
      await sendArticle(article, config, i + 1);
      successCount++;
    } catch (err) {
      failureCount++;
      console.error(`   ✗ 发送失败: ${err.message}`);
    }

    // 避免限流
    if (i < articleFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n📊 发送结果: 成功 ${successCount} 篇, 失败 ${failureCount} 篇`);

  if (successCount === 0) {
    throw new Error('Telegram 推送失败：没有任何文章发送成功');
  }

  if (failureCount > 0) {
    throw new Error(`Telegram 推送部分失败：${failureCount} 篇发送失败`);
  }

  console.log('\n✅ 所有文章已推送到 Telegram！');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
