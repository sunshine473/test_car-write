# 🔧 BUG 修复方案 - 立即执行

## ✅ 测试结果

### Tavily API 测试
```bash
✅ API Key 有效
✅ API 响应正常
✅ 返回了搜索结果
```

**结论**：Tavily API 本身没问题，问题在代码中！

---

## 🐛 发现的真实问题

### 问题1：write-single.js 中的 Tavily 调用可能有问题

让我检查代码...

**可能原因**：
1. 网络超时
2. 错误处理不当
3. API 参数错误

---

## 🔧 修复方案

### 修复1：改进 Tavily 错误处理

```javascript
// scripts/write-single.js
async function tavilyDeepSearch(topic) {
  console.log(`   🔍 Tavily 深度搜索...`);

  const queries = [
    topic.话题,
    ...topic.关键词.slice(0, 2).map(k => `${k} 2026`),
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
        }),
        timeout: 30000 // 添加30秒超时
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`      ✗ "${query}": HTTP ${response.status} - ${errorText}`);
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
      // 继续下一个查询，不要中断
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
```

### 修复2：改进 Claude JSON 生成 Prompt

```javascript
// scripts/write-single.js
async function generateArticle(topic, config) {
  // ...

  const geminiPrompt = `
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
  "正文": "文章正文内容（800-1000字，用\\n表示换行）",
  "字数": 900
}

现在请生成文章：
`;

  let draft;
  try {
    const geminiResponse = await callGemini(geminiPrompt);
    draft = extractJSON(geminiResponse);
    console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
  } catch (err) {
    console.log(`      ✗ Gemini 失败: ${err.message}`);
    console.log(`      ⚠️  使用 Claude 生成初稿...`);
    
    try {
      const claudeResponse = await callClaude(geminiPrompt);
      draft = extractJSON(claudeResponse);
      console.log(`      ✓ 初稿完成 (${draft.字数}字)`);
    } catch (err2) {
      console.log(`      ✗ Claude 也失败: ${err2.message}`);
      
      // 保存原始响应用于调试
      const debugPath = `/tmp/claude-response-${Date.now()}.txt`;
      await writeFile(debugPath, claudeResponse || 'no response');
      console.log(`      📝 原始响应已保存: ${debugPath}`);
      
      throw err2;
    }
  }
}
```

### 修复3：改进 JSON 提取逻辑

```javascript
// scripts/write-single.js
function extractJSON(text) {
  console.log(`      🔍 尝试提取 JSON (文本长度: ${text.length})`);
  
  // 方法1：直接解析
  try {
    const parsed = JSON.parse(text);
    console.log(`      ✓ 直接解析成功`);
    return parsed;
  } catch (err) {
    console.log(`      ⚠️  直接解析失败: ${err.message}`);
  }

  // 方法2：移除 markdown 代码块
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    console.log(`      ✓ 清理后解析成功`);
    return parsed;
  } catch (err) {
    console.log(`      ⚠️  清理后解析失败: ${err.message}`);
  }

  // 方法3：查找第一个完整的 JSON 对象
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const jsonStr = text.substring(start, i + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          console.log(`      ✓ 括号计数法成功`);
          return parsed;
        } catch (err) {
          console.log(`      ⚠️  括号计数法失败: ${err.message}`);
          start = -1;
        }
      }
    }
  }

  // 方法4：尝试修复常见问题
  try {
    // 移除控制字符
    let fixed = text.replace(/[\x00-\x1F\x7F]/g, '');
    // 修复未转义的引号
    fixed = fixed.replace(/([^\\])"/g, '$1\\"');
    const parsed = JSON.parse(fixed);
    console.log(`      ✓ 修复后解析成功`);
    return parsed;
  } catch (err) {
    console.log(`      ⚠️  修复后解析失败: ${err.message}`);
  }

  // 保存原始文本用于调试
  console.log(`      ❌ 所有方法都失败了`);
  console.log(`      📝 原始文本前100字符: ${text.substring(0, 100)}`);
  
  throw new Error('无法从响应中提取有效的 JSON');
}
```

### 修复4：调整数据去重策略

```javascript
// scripts/generate-feed.js

// 在文件顶部添加配置
const DEDUP_CONFIG = {
  WINDOW_DAYS: 3,           // 只去重最近3天
  SIMILARITY_THRESHOLD: 0.95, // 相似度阈值（更宽松）
  MIN_ARTICLES: 20          // 最少保留20篇
};

// 修改去重函数
function deduplicateArticles(articles, stateData) {
  console.log(`\n🔄 去重处理...`);
  console.log(`   原始文章数: ${articles.length}`);
  
  // 1. 过滤历史记录（只保留最近3天）
  const cutoffTime = Date.now() - DEDUP_CONFIG.WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentState = stateData.filter(item => 
    item.timestamp && item.timestamp > cutoffTime
  );
  
  console.log(`   历史记录: ${stateData.length} → ${recentState.length} (最近${DEDUP_CONFIG.WINDOW_DAYS}天)`);
  
  // 2. 去重
  const unique = [];
  const seen = new Set(recentState.map(item => item.id));
  
  for (const article of articles) {
    // 检查ID是否重复
    if (seen.has(article.id)) {
      continue;
    }
    
    // 检查标题相似度
    let isDuplicate = false;
    for (const existing of recentState) {
      const similarity = calculateSimilarity(article.标题, existing.标题);
      if (similarity > DEDUP_CONFIG.SIMILARITY_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      unique.push(article);
      seen.add(article.id);
    }
  }
  
  console.log(`   去重后: ${unique.length} 篇`);
  
  // 3. 如果去重后太少，放宽标准
  if (unique.length < DEDUP_CONFIG.MIN_ARTICLES) {
    console.log(`   ⚠️  文章太少，放宽去重标准...`);
    
    // 重新去重，只检查完全相同的
    const relaxed = [];
    const seenTitles = new Set(recentState.map(item => item.标题));
    
    for (const article of articles) {
      if (!seenTitles.has(article.标题)) {
        relaxed.push(article);
        seenTitles.add(article.标题);
      }
    }
    
    console.log(`   放宽后: ${relaxed.length} 篇`);
    return relaxed;
  }
  
  return unique;
}

// 计算相似度
function calculateSimilarity(str1, str2) {
  // 简单的 Jaccard 相似度
  const set1 = new Set(str1.split(''));
  const set2 = new Set(str2.split(''));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}
```

---

## 📋 修复步骤

### 第1步：修复 write-single.js

```bash
# 备份原文件
cp scripts/write-single.js scripts/write-single.js.bak

# 应用修复
# （手动编辑或使用 Edit 工具）
```

### 第2步：修复 generate-feed.js

```bash
# 备份原文件
cp scripts/generate-feed.js scripts/generate-feed.js.bak

# 应用修复
# （手动编辑或使用 Edit 工具）
```

### 第3步：测试

```bash
# 清空缓存
rm data/state-feed.json

# 重新运行
npm run parallel
```

---

## ✅ 预期效果

修复后：
- ✅ Tavily 搜索成功率 > 80%
- ✅ Claude JSON 解析成功率 > 90%
- ✅ 去重后保留 20+ 篇文章
- ✅ 能够生成 3 篇文章

---

**要我现在开始应用这些修复吗？**
