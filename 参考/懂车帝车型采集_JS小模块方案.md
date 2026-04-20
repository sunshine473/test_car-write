# 懂车帝车型采集 JS 小模块技术方案

> 状态：待确认  
> 日期：2026-04-11  
> 目标：输入车型名，在懂车帝定位对应车系 ID，采集完整车型参数与 3 张官方车型图，输出 JSON 与本地图片文件。  
> 说明：本阶段只确认技术方案，不输出实现代码。

## 1. 模块目标

输入一个车型名，例如：

```text
小米SU7
```

输出：

- 懂车帝车系 ID，即 `series_id`
- 懂车帝车系 URL
- 该车系下所有配置款的完整参数表
- 智能化相关参数的单独聚合
- 3 张下载到本地的官方车型图片
- 一个完整 JSON 文件

建议第一版只做“车型采集小模块”，不接入选题、写作、TTS、视频等后续流程。

## 2. 参考 follow-builders 的脚本模式

参考 `/Users/dora/Documents/car_write/follow-builders/scripts` 的做法：

- 使用 Node.js ESM，即 `package.json` 设置 `"type": "module"`
- 每个脚本可独立运行
- 采集逻辑由脚本确定性完成
- 输出统一 JSON
- 非致命问题写入 `errors` 或 `warnings`
- AI 后续只消费 JSON，不在采集阶段参与改写或补数据

本模块建议也采用这种形态。

## 3. 推荐目录结构

```text
dongchedi-car-collector/
  package.json
  README.md
  src/
    cli.js
    resolver.js
    fetch-page-data.js
    params-parser.js
    images-parser.js
    downloader.js
    output.js
  output/
    car_data.json
    images/
      01.jpg
      02.jpg
      03.jpg
```

如果你希望先更简单，也可以第一版只做：

```text
dongchedi-car-collector/
  package.json
  scrape-car.js
  output/
```

但考虑后续要扩展成完整内容生产系统，我更建议从一开始拆成小文件。

## 4. 技术选型

建议依赖：

```json
{
  "type": "module",
  "dependencies": {
    "commander": "^12.0.0",
    "playwright": "^1.40.0",
    "cheerio": "^1.0.0"
  }
}
```

说明：

- `commander`：处理命令行参数。
- `playwright`：用于车型名到 `series_id` 的站内搜索解析，以及必要时处理动态页面。
- `cheerio`：从 HTML 中提取 `__NEXT_DATA__` 或辅助解析页面。
- Node 18+ 自带 `fetch`，第一版不需要额外引入 `node-fetch`。

## 5. 懂车帝页面调研结论

### 5.1 车系页

车系页形态：

```text
https://www.dongchedi.com/auto/series/{series_id}
```

示例：

```text
https://www.dongchedi.com/auto/series/6187
```

用途：

- 校验 `series_id` 是否真实存在
- 获取车系名、品牌等基础信息
- 作为参数和图片来源的主引用 URL

### 5.2 参数页

调研发现当前 PC 参数页可用形态是：

```text
https://www.dongchedi.com/auto/params-carIds-x-{series_id}
```

示例：

```text
https://www.dongchedi.com/auto/params-carIds-x-6187
```

页面内有服务端注入的 `__NEXT_DATA__`，里面包含 `rawData`。页面正文也能看到参数分组，例如：

- 基本信息
- 车身
- 电动机
- 电池/充电
- 变速箱
- 底盘/转向
- 车轮/制动
- 主动安全
- 被动安全
- 辅助/操控配置
- 外部配置
- 内部配置
- 舒适/防盗配置
- 座椅配置
- 智能互联
- 影音娱乐
- 灯光配置
- 玻璃/后视镜
- 空调/冰箱
- 智能化配置
- 选装包

重点：`智能互联` 和 `智能化配置` 明确存在，适合单独抽取给后续写作使用。

### 5.3 图片页

外观图页面形态：

```text
https://www.dongchedi.com/auto/series/{series_id}/images-wg
```

示例：

```text
https://www.dongchedi.com/auto/series/6187/images-wg
```

页面同样有 `__NEXT_DATA__`，其中能拿到图片列表。调研时页面中可见字段形态类似：

```json
{
  "index": 0,
  "pic_url": "http://p3-dcd.byteimg.com/..."
}
```

图片下载策略：

- 第一版优先抓 `images-wg` 外观图。
- 下载前 3 张可用图片到本地。
- JSON 中保留原始 URL、下载路径和来源页。
- 如果外观图不足 3 张，再降级尝试内饰图页面。

