#!/usr/bin/env python3
"""
Telegram 推送脚本 - 推送生成的文章到 Telegram
"""

import os
import json
import requests
from pathlib import Path
from datetime import datetime

# 配置
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')
ARTICLES_DIR = Path(__file__).parent.parent / 'data' / 'articles'

def escape_markdown(text):
    """转义 Markdown 特殊字符"""
    special_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    for char in special_chars:
        text = text.replace(char, f'\\{char}')
    return text

def send_telegram_message(text, buttons=None):
    """发送 Telegram 消息"""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "MarkdownV2"
    }

    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}

    response = requests.post(url, json=payload)

    if not response.ok:
        raise Exception(f"Telegram API error: {response.text}")

    return response.json()

def format_summary(article, rank):
    """格式化文章摘要"""
    title = article.get('通用版本', {}).get('标题', '无标题')
    topic = article.get('话题', '未知话题')
    word_count = article.get('通用版本', {}).get('字数', 0)
    material_count = article.get('素材统计', {}).get('总计', 0)
    content = article.get('通用版本', {}).get('正文', '')
    preview = content[:150] + '...' if len(content) > 150 else content

    summary = f"""🏆 *今日推荐 \\#{rank}*

📌 话题：{escape_markdown(topic)}

━━━━━━━━━━━━━━━━

📝 标题：
{escape_markdown(title)}

💡 内容预览：
{escape_markdown(preview)}

━━━━━━━━━━━━━━━━

📊 字数：{word_count}字
📚 参考素材：{material_count}篇
🤖 生成模型：Gemini \\+ Claude

━━━━━━━━━━━━━━━━

👇 选择查看完整文章："""

    return summary

def create_buttons(article):
    """创建按钮"""
    buttons = []
    topic_id = article.get('话题ID', 'unknown')

    # 第一行：平台版本
    platform_row = []
    if article.get('知乎版本'):
        platform_row.append({
            "text": "📖 知乎版",
            "callback_data": f"view_zhihu_{topic_id}"
        })
    if article.get('小红书版本'):
        platform_row.append({
            "text": "📷 小红书版",
            "callback_data": f"view_xiaohongshu_{topic_id}"
        })
    if article.get('微信公众号版本'):
        platform_row.append({
            "text": "💬 微信版",
            "callback_data": f"view_weixin_{topic_id}"
        })

    if platform_row:
        buttons.append(platform_row)

    # 第二行：完整文章
    buttons.append([{
        "text": "📄 查看完整文章",
        "callback_data": f"view_full_{topic_id}"
    }])

    # 第三行：反馈
    buttons.append([
        {
            "text": "👍 有用",
            "callback_data": f"feedback_useful_{topic_id}"
        },
        {
            "text": "👎 无用",
            "callback_data": f"feedback_useless_{topic_id}"
        }
    ])

    return buttons

def main():
    print('🚗 Car Content Curator - Telegram Delivery')
    print('=' * 50)
    print()

    # 验证环境变量
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print('❌ 缺少 Telegram 环境变量')
        print('   请设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID')
        return 1

    # 读取文章
    article_files = list(ARTICLES_DIR.glob('*.json'))

    if not article_files:
        print('❌ 没有找到文章文件')
        return 1

    print(f'📂 找到 {len(article_files)} 篇文章\n')

    # 发送每篇文章
    success_count = 0
    failure_count = 0

    for i, article_file in enumerate(article_files, 1):
        try:
            with open(article_file, 'r', encoding='utf-8') as f:
                article = json.load(f)

            topic = article.get('话题', '未知')
            print(f'📤 发送文章 {i}: {topic}')

            # 格式化并发送
            summary = format_summary(article, i)
            buttons = create_buttons(article)

            send_telegram_message(summary, buttons)

            print(f'   ✓ 发送成功')
            success_count += 1

            # 避免限流
            if i < len(article_files):
                import time
                time.sleep(1)

        except Exception as e:
            print(f'   ✗ 发送失败: {e}')
            failure_count += 1

    print(f'\n📊 发送结果: 成功 {success_count} 篇, 失败 {failure_count} 篇')

    if success_count == 0:
        print('\n❌ 所有文章发送失败')
        return 1

    if failure_count > 0:
        print(f'\n⚠️  部分文章发送失败')
        return 1

    print('\n✅ 所有文章已推送到 Telegram！')
    return 0

if __name__ == '__main__':
    exit(main())
