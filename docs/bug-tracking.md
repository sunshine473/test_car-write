# BUG 追踪和修复清单

## 🐛 已发现的 BUG

### 1. 数据去重问题 ⚠️ 高优先级

**问题描述**：
- 抓取 124 条新闻
- 去重后只剩 0-1 条
- 导致无法生成足够的文章

**原因**：
- `state-feed.json` 持久化了所有历史新闻
- 去重逻辑过于严格
- 没有时间窗口限制

**影响**：
- 第二天运行时几乎没有新数据
- 无法生成 3 篇文章
- 用户体验差

**解决方案**：
```javascript
// generate-feed.js
// 方案1：限制去重时间窗口（推荐）
const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7天
const recentState = state.filter(item => item.timestamp > cutoffTime);

// 方案2：降低去重阈值
const isDuplicate = similarity > 0.9; // 从 0.8 提高到 0.9

// 方案3：允许相似但不完全相同的新闻
const allowSimilar = true;
```

**修复优先级**：⭐⭐⭐⭐⭐

---

### 2. Gemini API 不稳定 ⚠️ 中优先级

**问题描述**：
- Gemini API 经常返回 503 错误
- "Service Unavailable" 或 "fetch failed"
- 导致初评失败

**影响**：
- 评分流程变慢
- 依赖 Claude 备用方案
- 成本增加

**解决方案**：
```javascript
// rank-topics.js
// 方案1：优先使用 Claude（推荐）
const USE_GEMINI = false; // 禁用 Gemini

// 方案2：增加重试次数
const GEMINI_RETRIES = 5;

// 方案3：使用更稳定的 Gemini 模型
const GEMINI_MODEL = 'gemini-2.0-flash-exp'; // 更稳定
```

**修复优先级**：⭐⭐⭐

---

### 3. Claude API JSON 解析失败 ⚠️ 中优先级

**问题描述**：
- Claude 返回的 JSON 格式不规范
- 包含换行、特殊字符
- 导致 `JSON.parse()` 失败

**影响**：
- Writer Agent 失败
- 无法生成文章
- 需要多次重试

**解决方案**：
```javascript
// write-single.js
function extractJSON(text) {
  // 已实现：使用括号计数法
  // 但仍需改进 Prompt
  
  const prompt = `
    请返回严格的 JSON 格式，不要包含任何其他文字。
    
    重要：
    1. 不要使用 markdown 代码块
    2. 直接返回 JSON 对象
    3. 确保所有字符串都正确转义
    
    返回格式：
    {"标题": "...", "正文": "...", "字数": 900}
  `;
}
```

**修复优先级**：⭐⭐⭐

---

### 4. 空数据处理不完善 ⚠️ 中优先级

**问题描述**：
- 当没有新数据时，系统仍然继续运行
- Evaluator 返回 0 个话题
- Writer 启动 0 个 Agent
- 浪费时间和资源

**影响**：
- 用户体验差
- 浪费 API 调用
- 没有友好的提示

**解决方案**：
```javascript
// parallel-coordinator.js
async run() {
  // 检查数据
  const feedData = await this.checkFeedData();
  
  if (feedData.count === 0) {
    console.log('\n⚠️  今天没有新数据');
    console.log('💡 建议：');
    console.log('   1. 检查信息源是否正常');
    console.log('   2. 调整去重策略');
    console.log('   3. 明天再运行');
    
    // 发送通知
    await this.notifyUser('今天无新内容');
    
    return;
  }
  
  // 继续执行...
}
```

**修复优先级**：⭐⭐⭐⭐

---

### 5. 未使用的导入 ⚠️ 低优先级

**问题描述**：
- `coordinator.js` 导入了 `writeFile` 但未使用
- IDE 显示警告

**影响**：
- 代码不整洁
- 轻微的性能影响

**解决方案**：
```javascript
// coordinator.js
// 删除未使用的导入
import { readFile } from 'fs/promises'; // 删除 writeFile
```

**修复优先级**：⭐

---

### 6. Writer Agent 并行执行未完全实现 ⚠️ 高优先级

**问题描述**：
- `write-single.js` 创建了，但缺少必要的函数
- 从 `write-articles.js` 复制的代码不完整
- 缺少 `loadConfig`, `extractJSON` 等函数

**影响**：
- Writer Agent 无法独立运行
- 并行执行失败

**解决方案**：
```javascript
// write-single.js
// 需要补充完整的函数实现
// 或者重构为独立模块
```

