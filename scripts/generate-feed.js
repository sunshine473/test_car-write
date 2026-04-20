#!/usr/bin/env node

// ============================================================================
// Car Content Curator — Module 1: Generate Feed (Playwright版)
// ============================================================================
// 使用 Playwright 抓取懂车帝创作者内容
// 云端可用、稳定可靠
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

// -- Constants ---------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOOKBACK_HOURS = 24;
const STATE_PATH = join(__dirname, '..', 'state', 'state-feed.json');
const CONFIG_PATH = join(__dirname, '..', 'config', 'car-sources.json');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'feeds');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// -- State Management --------------------------------------------------------

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { seenArticles: {} };
  }
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch {
    return { seenArticles: {} };
  }
}

async function saveState(state) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenArticles)) {
    if (ts < cutoff) delete state.seenArticles[id];
  }
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// -- Load Sources ------------------------------------------------------------

async function loadSources() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

// -- Fetch Dongchedi Creator (Playwright) ------------------------------------

async function fetchDongchediCreator(creator, browser) {
  console.log(`   抓取 ${creator.name}...`);

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

    const page = await context.newPage();

    // 隐藏 webdriver 特征
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    await page.goto(`https://www.dongchedi.com/user/${creator.userId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // 等待内容加载
    await page.waitForSelector('.community-card, [class*="card"]', { timeout: 10000 });

    // 提取数据
    const items = await page.evaluate((creatorData) => {
      const links = Array.from(document.querySelectorAll("a[href*='/article/'], a[href*='/video/']"));
      const seen = new Set();
      const results = [];

      links.forEach(a => {
        const url = a.href;
        if (seen.has(url) || url.includes('#comment')) return;
        seen.add(url);

        const card = a.closest('.community-card, [class*="card"]');
        const titleEl = card?.querySelector('h3, h2, .title, [class*="title"]');
        const title = titleEl?.textContent.trim() || a.textContent.trim();

        if (title.length > 5) {
          const id = url.split('/').pop().split('?')[0];
          results.push({
            id: `dongchedi_${id}`,
            标题: title,
            链接: url,
            来源: creatorData.name,
            来源类型: '懂车帝创作者',
            来源ID: creatorData.userId,
            发布时间: new Date().toISOString(),
            内容摘要: '',
            热度指数: 0.8,
            媒体类型: url.includes('/video/') ? 'video' : 'text',
            关键词: []
          });
        }
      });

      return results.slice(0, 10);
    }, { name: creator.name, userId: creator.userId });

    await context.close();
    console.log(`   ✓ ${creator.name}: ${items.length} 条`);
    return items;

  } catch (err) {
    console.log(`   ✗ ${creator.name}: ${err.message}`);
    return [];
  }
}

// -- Tavily Search -----------------------------------------------------------

async function searchTavily(query) {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query.query,
        max_results: query.maxResults || 5,
        search_depth: 'basic',
        days: 1  // 只要最近1天
      })
    });

    if (!response.ok) {
      console.log(`   ✗ "${query.query}": ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const results = data.results || [];

    const items = results.map(item => ({
      id: `tavily_${Buffer.from(item.url).toString('base64').slice(0, 16)}`,
      标题: item.title,
      链接: item.url,
      来源: new URL(item.url).hostname,
      来源类型: 'Tavily搜索',
      来源ID: query.query,
      发布时间: new Date().toISOString(),
      内容摘要: item.content || '',
      热度指数: 0.5,
      媒体类型: 'text',
      关键词: []
    }));

    console.log(`   ✓ "${query.query}": ${items.length} 条`);
    return items;

  } catch (err) {
    console.log(`   ✗ "${query.query}": ${err.message}`);
    return [];
  }
}

// -- Extract Keywords --------------------------------------------------------

