import { fetchText } from './http.js';
import { extractNextData } from './next-data.js';
import { keywordMatcher } from './config.js';

function fieldValue(field) {
  if (!field || typeof field !== 'object') return '';
  return field.value ?? '';
}

function normalizeField(property, field) {
  return {
    key: property.key,
    name: property.text,
    value: fieldValue(field),
    icon_type: field?.icon_type ?? null,
    icon_url: field?.icon_url ?? '',
    config_price: field?.config_price ?? '',
    light_config: field?.light_config ?? null,
    wiki_abstract: field?.wiki_info?.abstract ?? ''
  };
}

function buildGroups(properties, carInfo) {
  const groups = [];
  let current = null;
  let currentSection = null;

  for (const property of properties) {
    if (property.type === 0) {
      current = {
        key: property.key,
        name: property.text,
        kind: 'section',
        items: []
      };
      currentSection = current;
      groups.push(current);
      continue;
    }

    if (property.type === 2) {
      current = {
        key: property.key || property.text,
        name: property.text,
        kind: 'subsection',
        parent_key: currentSection?.key ?? '',
        parent_name: currentSection?.name ?? '',
        items: []
      };
      groups.push(current);
      continue;
    }

    if (!current) {
      current = { key: 'ungrouped', name: '未分组', kind: 'section', items: [] };
      groups.push(current);
    }

    current.items.push(normalizeField(property, carInfo.info?.[property.key]));
  }

  return groups;
}

function buildModel(carInfo, properties) {
  return {
    car_id: Number(carInfo.car_id),
    model_name: `${carInfo.car_year ? `${carInfo.car_year}款 ` : ''}${carInfo.car_name}`,
    car_name: carInfo.car_name,
    car_year: carInfo.car_year,
    sale_status: carInfo.sale_status,
    brand_name: carInfo.brand_name,
    brand_id: Number(carInfo.brand_id),
    series_id: Number(carInfo.series_id),
    series_name: carInfo.series_name,
    official_price: carInfo.official_price,
    dealer_price: carInfo.dealer_price,
    dealer_text: carInfo.dealer_text,
    params_by_group: buildGroups(properties, carInfo)
  };
}

function pickParams(models, matcher) {
  return models.map((model) => ({
    car_id: model.car_id,
    model_name: model.model_name,
    groups: model.params_by_group
      .map((group) => ({
        key: group.key,
        name: group.name,
        items: group.items.filter((item) => matcher(group, item))
      }))
      .filter((group) => group.items.length > 0)
  }));
}

export async function collectParams(seriesId, rules) {
  const matchCoreParam = keywordMatcher(rules.coreParamKeywords);
  const matchSmartParam = keywordMatcher(rules.smartParamKeywords);
  const smartGroupNames = new Set(rules.smartGroupNames);
  const pageUrl = `https://www.dongchedi.com/auto/params-carIds-x-${seriesId}`;
  const html = await fetchText(pageUrl, { headers: { referer: `https://www.dongchedi.com/auto/series/${seriesId}` } });
  const nextData = extractNextData(html, pageUrl);
  const rawData = nextData.props?.pageProps?.rawData;

  if (!rawData?.properties?.length || !rawData?.car_info?.length) {
    throw new Error(`参数页数据结构异常：${pageUrl}`);
  }

  const models = rawData.car_info.map((carInfo) => buildModel(carInfo, rawData.properties));
  const firstModel = models[0];

  return {
    source_url: pageUrl,
    series: {
      series_id: Number(seriesId),
      series_name: firstModel.series_name,
      brand_name: firstModel.brand_name,
      brand_id: firstModel.brand_id
    },
    models,
    core_params: pickParams(models, (_group, item) => matchCoreParam(item.name)),
    smart_params: pickParams(
      models,
      (group, item) => smartGroupNames.has(group.name) || matchSmartParam(`${group.name} ${item.name}`)
    ),
    property_count: rawData.properties.length,
    model_count: rawData.car_info.length
  };
}
