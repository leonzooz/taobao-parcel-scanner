# PC 抓商品首圖工具

這個工具用 PC 的 Chrome 打開淘寶商品頁，抓商品首圖後上傳到 Apps Script，再回填 Google Sheet 的 Q/R/S/T 欄。

## 第一次使用

1. 先把最新版 `apps-script.gs` 貼到 Google Apps Script。
2. 儲存後重新部署 Web App，因為這次新增了 PC 工具會呼叫的 `doGet/doPost` 接口。
3. 在 PC 打開此專案資料夾。
4. 安裝套件：

```bash
npm install
```

5. 執行：

```bash
npm run fetch-images
```

第一次會打開 Chrome。如果淘寶要求登入，請在 Chrome 視窗登入淘寶，然後回到命令列按 Enter 繼續。

## 之後使用

```bash
npm run fetch-images
```

工具會讀取 Sheet 裡 `首圖狀態` 是 `待抓圖` 或 `抓圖失敗` 的資料，抓到後回填：

- Q：商品首圖URL
- R：商品首圖FileID
- S：已抓圖
- T：可展示

## 調整一次處理筆數

預設一次最多 20 筆。可以改成：

```bash
$env:LIMIT="5"; npm run fetch-images
```

## 重要資料夾

- `pc-chrome-profile`：工具專用 Chrome 登入狀態。
- `pc-product-images`：本機暫存的商品首圖。

這兩個資料夾不用上傳 GitHub。