async function extractKeywords(title, summary) {
  const text = `${title} ${summary}`;
  const words = text.match(/[\u4e00-\u9fa5]+/g) || [];
  const wordCount = {};

  words.forEach(word => {
    if (word.length >= 2) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  });

  const sorted = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return sorted.length >= 3 ? sorted : [...sorted, '汽车', '新闻', '行业'];
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log('🚗 Car Content Curator - Module 1: Generate Feed');
  console.log('================================================\n');

  // 1. 加载配置和状态
  const sources = await loadSources();
  const state = await loadState();
  const results = [];

  // 2. 启动浏览器（只启动一次，复用）
  console.log('🌐 启动浏览器...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',  // 隐藏自动化特征
      '--disable-dev-shm-usage',
      '--disable-web-security'
    ]
  });

  try {
    // 3. 抓取懂车帝创作者
    console.log('\n1️⃣  懂车帝创作者:');
    for (const creator of sources.懂车帝创作者 || []) {
      if (!creator.enabled) continue;
      const items = await fetchDongchediCreator(creator, browser);
      results.push(...items);
    }

    // 4. Tavily搜索
    console.log('\n2️⃣  Tavily 搜索:');
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // 动态生成搜索词（带日期）
    const tavilyQueries = [
      { query: `小米汽车 ${today}`, maxResults: 3, enabled: true },
      { query: `理想汽车 ${today}`, maxResults: 3, enabled: true },
      { query: `蔚来汽车 ${today}`, maxResults: 3, enabled: true },
      { query: `比亚迪 ${today}`, maxResults: 3, enabled: true },
      { query: `新车发布 ${today}`, maxResults: 3, enabled: true },
      { query: `电动车续航 ${today}`, maxResults: 3, enabled: true },
      { query: `自动驾驶 ${today}`, maxResults: 3, enabled: true },
      { query: `新能源汽车 ${yesterday}`, maxResults: 3, enabled: true }
    ];

    for (const query of tavilyQueries) {
      if (!query.enabled) continue;
      const items = await searchTavily(query);
      results.push(...items);
    }

  } finally {
    // 5. 关闭浏览器
    await browser.close();
  }

  console.log(`\n📊 总共抓取: ${results.length} 条`);

  // 6. 时间过滤
  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const filtered = results.filter(item => {
    const publishTime = new Date(item.发布时间).getTime();
    return publishTime >= cutoff;
  });
  console.log(`⏰ 时间过滤后 (${LOOKBACK_HOURS}h): ${filtered.length} 条`);

  // 7. 去重（改进版）
  console.log('\n🔄 去重处理...');

  // 7.1 清理旧的历史记录（只保留最近3天）
  const deduplicationWindow = 3 * 24 * 60 * 60 * 1000; // 3天
  const deduplicationCutoff = Date.now() - deduplicationWindow;

  // 清理过期的记录
  for (const [id, ts] of Object.entries(state.seenArticles)) {
    if (ts < deduplicationCutoff) {
      delete state.seenArticles[id];
    }
  }

  console.log(`   历史记录: ${Object.keys(state.seenArticles).length} 条 (最近3天)`);

  // 7.2 去重
  const deduplicated = filtered.filter(item => {
    // 检查ID是否已存在
    if (state.seenArticles[item.id]) {
      return false;
    }

    // 标记为已见
    state.seenArticles[item.id] = Date.now();
    return true;
  });

  console.log(`   去重后: ${deduplicated.length} 条`);

  // 7.3 如果去重后太少，放宽标准（只去重完全相同的标题）
  if (deduplicated.length < 20) {
    console.log(`   ⚠️  文章太少 (${deduplicated.length}条)，放宽去重标准...`);

    // 重新去重，只检查标题完全相同的
    const seenTitles = new Set();
    const relaxedDeduplicated = filtered.filter(item => {
      if (seenTitles.has(item.标题)) {
        return false;
      }
      seenTitles.add(item.标题);
      state.seenArticles[item.id] = Date.now();
      return true;
    });

    console.log(`   放宽后: ${relaxedDeduplicated.length} 条`);

    // 使用放宽后的结果
    deduplicated.length = 0;
    deduplicated.push(...relaxedDeduplicated);
  }

  console.log(`🔄 去重后: ${deduplicated.length} 条`);

  // 8. 提取关键词
  console.log('\n🔍 提取关键词...');
  for (const item of deduplicated) {
    item.关键词 = await extractKeywords(item.标题, item.内容摘要);
  }

  // 9. 统计来源
  const sourceStats = {};
  deduplicated.forEach(item => {
    sourceStats[item.来源类型] = (sourceStats[item.来源类型] || 0) + 1;
  });

  // 10. 输出
  const today = new Date().toISOString().split('T')[0];
  const output = {
    生成时间: new Date().toISOString(),
    时间窗口: '24h',
    总文章数: deduplicated.length,
    来源统计: sourceStats,
    热点列表: deduplicated
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `feed-${today}.json`);
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  await saveState(state);

  console.log(`\n✅ Feed 已生成: ${outputPath}`);
  console.log(`📈 来源统计:`, sourceStats);
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
