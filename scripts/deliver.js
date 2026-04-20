#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 5: Deliver to Telegram
// ============================================================================
// 将生成的文章推送到 Telegram
// 交互式推送：摘要 + 按钮 + 完整文章
// ============================================================================

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'data', 'articles');
const CONFIG_PATH = join(__dirname, '..', 'config', 'telegram-config.json');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// -- Load Config -------------------------------------------------------------

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

// -- Escape Markdown ---------------------------------------------------------

function escapeMarkdown(text) {
  // Telegram Markdown 需要转义的字符
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
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
      parse_mode: 'MarkdownV2',
      ...options
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }

  return response.json();
}

// -- Format Summary ----------------------------------------------------------

function formatSummary(article, config) {
  const template = config.message_templates.summary;

  const summary = template
    .replace('{{topic}}', article.话题)
    .replace('{{title}}', article.通用版本.标题)
    .replace('{{word_count}}', article.通用版本.字数)
    .replace('{{material_count}}', article.素材统计.总计)
    .replace('{{preview}}', article.通用版本.正文.slice(0, 150) + '...');

  return escapeMarkdown(summary);
}

// -- Create Buttons ----------------------------------------------------------

function createButtons(article, config) {
  const buttons = [];

  // 第一行：查看不同平台版本
  const platformRow = [];
  if (article.知乎版本) {
    platformRow.push({
      text: '📖 知乎版',
      callback_data: `view_zhihu_${article.话题ID}`
    });
  }
  if (article.小红书版本) {
    platformRow.push({
      text: '📷 小红书版',
      callback_data: `view_xiaohongshu_${article.话题ID}`
    });
  }
  if (article.微信公众号版本) {
    platformRow.push({
      text: '💬 微信版',
      callback_data: `view_weixin_${article.话题ID}`
    });
  }
  if (platformRow.length > 0) {
    buttons.push(platformRow);
  }

  // 第二行：通用版本
  buttons.push([
    {
      text: '📄 查看完整文章',
      callback_data: `view_full_${article.话题ID}`
    }
  ]);

  // 第三行：反馈
  buttons.push([
    {
      text: '👍 有用',
      callback_data: `feedback_useful_${article.话题ID}`
    },
    {
      text: '👎 无用',
      callback_data: `feedback_useless_${article.话题ID}`
    }
  ]);

  return buttons;
}

// -- Send Article Summary ----------------------------------------------------

async function sendArticleSummary(article, config, rank) {
  console.log(`📤 发送文章 ${rank}: ${article.话题}`);

  // 1. 格式化摘要
  const summaryText = `🏆 *今日推荐 \\#${rank}*\n\n` + formatSummary(article, config);

  // 2. 创建按钮
  const buttons = createButtons(article, config);

  // 3. 发送消息
  try {
    await sendTelegramMessage(summaryText, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    console.log(`   ✓ 发送成功`);
  } catch (err) {
    console.log(`   ✗ 发送失败: ${err.message}`);
  }
}

// -- Send Full Article -------------------------------------------------------

async function sendFullArticle(article, platform = 'general') {
  let content;
  let title;

  switch (platform) {
    case 'zhihu':
      content = article.知乎版本?.正文 || article.通用版本.正文;
      title = article.知乎版本?.标题 || article.通用版本.标题;
      break;
    case 'xiaohongshu':
      content = article.小红书版本?.正文 || article.通用版本.正文;
      title = article.小红书版本?.标题 || article.通用版本.标题;
      break;
    case 'weixin':
      content = article.微信公众号版本?.正文 || article.通用版本.正文;
      title = article.微信公众号版本?.标题 || article.通用版本.标题;
      break;
    default:
      content = article.通用版本.正文;
      title = article.通用版本.标题;
  }

  const fullText = `*${title}*\n\n${content}`;

  // Telegram 消息长度限制 4096 字符
  if (fullText.length > 4000) {
    // 分段发送
    const chunks = [];
    let currentChunk = `*${title}*\n\n`;
    const paragraphs = content.split('\n\n');

    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > 4000) {
        chunks.push(currentChunk);
        currentChunk = para + '\n\n';
      } else {
        currentChunk += para + '\n\n';
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    for (const chunk of chunks) {
      await sendTelegramMessage(chunk);
      await new Promise(resolve => setTimeout(resolve, 500)); // 避免限流
    }
  } else {
    await sendTelegramMessage(fullText);
  }
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 5: Deliver to Telegram');
  console.log('========================================================\n');

  // 1. 读取配置
  const config = await loadConfig();
  console.log('📋 配置加载完成');

  // 2. 读取所有文章
  const articleFiles = readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.json'));

  if (articleFiles.length === 0) {
    console.log('❌ 没有找到文章文件');
    return;
  }

  console.log(`📂 找到 ${articleFiles.length} 篇文章\n`);

  // 3. 发送每篇文章的摘要
  for (let i = 0; i < articleFiles.length; i++) {
    const filePath = join(ARTICLES_DIR, articleFiles[i]);
    const article = JSON.parse(await readFile(filePath, 'utf-8'));

    await sendArticleSummary(article, config, i + 1);

    // 避免限流
    if (i < articleFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n✅ 所有文章已推送到 Telegram！');
  console.log('\n💡 提示：');
  console.log('   - 点击按钮查看不同平台版本');
  console.log('   - 点击"查看完整文章"阅读全文');
  console.log('   - 点击"有用/无用"提供反馈');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
