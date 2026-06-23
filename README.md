# ⚽ 2026世界杯预测 H5

基于盘口赔率数据的赛前预测分析工具，面向普通足球爱好者，手机端友好。

## 功能

- 📊 **赛前预测**：盘口建议 / 大小球建议 / 胜平负建议 / 比分建议
- 📈 **数据分析**：初盘vs即时盘对比、水位变化、多公司赔率交叉验证
- 📱 **移动端优化**：≤480px 响应式布局，卡片式设计

## 技术栈

| 层 | 技术 |
|---|------|
| 数据爬取 | Python 3 + requests |
| 数据存储 | 静态 JSON（`public/data/matches.json`） |
| 预测引擎 | 纯 JavaScript 规则引擎（浏览器端运行） |
| 前端 | 纯 HTML/CSS/JS，无框架 |
| 定时更新 | GitHub Actions（每4小时） |
| 部署 | Vercel 静态托管 |

## 数据来源

爬取自 [球探体育](https://zq.titan007.com/cn/CupMatch/75.html) 2026世界杯赛程页面。

## 项目结构

```
├── crawler/              # Python 爬虫
│   ├── main.py           # 爬虫主程序
│   └── requirements.txt
├── public/               # H5 静态站点（部署目录）
│   ├── index.html        # 比赛列表页
│   ├── css/style.css     # 样式
│   ├── js/
│   │   ├── app.js        # 应用主逻辑
│   │   └── predict.js    # 预测算法引擎
│   └── data/
│       └── matches.json  # 爬虫产出数据
├── .github/workflows/
│   └── crawl.yml         # 定时爬取（每4h）
├── vercel.json           # Vercel 部署配置
└── README.md
```

## 本地运行

```bash
# 1. 安装 Python 依赖
pip install -r crawler/requirements.txt

# 2. 运行爬虫获取数据
python crawler/main.py

# 3. 启动本地服务
python -m http.server 8080 --directory public
# 访问 http://localhost:8080
```

## 部署到 Vercel

1. 将项目推送到 GitHub
2. 在 Vercel 中导入项目，设置 Root Directory 为 `public`
3. 部署完成后，GitHub Actions 会每4小时自动更新数据

## 预测算法说明

核心思路：**"跟着盘口走"** — 机构的信息优势远大于普通球迷

- **盘口建议**：分析初盘→即时盘的盘口/水位变化，升盘+低水=看好，降盘=看衰
- **大小球建议**：大小球线升降趋势 + 水位判断
- **胜平负建议**：欧赔赔率 + 亚盘交叉验证，检测信号矛盾
- **比分建议**：盘口深度推算进球差 + 大小球推算总进球 → 交叉得出

## 免责声明

本工具仅供足球爱好者娱乐参考，所有预测均基于公开赔率数据的规则分析，不构成任何投注建议。
