#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { getRunDate } from './runtime-context.js';

export { getRunDate } from './runtime-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..');
export const ARTICLES_DIR = join(PROJECT_ROOT, 'data', 'articles');

export function getArticleBatchPath(date = getRunDate()) {
  return join(ARTICLES_DIR, `batch-${date}.json`);
}

export function normalizeProjectPath(filePath) {
  return isAbsolute(filePath) ? relative(PROJECT_ROOT, filePath) : filePath;
}

export function resolveProjectPath(filePath) {
  return isAbsolute(filePath) ? filePath : join(PROJECT_ROOT, filePath);
}

export async function writeArticleBatch({
  date = getRunDate(),
  articleFiles,
  sourcePath = null,
  mode = 'sequential',
  metadata = {}
}) {
  const normalizedArticleFiles = articleFiles.map(normalizeProjectPath);
  const payload = {
    生成时间: new Date().toISOString(),
    日期: date,
    模式: mode,
    文章数: normalizedArticleFiles.length,
    文章文件: normalizedArticleFiles,
    来源文件: sourcePath ? normalizeProjectPath(sourcePath) : null,
    ...metadata
  };

  await mkdir(ARTICLES_DIR, { recursive: true });

  const batchPath = getArticleBatchPath(date);
  await writeFile(batchPath, JSON.stringify(payload, null, 2));

  return { batchPath, payload };
}

export async function readArticleBatch(date = getRunDate()) {
  const batchPath = getArticleBatchPath(date);
  try {
    const payload = JSON.parse(await readFile(batchPath, 'utf-8'));
    return { batchPath, payload };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`没有找到本次文章清单: ${batchPath}`);
    }
    throw err;
  }
}
