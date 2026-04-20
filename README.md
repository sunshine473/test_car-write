# 汽车内容策展系统 - 使用说明

## 📋 项目简介

这是一个自动化的汽车内容策展系统，每天自动：
1. 从懂车帝、Tavily 等渠道抓取汽车热点新闻
2. 智能去重和聚类
3. 筛选出 Top 3 最值得写的话题
4. 自动生成 800-1000 字文章（5种平台格式）
5. 通过 Telegram 推送给你

---

## 🚀 快速开始

### 第一步：安装依赖

```bash
cd /Users/dora/Documents/car_write

# 安装 Node.js 依赖
npm install

# 安装 Playwright 浏览器（用于抓取懂车帝）
npx playwright install chromium
```

**说明**：
- `npm install` 会安装所有需要的库
- `playwright install chromium` 会下载一个浏览器（约 300MB）

---

### 第二步：检查环境变量

确认 `.env` 文件中有这些 API Key：

```bash
cat .env
```

**必需的 API Key**：
- ✅ `TAVILY_API_KEY` — 网络搜索
- ✅ `GEMINI_API_KEY` — 文章生成
- ✅ `CLAUDE_API_KEY` — 评分、润色
- ✅ `TELEGRAM_BOT_TOKEN` — Telegram 推送
- ✅ `TELEGRAM_CHAT_ID` — 你的 Telegram ID

---

### 第三步：运行模块1（抓取热点）

```bash
npm run feed
```

**这个命令做什么**？
1. 启动 Playwright 浏览器
2. 访问 10 个懂车帝创作者的主页
3. 提取最新的文章和视频
4. 用 Tavily 搜索 8 个关键词
5. 去重、提取关键词
6. 保存到 `data/feeds/feed-2026-04-16.json`

**预计时间**：2-3 分钟

**预计结果**：80-100 条热点新闻

---

## 📊 查看结果

### 方法1：直接查看 JSON 文件

```bash
cat data/feeds/feed-2026-04-16.json | head -100
```

### 方法2：用 jq 格式化查看

```bash
# 查看总数
cat data/feeds/feed-2026-04-16.json | jq '.总文章数'

# 查看来源统计
cat data/feeds/feed-2026-04-16.json | jq '.来源统计'

# 查看前5条标题
cat data/feeds/feed-2026-04-16.json | jq '.热点列表[0:5] | .[] | .标题'
```

### 方法3：用 Node.js 脚本查看

```bash
node -e "
const data = require('./data/feeds/feed-2026-04-16.json');
console.log('总文章数:', data.总文章数);
console.log('来源统计:', data.来源统计);
console.log('\n前5条标题:');
data.热点列表.slice(0, 5).forEach((item, i) => {
  console.log(\`\${i+1}. \${item.标题}\`);
});
"
```

---

## 🔧 常见问题

### Q1: npm install 失败怎么办？

**问题**：权限错误

**解决**：
```bash
# 修复 npm 缓存权限
sudo chown -R $(whoami) ~/.npm

# 重新安装
npm install
```

---

### Q2: Playwright 下载浏览器失败怎么办？

**问题**：网络问题导致下载失败

**解决**：
```bash
# 使用国内镜像
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/

# 重新安装
npx playwright install chromium
```

---

### Q3: 抓取懂车帝时报错怎么办？

**可能的错误**：
- `TimeoutError: Timeout 30000ms exceeded`
- `Navigation failed`

**解决**：
1. 检查网络连接
2. 增加超时时间（修改代码中的 `timeout: 30000` → `timeout: 60000`）
3. 暂时禁用懂车帝，只用 Tavily（修改 `config/car-sources.json`）

---

### Q4: Tavily 搜索返回 0 条怎么办？

**可能原因**：
- API Key 无效
- 今天没有新闻
- 搜索词太精准

**解决**：
1. 检查 `.env` 中的 `TAVILY_API_KEY`
2. 修改搜索词（去掉日期限制）
3. 增加搜索词数量

---

## 📁 项目结构

```
car_write/
├── config/                    # 配置文件
│   ├── car-sources.json       # 信息源配置
│   ├── ranking-prompts.json   # 评分 Prompt
│   ├── writing-prompts.json   # 写作 Prompt
│   └── telegram-config.json   # Telegram 配置
├── scripts/                   # 脚本
│   ├── generate-feed.js       # 模块1：抓取热点
│   ├── cluster-topics.js      # 模块2：去重聚类（待开发）
│   ├── rank-topics.js         # 模块3：筛选排序（待开发）
│   ├── write-articles.js      # 模块4：写文章（待开发）
│   └── deliver.js             # 模块5：Telegram发送（待开发）
├── data/                      # 数据存储
│   ├── feeds/                 # 模块1输出
│   ├── clustered/             # 模块2输出
│   ├── ranked/                # 模块3输出
│   ├── articles/              # 模块4输出
│   └── telegram/              # 模块5输出
├── state/                     # 状态管理
│   └── state-feed.json        # 去重状态
├── .env                       # 环境变量（API Key）
├── package.json               # 依赖管理
└── README.md                  # 本文件
```

---

## 🎯 下一步

### 当前进度
- ✅ 模块1：抓取热点（已完成）
- ⏳ 模块2：去重聚类（待开发）
- ⏳ 模块3：筛选排序（待开发）
- ⏳ 模块4：写文章（待开发）
- ⏳ 模块5：Telegram发送（待开发）

### 继续开发

**开发模块2**：
```bash
# 创建模块2脚本
touch scripts/cluster-topics.js

# 运行模块2
npm run cluster
```

**测试完整流程**：
```bash
# 运行所有模块
npm run all
```

---

## 🐛 调试技巧

### 查看详细日志

```bash
# 运行时显示详细日志
DEBUG=* npm run feed
```

### 单独测试某个功能

```javascript
// 测试 Tavily 搜索
node -e "
import('./scripts/generate-feed.js').then(m => {
  // 只运行 Tavily 部分
});
"
```

### 查看浏览器界面（调试用）

修改 `scripts/generate-feed.js`：
```javascript
const browser = await chromium.launch({
  headless: false,  // 改为 false，显示浏览器窗口
  slowMo: 1000      // 每个操作延迟1秒，方便观察
});
```

---

## 📞 获取帮助

**遇到问题？**
1. 查看上面的"常见问题"
2. 检查 `.env` 文件中的 API Key
3. 查看错误日志
4. 联系开发者

---

## 📝 更新日志

### 2026-04-16
- ✅ 完成模块1：抓取热点
- ✅ 支持懂车帝创作者抓取（Playwright）
- ✅ 支持 Tavily 搜索（带日期）
- ✅ 支持去重和关键词提取

---

## 📄 许可证

MIT License
