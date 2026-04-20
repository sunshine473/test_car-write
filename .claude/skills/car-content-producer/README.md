# 汽车内容自动策展系统 - Skill 使用指南

## 📦 安装 Skill

### 方式1：从项目目录安装

```bash
# 在 Claude Code 中运行
cd /Users/dora/Documents/car_write
claude skill install .claude/skills/car-content-producer
```

### 方式2：直接使用（无需安装）

```bash
# 在项目目录中直接运行
cd /Users/dora/Documents/car_write
./.claude/skills/car-content-producer/run.sh
```

---

## 🚀 使用方法

### 在 Claude Code 中使用

```bash
# 运行完整流程（5个模块）
/car-content-producer

# 只运行特定模块
/car-content-producer feed      # 模块1: 抓取热点
/car-content-producer cluster   # 模块2: 去重聚类
/car-content-producer rank      # 模块3: 筛选排序
/car-content-producer write     # 模块4: 写文章
/car-content-producer deliver   # 模块5: Telegram推送
```

### 在终端中使用

```bash
cd /Users/dora/Documents/car_write

# 运行完整流程
./.claude/skills/car-content-producer/run.sh all

# 运行特定模块
./.claude/skills/car-content-producer/run.sh feed
./.claude/skills/car-content-producer/run.sh cluster
./.claude/skills/car-content-producer/run.sh rank
./.claude/skills/car-content-producer/run.sh write
./.claude/skills/car-content-producer/run.sh deliver
```

---

## 📊 运行流程

```
/car-content-producer
    ↓
检查依赖（Node.js, npm, .env）
    ↓
模块1: 抓取热点（2-3分钟）
  - 懂车帝创作者 × 10
  - Tavily 搜索 × 8
  - 输出: 100条新闻
    ↓
模块2: 去重聚类（20秒）
  - Claude 智能分析
  - 输出: 10个话题组
    ↓
模块3: 筛选排序（60秒）
  - Gemini 初评
  - Claude 复评
  - Claude 决策
  - 输出: Top 3话题
    ↓
模块4: 写文章（5-8分钟）
  - Tavily 深度搜索
  - Gemini/Claude 生成初稿
  - Claude 优化润色
  - 生成5种平台版本
  - 输出: 3篇文章
    ↓
模块5: Telegram推送（5秒）
  - 发送摘要 + 按钮
  - 输出: Telegram消息
    ↓
完成！查看 Telegram
```

**总耗时**：约 8-12 分钟

---

## 📁 输出文件

所有生成的数据保存在 `data/` 目录：

```
data/
├── feeds/
│   └── feed-2026-04-16.json          # 模块1输出：100条新闻
├── clustered/
│   └── clustered-2026-04-16.json     # 模块2输出：10个话题组
├── ranked/
│   └── ranked-2026-04-16.json        # 模块3输出：Top 3话题
└── articles/
    ├── article-topic_001-2026-04-16.json  # 模块4输出：文章1
    ├── article-topic_002-2026-04-16.json  # 模块4输出：文章2
    └── article-topic_003-2026-04-16.json  # 模块4输出：文章3
```

---

## 🔧 配置

### 环境变量（.env）

```env
# Tavily 搜索
TAVILY_API_KEY=tvly-dev-xxx

# Gemini 文章生成
GEMINI_API_KEY=AIzaSyxxx

# Claude 聚类、评分、润色
CLAUDE_API_KEY=sk-ant-xxx
CLAUDE_BASE_URL=https://api.anthropic.com

# Telegram 推送
TELEGRAM_BOT_TOKEN=123456:ABCxxx
TELEGRAM_CHAT_ID=123456789
```

### 信息源配置（config/car-sources.json）

```json
{
  "懂车帝创作者": [
    {
      "name": "萝卜报告",
      "userId": "4661945771",
      "enabled": true
    }
  ]
}
```

### 评分标准（config/ranking-prompts.json）

自定义评分维度和权重

### 写作风格（config/writing-prompts.json）

自定义文章风格和平台格式

---

## 🐛 故障排查

### 问题1：依赖安装失败

```bash
# 清理缓存重新安装
rm -rf node_modules package-lock.json
npm install
```

### 问题2：Playwright 浏览器下载失败

```bash
# 手动安装
npx playwright install chromium
```

### 问题3：模块运行失败

```bash
# 查看详细日志
npm run feed 2>&1 | tee feed.log
```

### 问题4：Gemini API 503 错误

- 正常现象，系统会自动切换到 Claude
- 不影响最终结果

---

## 📈 性能优化

### 加速运行

1. **减少信息源**：只保留 5 个懂车帝创作者
2. **减少搜索**：Tavily 查询从 8 个减少到 5 个
3. **减少文章**：只生成 1-2 篇（修改模块3）

### 降低成本

1. **优先使用 Gemini**：免费且速度快
2. **减少 Claude 调用**：只在必要时使用
3. **减少 Tavily 搜索**：每次搜索 $0.005

---

## 🎯 扩展功能

### 添加新的信息源

编辑 `config/car-sources.json`，添加新的创作者

### 添加新的平台版本

编辑 `config/writing-prompts.json`，添加新的平台 Prompt

### 自定义推送格式

编辑 `config/telegram-config.json`，修改消息模板

---

## 📞 获取帮助

**遇到问题？**

1. 查看运行日志
2. 检查 `.env` 配置
3. 确认 API Key 有效
4. 查看 `README.md` 和 `DEPLOY.md`

---

## 📄 许可证

MIT License
