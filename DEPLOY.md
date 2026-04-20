# 汽车内容策展系统 - GitHub Actions 部署指南

## 🚀 部署步骤

### 1. 推送代码到 GitHub

```bash
cd /Users/dora/Documents/car_write

# 初始化 git（如果还没有）
git init
git add .
git commit -m "Initial commit: Car Content Curator"

# 创建 GitHub 仓库后，推送代码
git remote add origin https://github.com/YOUR_USERNAME/car-content-curator.git
git branch -M main
git push -u origin main
```

---

### 2. 配置 GitHub Secrets

在 GitHub 仓库页面：

1. 点击 **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. 添加以下 secrets：

| Secret Name | Value | 说明 |
|------------|-------|------|
| `TAVILY_API_KEY` | `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` | Tavily 搜索 API |
| `GEMINI_API_KEY` | `AIzaSyDAFY8SlbX_ERUhcODMPyXN7D4VuKEmGMM` | Gemini 生成文章 |
| `CLAUDE_API_KEY` | `6482JH4E-D67R-49KZ-4WGV-URBAWGC2H6N7` | Claude 评分润色 |
| `CLAUDE_BASE_URL` | `https://yunyi.rdzhvip.com/claude` | Claude API 地址 |
| `TELEGRAM_BOT_TOKEN` | `8237240597:AAFgfzgWdXUsE-UPC68xmPy0y2tIKW4D21E` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | `8233183603` | 你的 Telegram Chat ID |

---

### 3. 启用 GitHub Actions

1. 在仓库页面点击 **Actions** 标签
2. 如果看到提示，点击 **I understand my workflows, go ahead and enable them**
3. 你会看到 **Daily Car Content Digest** workflow

---

### 4. 测试运行

#### 方式1：手动触发

1. 点击 **Actions** → **Daily Car Content Digest**
2. 点击右侧的 **Run workflow** 按钮
3. 点击绿色的 **Run workflow** 确认
4. 等待约 5-10 分钟，查看运行结果

#### 方式2：等待自动运行

- 每天 **北京时间 8:00**（UTC 0:00）自动运行
- 第二天早上查看 Telegram 消息

---

### 5. 查看运行结果

#### 在 GitHub 查看

1. 点击 **Actions** → 选择最近的运行
2. 查看每个步骤的日志
3. 下载 **Artifacts**（生成的 JSON 文件）

#### 在 Telegram 查看

- 打开 Telegram
- 查看 Bot 发送的消息
- 点击按钮查看不同平台版本

---

## 📊 运行流程

```
每天 8:00 自动触发
    ↓
模块1: 抓取热点 (2-3分钟)
    ↓
模块2: 去重聚类 (20秒)
    ↓
模块3: 筛选排序 (60秒)
    ↓
模块4: 写文章 (5-8分钟)
    ↓
模块5: Telegram推送 (5秒)
    ↓
完成！查看 Telegram
```

**总耗时**：约 8-12 分钟

---

## 🔧 故障排查

### 问题1：Actions 运行失败

**检查**：
1. 点击失败的步骤，查看错误日志
2. 确认所有 Secrets 都已正确配置
3. 检查 API Key 是否有效

### 问题2：没有收到 Telegram 消息

**检查**：
1. 确认 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID` 正确
2. 确认 Bot 已启动（发送 `/start` 给 Bot）
3. 查看 Actions 日志中的 Module 5 输出

### 问题3：Gemini API 503 错误

**解决**：
- Gemini API 不稳定时，系统会自动切换到 Claude
- 不影响最终结果

### 问题4：懂车帝抓取失败

**解决**：
- GitHub Actions 的 IP 可能被懂车帝限制
- 系统会继续使用 Tavily 搜索的数据
- 仍能生成 20+ 篇素材

---

## 📝 自定义配置

### 修改运行时间

编辑 `.github/workflows/daily-digest.yml`：

```yaml
on:
  schedule:
    # 改为每天 9:00（UTC 1:00）
    - cron: '0 1 * * *'
```

### 修改信息源

编辑 `config/car-sources.json`：

```json
{
  "懂车帝创作者": [
    {
      "name": "新创作者",
      "userId": "123456789",
      "enabled": true
    }
  ]
}
```

### 修改评分标准

编辑 `config/ranking-prompts.json`

### 修改写作风格

编辑 `config/writing-prompts.json`

---

## 💰 成本估算

### API 调用成本（每天）

| API | 调用次数 | 单价 | 每天成本 |
|-----|---------|------|---------|
| Tavily | ~30次 | $0.005/次 | $0.15 |
| Gemini | ~15次 | 免费 | $0 |
| Claude | ~20次 | $0.015/1K tokens | $0.30 |
| **总计** | - | - | **$0.45/天** |

**每月成本**：约 $13.5

---

## 🎯 优化建议

### 1. 减少成本

- 减少 Tavily 搜索次数
- 只生成 1-2 篇文章（而不是 3 篇）
- 使用 Gemini 替代 Claude（免费）

### 2. 提高质量

- 增加更多信息源
- 优化 Prompt
- 添加人工审核环节

### 3. 扩展功能

- 自动发布到知乎、小红书
- 添加图片生成
- 生成视频脚本

---

## 📞 获取帮助

**遇到问题？**

1. 查看 Actions 运行日志
2. 检查本地是否能正常运行（`npm run all`）
3. 查看 README.md 中的故障排查部分

---

## 📄 许可证

MIT License
