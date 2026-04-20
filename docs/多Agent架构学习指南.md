# 多 Agent 架构学习指南

> 从小白到理解 Claude Agent SDK 的完整教程

---

## 目录

1. [什么是多 Agent 架构](#什么是多-agent-架构)
2. [核心概念](#核心概念)
3. [实战：构建汽车内容策展系统](#实战构建汽车内容策展系统)
4. [关键代码解析](#关键代码解析)
5. [常见问题和解决方案](#常见问题和解决方案)
6. [三种方案对比](#三种方案对比)
7. [下一步建议](#下一步建议)

---

## 什么是多 Agent 架构？

### 简单类比

**传统脚本 = 工厂流水线**
- 每个工位按固定步骤工作
- 一个接一个，串行执行
- 网站改版就挂了

**多 Agent = 智能团队**
- 每个成员有 AI 大脑，可以自主决策
- 可以并行工作
- 遇到问题自己想办法

### 对比示例

```javascript
// ❌ 传统脚本（死板）
async function fetchNews() {
  const page = await browser.goto('https://dongchedi.com/...');
  const articles = await page.$$eval('.article', ...);
  return articles;
}
// 问题：网站改版就挂了

// ✅ Agent（智能）
const agent = new Agent({
  name: 'researcher',
  instructions: '抓取汽车新闻，如果失败自己想办法'
});

await agent.execute('请抓取懂车帝的汽车新闻');
// Agent 会自己：
// 1. 尝试抓取
// 2. 如果失败，分析原因
// 3. 切换备用方案（比如用 API）
```

---

## 核心概念

### 1. Agent 的三要素

```javascript
const agent = new Agent({
  // 1. 身份：你是谁
  name: 'car-content-researcher',
  
  // 2. 能力：你会什么
  tools: [
    fetchDongchedi,  // 工具1：抓取懂车帝
    searchTavily,    // 工具2：搜索 Tavily
    saveToFile       // 工具3：保存文件
  ],
  
  // 3. 指令：你要做什么
  instructions: `
    你是汽车内容研究员。
    目标：抓取 100+ 条今天的汽车新闻。
    如果懂车帝失败，用 Tavily 补充。
  `
});
```

### 2. Agent 的工作循环

```
用户指令
   ↓
Agent 思考："我需要用哪些工具？"
   ↓
调用工具1：fetchDongchedi()
   ↓
结果：失败（验证码）
   ↓
Agent 思考："失败了，我该怎么办？"
   ↓
调用工具2：searchTavily()
   ↓
结果：成功（获取 50 条）
   ↓
Agent 思考："还不够 100 条，继续搜索"
   ↓
调用工具2：searchTavily('小米汽车')
   ↓
...
   ↓
完成：返回 105 条新闻
```

**关键**：Agent 会**自己循环思考和执行**，直到完成目标。

### 3. 工具定义和实现

```javascript
// 步骤1：定义工具（告诉 Agent 有哪些工具）
const tools = [
  {
    name: 'search_tavily',
    description: '使用 Tavily API 搜索汽车相关新闻',
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
  }
];

// 步骤2：实现工具（真正执行的函数）
async function searchTavily(query, maxResults = 5) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults
    })
  });
  
  const data = await response.json();
  return data.results;
}

// 步骤3：处理工具调用
async function processToolCall(toolName, toolInput) {
  if (toolName === 'search_tavily') {
    return await searchTavily(toolInput.query, toolInput.max_results);
  }
}
```

### 4. Agent 主循环

```javascript
export class ResearcherAgent {
  async run(userPrompt) {
    const messages = [{ role: 'user', content: userPrompt }];
    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;

      // 调用 Claude API
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4',
        tools: tools,
        messages: messages
      });

      // 如果 Agent 完成了任务
      if (response.stop_reason === 'end_turn') {
        return { success: true };
      }

      // 如果 Agent 需要调用工具
      if (response.stop_reason === 'tool_use') {
        // 执行工具
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await processToolCall(block.name, block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            });
          }
        }

        // 将工具结果返回给 Agent
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        // 继续下一轮循环
        continue;
      }
    }
  }
}
```

---

## 实战：构建汽车内容策展系统

### 系统架构

```
Coordinator（协调者）
    ↓
    启动 Researcher Agent
    ↓
    等待完成
    ↓
    分析数据，选出 Top 3 话题
    ↓
    并行启动 3 个 Writer Agent
    ├─ Writer 1 (话题1)
    ├─ Writer 2 (话题2)
    └─ Writer 3 (话题3)
    ↓
    等待全部完成
    ↓
    生成报告
```

### 实现的 Agent

#### 1. Researcher Agent（研究员）

**职责**：抓取汽车热点新闻

**工具**：
- `search_tavily` - 搜索新闻
- `save_feed` - 保存数据
- `get_current_date` - 获取日期

**文件**：`agents/researcher/researcher-agent.js`

#### 2. Writer Agent（作家）

**职责**：为单个话题生成文章

**工具**：
- `search_tavily_deep` - 深度搜索素材
- `generate_article_with_gemini` - 生成文章
- `save_article` - 保存文章

**文件**：`agents/writer/writer-agent.js`

#### 3. Coordinator Agent（协调者）

**职责**：管理整个工作流

**功能**：
- 启动 Researcher Agent
- 分析数据，提取话题
- 并行启动 3 个 Writer Agent
- 生成执行报告

**文件**：`agents/coordinator/multi-agent-coordinator.js`

---

## 关键代码解析

### 1. 并行执行的威力

```javascript
// ❌ 传统脚本（串行）
await writeArticle(topic1);  // 2分钟
await writeArticle(topic2);  // 2分钟
await writeArticle(topic3);  // 2分钟
// 总耗时：6分钟

// ✅ 多 Agent（并行）
const promises = [
  writer1.run(topic1),  // 2分钟
  writer2.run(topic2),  // 2分钟
  writer3.run(topic3)   // 2分钟
];
await Promise.all(promises);
// 总耗时：2分钟（节省 4 分钟！）
```

### 2. 容错处理

```javascript
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

// 统计成功/失败
const successCount = writerResults.filter(w => w.success).length;
console.log(`✅ 成功 ${successCount}/${writerResults.length} 篇`);
```

### 3. Agent 自主决策示例

```javascript
// Agent 可以自己判断
if (懂车帝抓取失败) {
  // Agent 自己决定：用 Tavily 补充
  await this.searchTavily('小米汽车');
}

if (素材不够 20 篇) {
  // Agent 自己决定：再搜索一次
  await this.searchTavily(`${topic} 最新消息`);
}
```

---

## 常见问题和解决方案

### 问题1：上下文过长

**现象**：
```
Error: 上下文过长，请压缩上下文或重开新对话
```

**原因**：
- Agent 搜索太多次
- 每次迭代都把结果加到对话历史
- 对话历史越来越长

**解决方案**：
```javascript
// ❌ 错误的指令
instructions: `
  目标：获取 100+ 条新闻
  确保总数达到 100+ 条
`
// Agent 会不停搜索直到超过 100 条

// ✅ 正确的指令
instructions: `
  目标：获取 50-80 条新闻
  只搜索一轮，搜索完立即保存，不要重复搜索
`
// Agent 搜索一次就停止
```

### 问题2：Agent 不按预期工作

**现象**：Agent 做了意外的操作

**原因**：指令不够明确

**解决方案**：
```javascript
// ❌ 模糊的指令
instructions: `抓取新闻`

// ✅ 明确的指令
instructions: `
  你是汽车内容研究员。
  
  工作流程（严格按顺序）：
  1. 调用 get_current_date 获取日期
  2. 调用 search_tavily 搜索 6-8 个关键词
  3. 立即调用 save_feed 保存结果
  4. 报告完成情况
  
  重要：
  - 只搜索一轮
  - 不要判断"是否够100条"再搜索
  - 搜索完立即保存
`
```

### 问题3：工具调用失败

**现象**：工具执行报错

**解决方案**：
```javascript
try {
  const result = await processToolCall(block.name, block.input);
  
  toolResults.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify(result)
  });
  
} catch (err) {
  // 返回错误给 Agent，让它自己决定怎么办
  toolResults.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: `Error: ${err.message}`,
    is_error: true
  });
}
```

---

## 三种方案对比

### 方案1：轻量级优化（推荐）

**改动**：
- 并行化 Writer
- 增加缓存层
- 错误重试优化
- 统一日志系统

**优势**：
- 改动小（约 200 行代码）
- 风险低
- 性能提升 40%
- 1 天完成

**适合**：想快速优化现有系统

---

### 方案2：任务队列系统

**改动**：
- 引入任务队列
- 支持断点续传
- 状态机管理

**优势**：
- 可维护性提升 60%
- 支持断点续传
- 更好的错误处理
- 1 周完成

**适合**：想提升系统可维护性

---

### 方案3：完整多 Agent 架构

**改动**：
- 使用 Claude Agent SDK
- 所有模块变成 Agent
- 智能决策和容错

**优势**：
- 系统更智能
- 自适应调整策略
- 更强的容错能力
- 2 周完成

**适合**：想学习新技术，体验 AI Agent

---

## 下一步建议

### 如果你是小白 → **选方案1**
- 改动小，风险低
- 1天就能完成
- 性能提升明显（40%）
- 不需要学新东西

### 如果你想提升可维护性 → **选方案2**
- 支持断点续传
- 更好的错误处理
- 可视化进度
- 1周可以完成

### 如果你想学习新技术 → **选方案3**
- 体验多 Agent 架构
- 学习 Claude Agent SDK
- 系统更智能
- 但需要 2 周时间

### 混合模式（最推荐）

```javascript
// 传统脚本（80%） + Agent（20%）

async function main() {
  // 1. 抓数据（传统脚本）
  await runScript('generate-feed.js');
  
  // 2. 分析（传统脚本）
  await runScript('cluster-topics.js');
  
  // 3. 写作（Agent！）
  const topics = loadTopics();
  const writers = topics.map(topic => {
    const agent = new WriterAgent();
    return agent.run(topic);  // Agent 自己决定怎么写
  });
  await Promise.all(writers);
  
  // 4. 发布（传统脚本）
  await runScript('deliver.js');
}
```

**优势**：
- 保留现有系统的稳定性
- 只在需要智能的地方用 Agent
- 成本可控
- 性价比最高

---

## 总结

### 你学到了什么？

1. **Agent 的三要素**：身份、能力、指令
2. **Agent 的工作循环**：思考 → 调用工具 → 再思考 → ...
3. **工具定义和实现**：如何让 Agent 调用函数
4. **并行执行**：如何让多个 Agent 同时工作
5. **容错处理**：如何处理 Agent 失败

### 多 Agent vs 传统脚本

| 维度 | 传统脚本 | 多 Agent |
|------|---------|----------|
| 智能程度 | 死板 | 智能 |
| 容错能力 | 失败就停止 | 自动重试 |
| 并行能力 | 需要手动编写 | 天然支持 |
| 可维护性 | 改逻辑要改代码 | 改指令即可 |
| 学习成本 | 低 | 中 |
| 适用场景 | 简单、固定流程 | 复杂、需要决策 |

### 关键文件

```
agents/
├── researcher/
│   └── researcher-agent.js      # 智能研究员
├── writer/
│   └── writer-agent.js          # 智能作家
└── coordinator/
    └── multi-agent-coordinator.js  # 总协调者
```

---

## 参考资源

- [Anthropic API 文档](https://docs.anthropic.com/)
- [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- 项目文件：`/Users/dora/Documents/car_write/agents/`

---

**祝你学习愉快！🎉**
