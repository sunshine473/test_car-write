import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchText, fetchWithRetry, normalizeUrl } from './http.js';
import { extractNextData } from './next-data.js';

function fileExtension(url) {
  const pathname = new URL(normalizeUrl(url)).pathname.toLowerCase();
  if (pathname.endsWith('.png')) return '.png';
  if (pathname.endsWith('.webp')) return '.webp';
  return '.jpg';
}

function imagePageUrl(seriesId, category) {
  return `https://www.dongchedi.com/auto/series/${seriesId}/images-${category}`;
}

async function collectImageUrlsFromCategory(seriesId, category) {
  const pageUrl = imagePageUrl(seriesId, category);
  const html = await fetchText(pageUrl, {
    headers: { referer: `https://www.dongchedi.com/auto/series/${seriesId}` }
  });
  const nextData = extractNextData(html, pageUrl);
  const pictureInfo = nextData.props?.pageProps?.pictureInfo;
  const urls = [];

  for (const group of pictureInfo?.picture_list ?? []) {
    for (const url of group.pic_url ?? []) {
      urls.push({
        source_url: normalizeUrl(url),
        category,
        car_id: group.car_id ?? null,
        car_name: group.car_name ?? ''
      });
    }
  }

  return { pageUrl, urls };
}

export async function collectAndDownloadImages(seriesId, outputDir, imageSelection) {
  await mkdir(outputDir, { recursive: true });

  const seen = new Set();
  const candidates = [];
  const sourcePages = [];

  for (const selection of imageSelection) {
    const result = await collectImageUrlsFromCategory(seriesId, selection.category);
    sourcePages.push(result.pageUrl);

    const selectedIndices = selection.indices?.length
      ? selection.indices
      : Array.from({ length: selection.count ?? 0 }, (_item, index) => index);

    for (const [roleIndex, imageIndex] of selectedIndices.entries()) {
      const image = result.urls[imageIndex];
      if (!image) continue;
      if (!seen.has(image.source_url)) {
        seen.add(image.source_url);
        candidates.push({
          ...image,
          label: selection.label,
          role: selection.roles?.[roleIndex] ?? `${selection.label || selection.category}${roleIndex + 1}`
        });
      }
    }
  }

  const downloaded = [];

  for (const [index, image] of candidates.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}${fileExtension(image.source_url)}`;
    const localPath = path.join(outputDir, filename);
    const response = await fetchWithRetry(image.source_url, {
      headers: {
        referer: imagePageUrl(seriesId, image.category),
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, buffer);

    downloaded.push({
      index: index + 1,
      category: image.category,
      label: image.label,
      role: image.role,
      car_id: image.car_id,
      car_name: image.car_name,
      source_url: image.source_url,
      local_path: localPath,
      bytes: buffer.length
    });
  }

  return {
    source_pages: sourcePages,
    requested_count: candidates.length,
    downloaded_count: downloaded.length,
    images: downloaded
  };
}
