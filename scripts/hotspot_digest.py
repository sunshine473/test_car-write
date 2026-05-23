#!/usr/bin/env python3
"""
热点速递 - 独立推送热点 + AI 深度点评
"""

import os
import json
import requests
from html.parser import HTMLParser
from pathlib import Path
from datetime import datetime

# 配置
ENV_PATH = Path(__file__).parent.parent / '.env'
FEEDS_DIR = Path(__file__).parent.parent / 'data' / 'feeds'

def load_local_env():
    """加载环境变量"""
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
CLAUDE_API_KEY = os.getenv('CLAUDE_API_KEY')
CLAUDE_BASE_URL = os.getenv('CLAUDE_BASE_URL', 'https://api.anthropic.com')

class ArticleTextParser(HTMLParser):
    """从新闻页 HTML 中提取可读正文。"""

    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.capture_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'noscript', 'svg'}:
            self.skip_depth += 1
            return

        attrs_dict = dict(attrs)
        marker = ' '.join([
            tag,
            attrs_dict.get('class', ''),
            attrs_dict.get('id', ''),
            attrs_dict.get('role', '')
        ]).lower()

        if tag in {'article', 'main'} or any(
            key in marker for key in ['article', 'content', 'post', 'detail', 'news']
        ):
            self.capture_depth += 1

    def handle_endtag(self, tag):
        if self.skip_depth and tag in {'script', 'style', 'noscript', 'svg'}:
            self.skip_depth -= 1
            return

        if self.capture_depth and tag in {'article', 'main', 'div', 'section'}:
            self.capture_depth -= 1

    def handle_data(self, data):
        if self.skip_depth:
            return

        text = normalize_text(data)
        if not text:
            return

        if self.capture_depth or len(text) >= 24:
            self.parts.append(text)

def call_claude(prompt, max_tokens=200):
    """调用 Claude API 生成点评"""
    url = f"{CLAUDE_BASE_URL}/v1/messages"

    response = requests.post(url, json={
        "model": "claude-opus-4-6",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }, headers={
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }, timeout=30)

    if not response.ok:
        raise Exception(f"Claude API error: {response.text}")

    return response.json()['content'][0]['text'].strip()

def normalize_text(text):
    """压缩空白，避免 Telegram 消息被源站换行撑散。"""
    return ' '.join((text or '').split())

def truncate_text(text, limit):
    text = normalize_text(text)
    if len(text) <= limit:
        return text
    return text[:limit].rstrip('，。；、 ') + '...'

def prepare_hotspot_text(title, summary=""):
    """整理标题和摘要；懂车帝部分卡片会把正文塞进标题，摘要为空。"""
    raw_title = title or '未知标题'
    raw_summary = summary or ''

    title_lines = [line.strip() for line in raw_title.splitlines() if line.strip()]
    display_title = normalize_text(title_lines[0] if title_lines else raw_title)

    if not raw_summary and len(title_lines) > 1:
        raw_summary = ' '.join(title_lines[1:])

    if not raw_summary and len(display_title) > 80:
        raw_summary = display_title
        display_title = truncate_text(display_title, 56)

    return truncate_text(display_title, 72), truncate_text(raw_summary, 140)

def extract_article_text(html):
    parser = ArticleTextParser()
    parser.feed(html or '')

    seen = set()
    parts = []
    for part in parser.parts:
        if part in seen:
            continue
        seen.add(part)
        parts.append(part)

    return normalize_text(' '.join(parts))

def fetch_article_text(url):
    if not url or any(domain in url for domain in ['youtube.com', 'youtu.be']):
        return ''

    try:
        response = requests.get(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            timeout=12
        )
        if not response.ok:
            print(f"   ⚠️  原文抓取失败: HTTP {response.status_code}")
            return ''

        article_text = extract_article_text(response.text)
        if len(article_text) < 80:
            return ''

        return truncate_text(article_text, 4000)
    except Exception as e:
        print(f"   ⚠️  原文抓取失败: {e}")
        return ''

def parse_analysis(text, fallback_summary):
    summary = ''
    inspiration = ''

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('摘要：'):
            summary = line.replace('摘要：', '', 1).strip()
        elif line.startswith('启发：'):
            inspiration = line.replace('启发：', '', 1).strip()

    if not summary:
        summary = fallback_summary
    if not inspiration:
        inspiration = normalize_text(text) or '值得关注的行业动态'

    return truncate_text(summary, 120), truncate_text(inspiration, 100)

def generate_analysis(title, summary="", article_text=""):
    """生成摘要和启发，确保推送不是只有链接。"""
    fallback_summary = summary or truncate_text(title, 120)
    source_text = article_text or summary
    prompt = f"""你是一位资深汽车行业分析师。请基于以下热点新闻生成 Telegram 速递内容。

要求：
1. 摘要：用 40-70 字概括新闻事实，不要照抄标题
2. 启发：必须基于原文正文提炼，不要只根据标题或摘要发挥；用 50-90 字说明对车企、内容选题或行业趋势的启发，要有判断
3. 只输出两行，格式必须如下：
摘要：...
启发：...

热点标题：{title}
{f'原文正文：{source_text[:3500]}' if source_text else f'内容摘要：{summary[:300]}'}

请直接输出，不要添加其他说明："""

    try:
        return parse_analysis(call_claude(prompt, max_tokens=300), fallback_summary)
    except Exception as e:
        print(f"   ⚠️  摘要/启发生成失败: {e}")
        return truncate_text(fallback_summary, 120), "值得关注的行业动态，可继续跟踪后续产品节奏、价格策略和用户反馈。"

