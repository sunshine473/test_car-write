import { postFormJson } from './http.js';

const SERIES_LIST_API = 'https://www.dongchedi.com/motor/pc/car/brand/select_series_v2';

function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[\s\-_/·・.。,:：，（）()【】[\]{}]+/g, '');
}

function pickSeriesName(series) {
  return series.series_name || series.outter_name || series.name || '';
}

function scoreSeries(series, target) {
  const targetName = normalizeName(target);
  const seriesName = normalizeName(pickSeriesName(series));
  const brandName = normalizeName(series.brand_name || series.brand || '');
  const combinedName = normalizeName(`${brandName}${pickSeriesName(series)}`);

  if (!targetName || !seriesName) return 0;
  if (seriesName === targetName || combinedName === targetName) return 100;
  if (seriesName.includes(targetName) || targetName.includes(seriesName)) return 90;
  if (combinedName.includes(targetName) || targetName.includes(combinedName)) return 85;

  const targetChars = new Set([...targetName]);
  const overlap = [...seriesName].filter((char) => targetChars.has(char)).length;
  return overlap / Math.max(seriesName.length, targetName.length);
}

function normalizeSeries(series, score) {
  return {
    series_id: Number(series.id ?? series.series_id),
    series_name: pickSeriesName(series),
    brand_name: series.brand_name || series.brand || '',
    official_price: series.official_price || series.price || '',
    score
  };
}

export function parseSeriesId(input) {
  if (!input) return null;
  const text = String(input);
  const match = text.match(/(?:series\/|series_id=|^)(\d{3,})/);
  return match ? Number(match[1]) : null;
}

export async function resolveSeries({ carName, seriesId, url, maxPages = 60 }) {
  const explicitSeriesId = Number(seriesId) || parseSeriesId(url);
  if (explicitSeriesId) {
    return {
      series_id: explicitSeriesId,
      series_name: carName || '',
      brand_name: '',
      official_price: '',
      method: 'explicit',
      candidates: []
    };
  }

  if (!carName) {
    throw new Error('需要传入 --car-name、--series-id 或 --url');
  }

  const candidates = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await postFormJson(SERIES_LIST_API, {
      city_name: '全国',
      limit: '100',
      page: String(page)
    });

    if (result.status !== 0) {
      throw new Error(`车型列表接口返回异常：${JSON.stringify(result).slice(0, 300)}`);
    }

    const seriesList = result.data?.series ?? result.data?.series_list ?? [];
    for (const series of seriesList) {
      const score = scoreSeries(series, carName);
      if (score > 0) {
        candidates.push(normalizeSeries(series, score));
      }
    }

    const total = Number(result.data?.series_count ?? result.data?.total ?? 0);
    const loaded = page * 100;
    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    if (best?.score >= 100 || (total > 0 && loaded >= total)) break;
  }

  const sorted = candidates
    .filter((item) => Number.isFinite(item.series_id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (!sorted.length || sorted[0].score < 0.75) {
    throw new Error(`未能匹配车型：${carName}`);
  }

  return {
    ...sorted[0],
    method: 'select_series_v2',
    candidates: sorted
  };
}