**修复优先级**：⭐⭐⭐⭐⭐

---

### 7. 错误信息不够详细 ⚠️ 低优先级

**问题描述**：
- 错误信息只显示 "fetch failed"
- 没有详细的堆栈信息
- 难以调试

**影响**：
- 调试困难
- 无法快速定位问题

**解决方案**：
```javascript
// 所有 API 调用
try {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }
} catch (err) {
  console.error('详细错误:', {
    message: err.message,
    stack: err.stack,
    url: url,
    options: options
  });
  throw err;
}
```

**修复优先级**：⭐⭐

---

## 📋 修复优先级排序

### 🔥 紧急（立即修复）

1. **数据去重问题** ⭐⭐⭐⭐⭐
   - 影响：无法生成文章
   - 修复时间：30分钟

2. **Writer Agent 并行执行** ⭐⭐⭐⭐⭐
   - 影响：核心功能无法使用
   - 修复时间：1小时

### ⚠️ 重要（本周修复）

3. **空数据处理** ⭐⭐⭐⭐
   - 影响：用户体验差
   - 修复时间：20分钟

4. **Gemini API 不稳定** ⭐⭐⭐
   - 影响：评分流程变慢
   - 修复时间：10分钟

5. **Claude JSON 解析** ⭐⭐⭐
   - 影响：文章生成失败
   - 修复时间：30分钟

### 💡 改进（有时间再做）

6. **错误信息详细化** ⭐⭐
   - 影响：调试困难
   - 修复时间：30分钟

7. **未使用的导入** ⭐
   - 影响：代码不整洁
   - 修复时间：5分钟

---

## 🔧 修复计划

### 第1步：修复数据去重（30分钟）

```javascript
// scripts/generate-feed.js

// 添加时间窗口
const DEDUP_WINDOW_DAYS = 7;

// 修改去重逻辑
function deduplicateArticles(articles, state) {
  const cutoffTime = Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  
  // 只保留最近7天的历史记录
  const recentState = state.filter(item => 
    item.timestamp && item.timestamp > cutoffTime
  );
  
  // 降低相似度阈值
  const SIMILARITY_THRESHOLD = 0.9; // 从 0.8 提高到 0.9
  
  // 去重逻辑...
}
```

### 第2步：完善 Writer Agent（1小时）

```javascript
// scripts/write-single.js

// 补充缺失的函数
async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

function extractJSON(text) {
  // 已有实现，确保正确
}

async function callGemini(prompt) {
  // 已有实现，确保正确
}

async function callClaude(prompt) {
  // 已有实现，确保正确
}

// 确保所有依赖都正确导入
```

### 第3步：添加空数据检查（20分钟）

```javascript
// agents/coordinator/parallel-coordinator.js

async run() {
  // 1. Researcher
  this.results.researcher = await this.spawnAgent('researcher');
  
  // 2. 检查数据
  const feedData = await this.checkFeedData();
  if (feedData.count === 0) {
    console.log('\n⚠️  今天没有新数据，停止执行');
    this.generateReport();
    return;
  }
  
  // 3. 继续执行...
}

async checkFeedData() {
  const today = new Date().toISOString().split('T')[0];
  const feedPath = join(PROJECT_ROOT, 'data', 'feeds', `feed-${today}.json`);
  const feedData = JSON.parse(await readFile(feedPath, 'utf-8'));
  
  return {
    count: feedData.热点列表?.length || 0,
    data: feedData
  };
}
```

### 第4步：禁用 Gemini（10分钟）

```javascript
// scripts/rank-topics.js

// 在文件顶部添加配置
const USE_GEMINI = false; // 禁用不稳定的 Gemini

// 修改评分逻辑
async function rankTopics() {
  if (USE_GEMINI) {
    // Gemini 初评
  } else {
    console.log('⏭️  跳过 Gemini 初评（已禁用）');
  }
  
  // Claude 复评（必须）
  // ...
}
```

---

## ✅ 修复检查清单

- [ ] 数据去重问题
- [ ] Writer Agent 并行执行
- [ ] 空数据处理
- [ ] Gemini API 配置
- [ ] Claude JSON 解析
- [ ] 错误信息详细化
- [ ] 清理未使用的导入

---

## 📊 预期效果

修复后：
- ✅ 每天能生成 3 篇文章
- ✅ 并行执行正常工作
- ✅ 空数据时优雅退出
- ✅ 减少 API 错误
- ✅ 更好的用户体验

---

**立即开始修复！**
