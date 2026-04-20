---
name: car-content-producer
description: 汽车内容自动策展系统 - 每天自动发现热点、生成文章、推送到Telegram
version: 1.0.0
author: Claude & Dora
tags: [automation, content, car, telegram]
---

# 汽车内容自动策展系统

自动化的汽车内容策展系统，每天：
1. 从懂车帝、Tavily 抓取 100+ 条热点新闻
2. 智能去重和聚类成 10 个话题组
3. 双模型评分（Gemini + Claude）筛选 Top 3
4. 生成 800-1000 字文章（5种平台版本）
5. 推送到 Telegram

## 使用方法

```bash
# 运行完整流程
/car-content-producer

# 只运行特定模块
/car-content-producer feed      # 模块1: 抓取热点
/car-content-producer cluster   # 模块2: 去重聚类
/car-content-producer rank      # 模块3: 筛选排序
/car-content-producer write     # 模块4: 写文章
/car-content-producer deliver   # 模块5: Telegram推送
```

## 功能特性

- ✅ 自动抓取懂车帝创作者内容（Playwright）
- ✅ Tavily 深度搜索补充素材
- ✅ Claude 智能聚类和去重
- ✅ 双模型评分（Gemini + Claude）
- ✅ 多平台文章生成（知乎、小红书、YouTube、今日头条、微信）
- ✅ Telegram 交互式推送
- ✅ GitHub Actions 自动化部署

## 配置要求

需要在 `.env` 文件中配置以下 API Key：

```env
TAVILY_API_KEY=your_tavily_key
GEMINI_API_KEY=your_gemini_key
CLAUDE_API_KEY=your_claude_key
CLAUDE_BASE_URL=your_claude_base_url
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## 输出示例

每天生成 3 篇文章，推送到 Telegram：

```
🏆 今日推荐 #1

话题：大众ID系列电动车
标题：32.98万的大众ID ERA 9X：传统豪强的电动化豪赌
字数：897字
素材数：20篇

[📖 知乎版] [📷 小红书版] [💬 微信版]
[📄 查看完整文章]
[👍 有用] [👎 无用]
```

## 技术栈

- Node.js 18+
- Playwright（浏览器自动化）
- Claude API（聚类、评分、润色）
- Gemini API（文章生成）
- Tavily API（搜索）
- Telegram Bot API（推送）