def send_telegram_message(text):
    """发送 Telegram 消息"""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    response = requests.post(url, json={
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "disable_web_page_preview": False
    }, timeout=20)

    if not response.ok:
        raise Exception(f"Telegram API error: {response.text}")

    return response.json()

def format_hotspot_digest(hotspots, time_label, title='🔥 汽车热点速递', start_index=1):
    """格式化热点速递消息"""
    header = f"""{title} - {datetime.now().strftime('%Y/%m/%d %H:%M')}

━━━━━━━━━━━━━━━━
"""

    items = []
    for i, hotspot in enumerate(hotspots, start_index):
        title = hotspot['标题']
        summary = hotspot['摘要']
        inspiration = hotspot['启发']
        link = hotspot['链接']

        item = f"""{i}️⃣ {title}
🧾 摘要：{summary}
💡 启发：{inspiration}
🔗 原文：{link}

━━━━━━━━━━━━━━━━
"""
        items.append(item)

    footer = f"\n📊 本次推送 {len(hotspots)} 条热点\n🤖 AI 摘要与启发 by Claude Opus"

    return header + '\n'.join(items) + footer

def main():
    print('🔥 Car Content Curator - Hotspot Digest')
    print('=' * 50)
    print()

    # 验证环境变量
    if not all([TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CLAUDE_API_KEY]):
        print('❌ 缺少必要的环境变量')
        return 1

    # 读取最新的 feed 数据
    today = datetime.now().strftime('%Y-%m-%d')
    feed_file = FEEDS_DIR / f'feed-{today}.json'

    if not feed_file.exists():
        print(f'❌ 未找到今天的 feed 数据: {feed_file}')
        return 1

    print(f'📂 读取数据: {feed_file}')

    with open(feed_file, 'r', encoding='utf-8') as f:
        feed_data = json.load(f)

    hotspots_raw = feed_data.get('热点列表', [])

    if not hotspots_raw:
        print('❌ 没有找到热点数据')
        return 1

    print(f'📊 找到 {len(hotspots_raw)} 条热点')

    # 选择热度最高的 10-15 条
    sorted_hotspots = sorted(hotspots_raw, key=lambda x: x.get('热度指数', 0), reverse=True)
    top_hotspots = sorted_hotspots[:12]  # 取前 12 条

    print(f'🎯 选择 Top {len(top_hotspots)} 条热点\n')

    # 为每条热点生成点评
    hotspots_with_commentary = []

    for i, hotspot in enumerate(top_hotspots, 1):
        title = hotspot.get('标题', '未知标题')
        link = hotspot.get('链接', '')
        summary = hotspot.get('内容摘要', '')
        display_title, digest_summary = prepare_hotspot_text(title, summary)

        print(f'📖 抓取原文 {i}/{len(top_hotspots)}: {display_title[:30]}...')
        article_text = fetch_article_text(link)
        if article_text:
            print(f'   ✓ 原文正文 {len(article_text)} 字')
        else:
            print('   ⚠️  未抓到完整原文，降级使用摘要')

        print(f'💬 生成摘要/启发 {i}/{len(top_hotspots)}: {display_title[:30]}...')

        digest_summary, inspiration = generate_analysis(display_title, digest_summary, article_text)

        hotspots_with_commentary.append({
            '标题': display_title,
            '链接': link,
            '摘要': digest_summary,
            '启发': inspiration
        })

        print(f'   ✓ 摘要: {digest_summary[:50]}...')

    # 格式化并发送
    print(f'\n📤 发送热点速递到 Telegram...')

    time_label = datetime.now().strftime('%H:%M')
    message = format_hotspot_digest(hotspots_with_commentary, time_label)

    # 如果消息太长，分段发送
    if len(message) > 4000:
        import time
        chunk_size = 4
        chunks = [
            hotspots_with_commentary[i:i + chunk_size]
            for i in range(0, len(hotspots_with_commentary), chunk_size)
        ]

        for idx, chunk in enumerate(chunks, 1):
            chunk_title = f"🔥 汽车热点速递（{idx}/{len(chunks)}）"
            chunk_message = format_hotspot_digest(
                chunk,
                time_label,
                title=chunk_title,
                start_index=(idx - 1) * chunk_size + 1
            )
            send_telegram_message(chunk_message)
            if idx < len(chunks):
                time.sleep(1)
    else:
        send_telegram_message(message)

    print('   ✓ 发送成功')
    print(f'\n✅ 热点速递推送完成！')

    return 0

if __name__ == '__main__':
    exit(main())
