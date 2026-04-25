#!/usr/bin/env python3
"""Telegram 推送脚本 - 直接推送文章全文到 Telegram。"""

import os
import json
import requests
import time
from pathlib import Path

# 配置
ENV_PATH = Path(__file__).parent.parent / '.env'
ARTICLES_DIR = Path(__file__).parent.parent / 'data' / 'articles'

def load_local_env():
    """当环境变量未注入时，从 .env 补齐。"""
    if not ENV_PATH.exists():
        return

    for raw in ENV_PATH.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)

load_local_env()

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

def send_telegram_message(text):
    """发送 Telegram 消息。默认使用纯文本，避免 MarkdownV2 解析失败。"""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
    }

    response = requests.post(url, json=payload, timeout=20)

    if not response.ok:
        raise Exception(f"Telegram API error: {response.text}")

    return response.json()

def format_article(article, rank):
    """格式化完整文章。使用纯文本，规避 Telegram MarkdownV2 转义问题。"""
    title = article.get('通用版本', {}).get('标题', '无标题')
    topic = article.get('话题', '未知话题')
    word_count = article.get('通用版本', {}).get('字数', 0)
    material_count = article.get('素材统计', {}).get('总计', 0)
    content = article.get('通用版本', {}).get('正文', '')

    # 构建参考链接列表
    references = article.get('参考素材', [])
    reference_text = ''

    if references:
        reference_text = '\n\n━━━━━━━━━━━━━━━━\n\n📚 参考资料：\n\n'
        for i, ref in enumerate(references[:10], 1):  # 最多显示10个链接
            if isinstance(ref, dict):
                ref_title = ref.get('标题', '未知标题')
                ref_link = ref.get('链接', '')
                ref_source = ref.get('来源', '')

                if ref_link:
                    reference_text += f"{i}. {ref_title}\n   🔗 {ref_link}\n\n"
                else:
                    reference_text += f"{i}. {ref_title} ({ref_source})\n\n"
            elif isinstance(ref, str):
                # 兼容旧格式
                reference_text += f"{i}. {ref}\n\n"

    return f"""🏆 今日推荐 #{rank}

📌 话题：{topic}

━━━━━━━━━━━━━━━━

📝 标题：
{title}

📄 全文：
{content}

━━━━━━━━━━━━━━━━

📊 字数：{word_count}字
📚 参考素材：{material_count}篇
🤖 生成模型：Gemini + Claude{reference_text}"""

def split_long_text(text, max_length=4000):
    """按段落拆分超长消息，避免超出 Telegram 长度限制。"""
    paragraphs = [paragraph for paragraph in text.split('\n\n') if paragraph.strip()]
    chunks = []
    current = ''

    def append_chunk(chunk):
        if chunk.strip():
            chunks.append(chunk.rstrip())

    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= max_length:
            current = candidate
            continue

        if current:
            append_chunk(current)
            current = ''

        if len(paragraph) <= max_length:
            current = paragraph
            continue

        start = 0
        while start < len(paragraph):
            end = start + max_length
            chunks.append(paragraph[start:end].rstrip())
            start = end

    append_chunk(current)

    if len(chunks) <= 1:
        return chunks

    prefixed_chunks = []
    total = len(chunks)
    for index, chunk in enumerate(chunks, 1):
        if index == 1:
            prefixed_chunks.append(chunk)
        else:
            prefixed_chunks.append(f"（续 {index}/{total}）\n\n{chunk}")
    return prefixed_chunks

def send_article(article, rank):
    """直接发送完整文章，超长时自动分段。"""
    chunks = split_long_text(format_article(article, rank))

    for index, chunk in enumerate(chunks, 1):
        send_telegram_message(chunk)
        if index < len(chunks):
            time.sleep(0.5)

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

            send_article(article, i)

            print(f'   ✓ 发送成功')
            success_count += 1

            # 避免限流
            if i < len(article_files):
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