可补充的图片分类：

```text
wg：外观
ns：内饰
kj：空间
gft：官方图
```

第一版建议优先 `wg`，失败时按 `gft -> ns -> kj` 降级。

## 6. ID 解析方案

输入车型名到 `series_id` 是本模块最容易不稳定的环节。

### 6.1 不建议只依赖猜测 URL

调研时尝试过类似：

```text
https://www.dongchedi.com/auto/library/series?kw=小米SU7
```

这类 URL 不适合作为唯一解析入口，因为页面可能不按 `kw` 稳定过滤，容易拿到泛化车系列表。

### 6.2 推荐第一版解析策略

使用 Playwright 打开懂车帝页面，通过站内搜索框完成真实搜索流程：

1. 打开 `https://www.dongchedi.com/`
2. 在搜索框输入车型名
3. 等待搜索建议或搜索结果出现
4. 提取所有 `/auto/series/{id}` 链接
5. 读取候选项展示文本、品牌名、价格等可见信息
6. 对候选项计算匹配分
7. 选出置信度最高的 `series_id`

匹配规则建议：

- 车型名完全相等：`confidence = 1.0`
- 去空格、大小写归一后相等：`confidence = 0.95`
- 输入车型名被候选名包含，或候选名被输入包含：`confidence = 0.85`
- 品牌/车系 token 部分命中：`confidence = 0.6 - 0.8`
- 低于 `0.75`：不自动选择，输出候选列表并报 `need_manual_selection`

### 6.3 备用解析策略

如果 Playwright 搜索流程失败：

1. 如果用户输入已经是懂车帝车系 URL，则直接解析 `/auto/series/{id}`。
2. 如果用户输入是数字，则按 `series_id` 尝试访问车系页校验。
3. 如果用户输入是车型名，但站内搜索无结果，则返回候选为空的错误 JSON，不伪造 ID。

## 7. 参数采集方案

### 7.1 原始数据入口

优先抓取：

```text
https://www.dongchedi.com/auto/params-carIds-x-{series_id}
```

解析方式：

1. 用 `fetch` 获取 HTML。
2. 从 HTML 提取 `<script id="__NEXT_DATA__" type="application/json">...</script>`。
3. `JSON.parse` 得到 Next.js 页面数据。
4. 从页面数据里读取参数页 `rawData`。
5. 将懂车帝参数结构转成模块自己的标准 JSON。

如果 `fetch` 拿不到完整数据，再用 Playwright 渲染页面后读取同一个 `__NEXT_DATA__` 或从页面 DOM 兜底解析。

### 7.2 “全部参数”的定义

这里的“全部参数”建议按懂车帝参数页分组完整保留，而不是只抽十几个字段。

输出层分两部分：

1. `params_full`
   - 按配置款逐列保存全部参数。
   - 不丢弃空值、选配、标配等信息。
   - 保留懂车帝原始参数 key，便于后续追溯。

2. `params_core`
   - 从 `params_full` 中抽取后续写作常用字段。
   - 仅用于方便消费，不替代完整参数表。

### 7.3 智能化参数必须单独聚合

单独输出 `smart_params`，至少覆盖以下分组：

- 主动安全
- 辅助/操控配置
- 智能互联
- 影音娱乐
- 智能化配置

优先保留这些字段：

- 辅助驾驶芯片
- 辅助驾驶芯片算力
- 激光雷达数量
- 激光雷达品牌
- 超声波雷达数量
- 摄像头 / 毫米波雷达相关字段
- 车道保持 / 车道居中 / 自适应巡航
- 自动泊车
- 高速或城市辅助驾驶相关能力
- 车载智能芯片
- 中控屏尺寸与分辨率
- 语音识别、免唤醒、唤醒词
- 5G / 车联网 / OTA
- CarPlay / Carlink / 原厂互联

注意：如果某字段在懂车帝页面里是空、未配备、选配或标配，要原样记录，不要改写成结论。

## 8. 图片采集方案

### 8.1 图片来源

优先来源：

```text
https://www.dongchedi.com/auto/series/{series_id}/images-wg
```

如果不足 3 张，按顺序尝试：

```text
https://www.dongchedi.com/auto/series/{series_id}/images-gft
https://www.dongchedi.com/auto/series/{series_id}/images-ns
https://www.dongchedi.com/auto/series/{series_id}/images-kj
```

