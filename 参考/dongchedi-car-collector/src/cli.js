#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { loadRules } from './config.js';
import { collectAndDownloadImages } from './images.js';
import { collectParams } from './params.js';
import { resolveSeries } from './resolver.js';

const program = new Command();

program
  .name('dongchedi-car-collector')
  .description('输入车型名或懂车帝车型 ID，采集完整参数与规则指定的官方图片')
  .option('-n, --car-name <name>', '车型名称，例如：小米SU7')
  .option('-s, --series-id <id>', '懂车帝车系 ID，例如：6187')
  .option('-u, --url <url>', '懂车帝车系 URL，例如：https://www.dongchedi.com/auto/series/6187')
  .option('-o, --out <dir>', '输出目录', 'output')
  .option('-r, --rules <path>', '采集规则 Markdown 文档路径')
  .option('--max-pages <count>', '车型 ID 搜索最大分页数', (value) => Number(value), 60)
  .parse();

const options = program.opts();

async function main() {
  const outputRoot = path.resolve(process.cwd(), options.out);
  const imagesDir = path.join(outputRoot, 'images');
  await mkdir(outputRoot, { recursive: true });
  const rules = await loadRules(options.rules);

  const resolved = await resolveSeries({
    carName: options.carName,
    seriesId: options.seriesId,
    url: options.url,
    maxPages: options.maxPages
  });

  const params = await collectParams(resolved.series_id, rules);
  const images = await collectAndDownloadImages(resolved.series_id, imagesDir, rules.imageSelection);

  const result = {
    task: {
      input: {
        car_name: options.carName ?? '',
        series_id: options.seriesId ? Number(options.seriesId) : null,
        url: options.url ?? ''
      },
      collected_at: new Date().toISOString()
    },
    rules: {
      path: rules.path
    },
    resolved_series: {
      series_id: resolved.series_id,
      series_name: params.series.series_name || resolved.series_name,
      brand_name: params.series.brand_name || resolved.brand_name,
      official_price: resolved.official_price,
      method: resolved.method,
      candidates: resolved.candidates
    },
    data: {
      source_pages: {
        series: `https://www.dongchedi.com/auto/series/${resolved.series_id}`,
        params: params.source_url,
        images: images.source_pages
      },
      params_full: {
        property_count: params.property_count,
        model_count: params.model_count,
        models: params.models
      },
      core_params: params.core_params,
      smart_params: params.smart_params,
      official_images: images
    }
  };

  const outputPath = path.join(outputRoot, 'dongchedi_car_data.json');
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    series_id: result.resolved_series.series_id,
    series_name: result.resolved_series.series_name,
    output_json: outputPath,
    image_count: images.downloaded_count,
    image_dir: imagesDir
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
