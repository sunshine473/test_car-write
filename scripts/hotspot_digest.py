#!/usr/bin/env python3
"""
热点速递 - 独立推送热点 + AI 深度点评
"""

import os
import json
import requests
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

def call_claude(prompt):
    """调用 Claude API 生成点评"""
    url = f"{CLAUDE_BASE_URL}/v1/messages"

    response = requests.post(url, json={
        "model": "claude-opus-4-6",
        "max_tokens": 200,
        "messages": [{"role": "user", "content": prompt}]
    }, headers={
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }, timeout=30)

    if not response.ok:
        raise Exception(f"Claude API error: {response.text}")

    return response.json()['content'][0]['text'].strip()

def generate_commentary(title, summary=""):
    """生成有深度、有观点的点评"""
    prompt = f"""你是一位资深汽车行业分析师。请对以下热点新闻给出一句话点评（50-80字）。

要求：
1. 有深度：透过现象看本质，指出背后的商业逻辑、行业趋势或战略意图
2. 有观点：不要只是客观描述，要有自己的判断和洞察
3. 有态度：可以质疑、可以赞赏、可以预测，但要言之有据
4. 简洁有力：50-80字，一针见血

热点标题：{title}
{f'内容摘要：{summary[:200]}' if summary else ''}

请直接输出点评，不要前缀（如"点评："）："""

    try:
        return call_claude(prompt)
    except Exception as e:
        print(f"   ⚠️  点评生成失败: {e}")
        return "值得关注的行业动态"

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

def format_hotspot_digest(hotspots, time_label):
    """格式化热点速递消息"""
    header = f"""🔥 汽车热点速递 - {datetime.now().strftime('%Y/%m/%d %H:%M')}

━━━━━━━━━━━━━━━━
"""

    items = []
    for i, hotspot in enumerate(hotspots, 1):
        title = hotspot['标题']
        link = hotspot['链接']
        commentary = hotspot['点评']

        item = f"""{i}️⃣ {title}
🔗 {link}
💡 {commentary}

━━━━━━━━━━━━━━━━
"""
        items.append(item)

    footer = f"\n📊 本次推送 {len(hotspots)} 条热点\n🤖 AI 深度点评 by Claude Opus"

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

        print(f'💬 生成点评 {i}/{len(top_hotspots)}: {title[:30]}...')

        commentary = generate_commentary(title, summary)

        hotspots_with_commentary.append({
            '标题': title,
            '链接': link,
            '点评': commentary
        })

        print(f'   ✓ {commentary[:50]}...')

    # 格式化并发送
    print(f'\n📤 发送热点速递到 Telegram...')

    time_label = datetime.now().strftime('%H:%M')
    message = format_hotspot_digest(hotspots_with_commentary, time_label)

    # 如果消息太长，分段发送
    if len(message) > 4000:
        # 分成两部分
        mid = len(hotspots_with_commentary) // 2

        message1 = format_hotspot_digest(hotspots_with_commentary[:mid], time_label)
        message1 += f"\n\n（续 1/2）"

        message2 = f"🔥 汽车热点速递（续）\n\n━━━━━━━━━━━━━━━━\n\n"
        message2 += '\n'.join([
            format_hotspot_digest([h], time_label).split('━━━━━━━━━━━━━━━━\n\n')[1]
            for h in hotspots_with_commentary[mid:]
        ])
        message2 += f"\n\n（续 2/2）"

        send_telegram_message(message1)
        import time
        time.sleep(1)
        send_telegram_message(message2)
    else:
        send_telegram_message(message)

    print('   ✓ 发送成功')
    print(f'\n✅ 热点速递推送完成！')

    return 0

if __name__ == '__main__':
    exit(main())
