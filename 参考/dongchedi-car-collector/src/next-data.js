export function extractNextData(html, pageUrl) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error(`未找到 __NEXT_DATA__：${pageUrl}`);
  }

  return JSON.parse(match[1]);
}