### 8.2 下载规则

- 只下载 3 张。
- 保存到 `output/images/01.jpg`、`02.jpg`、`03.jpg`。
- 下载时使用浏览器 UA 和来源页 `Referer`。
- 下载成功后检查文件大小，空文件或明显异常文件视为失败。
- JSON 里记录原始 URL、来源页面、分类、下载路径、下载状态。

## 9. 输出 JSON 设计

建议输出到：

```text
output/car_data.json
```

建议结构：

```json
{
  "status": "ok",
  "generated_at": "2026-04-11T16:00:00+08:00",
  "input": {
    "car_name": "小米SU7"
  },
  "resolved": {
    "series_id": "6187",
    "series_name": "小米SU7",
    "brand_name": "小米汽车",
    "series_url": "https://www.dongchedi.com/auto/series/6187",
    "confidence": 1.0,
    "method": "playwright_site_search",
    "candidates": []
  },
  "params_core": {
    "price_range": "",
    "level": "",
    "energy_type": "",
    "body_structure": "",
    "body_size": "",
    "wheelbase": "",
    "range": "",
    "battery": "",
    "motor": "",
    "charging": "",
    "chassis": ""
  },
  "smart_params": {
    "groups": [
      {
        "group_name": "智能化配置",
        "items": []
      },
      {
        "group_name": "智能互联",
        "items": []
      }
    ]
  },
  "params_full": {
    "models": [
      {
        "car_id": "",
        "model_name": "",
        "year": "",
        "params_by_group": []
      }
    ]
  },
  "images": [
    {
      "index": 1,
      "category": "wg",
      "source": "懂车帝",
      "source_page": "https://www.dongchedi.com/auto/series/6187/images-wg",
      "url": "",
      "local_path": "output/images/01.jpg",
      "downloaded": true
    }
  ],
  "sources": [
    "https://www.dongchedi.com/auto/series/6187",
    "https://www.dongchedi.com/auto/params-carIds-x-6187",
    "https://www.dongchedi.com/auto/series/6187/images-wg"
  ],
  "warnings": [],
  "errors": []
}
```

## 10. 错误与降级策略

必须失败并停止：

- 找不到可信 `series_id`
- 参数页无法访问或无法解析 `__NEXT_DATA__`
- `params_full` 为空

可以降级继续：

- 图片某个分类不足 3 张：尝试其他分类
- 只有 1 到 2 张图：输出 JSON，但 `status` 可设为 `partial`
- 个别参数字段为空：保留为空，不补写
- 智能化字段某些车型为空：原样记录为空或页面原始状态

错误记录格式：

```json
{
  "step": "resolve_series_id",
  "level": "error",
  "message": "未找到可信车系 ID",
  "recoverable": false
}
```

## 11. 执行命令建议

第一版 CLI：

```text
node src/cli.js --car-name "小米SU7" --out output
```

后续可扩展：

```text
node src/cli.js --series-id 6187 --out output
node src/cli.js --url "https://www.dongchedi.com/auto/series/6187" --out output
node src/cli.js --car-name "小米SU7" --images 3 --out output
```

## 12. 验收标准

用 `小米SU7` 作为首个样例，验收标准：

- 能解析到 `series_id = 6187`
- 能输出车系页、参数页、图片页 3 个来源 URL
- `params_full.models` 包含该车系下所有配置款
- `params_full` 按懂车帝参数分组保留完整参数
- `smart_params` 不为空，且包含智能互联或智能化配置相关字段
- 本地存在 3 张图片：
  - `output/images/01.jpg`
  - `output/images/02.jpg`
  - `output/images/03.jpg`
- `output/car_data.json` 可被 `JSON.parse` 正常解析
- 不出现 AI 补写参数

## 13. 需要确认的方案点

我建议默认这样定：

- 输入优先支持 `--car-name`，同时预留 `--series-id` 与 `--url`。
- ID 解析用 Playwright 走懂车帝站内搜索，不强依赖不稳定的 URL 猜测。
- 参数抓取优先用 `fetch + __NEXT_DATA__`，Playwright 只做兜底。
- 参数输出保留“所有配置款 × 所有参数分组”的完整矩阵。
- 智能化相关参数额外生成 `smart_params`，方便后续写作。
- 图片下载 3 张到本地，优先外观图，失败时尝试官方图、内饰图、空间图。

如果你确认这个方案，下一步就可以进入 JS 小模块实现。
