# 懂车帝车型采集小模块

输入车型名、懂车帝车系 ID 或懂车帝车系 URL，输出一个 JSON 文件，并按规则下载官方图片到本地。

```bash
npm install
npm run scrape -- --car-name "小米SU7" --out output/xiaomi-su7
```

也可以直接传车系 ID：

```bash
npm run scrape -- --series-id 6187 --out output/xiaomi-su7
```

输出文件：

- `dongchedi_car_data.json`：包含车系匹配结果、全量参数、核心参数、智能化相关参数、图片来源与本地路径。
- `images/01.jpg` 等：从官方图片页下载的图片。

采集规则默认读取：

```text
/Users/dora/Documents/car_write/参考/懂车帝采集规则.md
```

当前图片规则：

- 外饰：取 `wg` 分类前 3 张，分别标记为正面、向左45度、向右45度。
- 内饰：取 `ns` 分类前 2 张。
