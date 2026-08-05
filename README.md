# Taobao Parcel Scanner

手機版淘寶退貨包裹分貨工具。員工用手機掃描包裹標籤左下角淘寶 QR Code，拍下標籤照片，系統會把資料寫入 Google Sheet，並用 AI 先做現場分貨大類判斷。

## 使用頁面

- 員工分貨掃描：<https://leonzooz.github.io/taobao-parcel-scanner/>
- 客人商品查看：<https://leonzooz.github.io/taobao-parcel-scanner/customer.html>
- AI 分類測試頁：<https://leonzooz.github.io/taobao-parcel-scanner/ai-classify-test.html>

如果手機端看到舊畫面，可以在網址後面加版本參數避免快取：

```text
https://leonzooz.github.io/taobao-parcel-scanner/?v=test
```

## 主要流程

1. 員工打開手機頁面。
2. 掃標籤左下角淘寶商品 QR Code。
3. 非淘寶 QR Code 會被忽略。
4. 取得淘寶商品連結後，拍標籤照片。
5. 手機端把壓縮照片送到 Apps Script。
6. Apps Script 呼叫 Groq Vision 做即時分貨分類。
7. 分類結果顯示在照片區，員工可直接確認或手動改分類。
8. 按「確定上傳」後寫入 Google Sheet，照片存到 Google Drive。
9. 後台可再跑 Google Drive OCR 補商品名稱、規格、價格等欄位。
10. PC 腳本可抓淘寶商品首圖，供客人頁展示。

## 分貨大類

目前現場大類固定為：

```text
待分類
衣鞋包
家居電器
3C數碼
美妝個護
母嬰兒童
文具樂器
其他
```

AI 判斷順序：

1. 優先讀標籤上的 `品类` 或 `品類` 後面的文字。
2. 用標籤品類轉換成現場分貨大類。
3. 如果讀不到品類，才從商品名稱判斷。

例子：

```text
品类足球袜 -> 衣鞋包
品类大码内搭 -> 衣鞋包
品类卷纸器/纸巾架 -> 家居電器
品类破壁机 -> 家居電器
品类投影仪 -> 3C數碼
品类笛子 -> 文具樂器
```

## Google Sheet 欄位

目前 Apps Script 會建立/使用以下欄位：

```text
時間戳記
包裹編號
商品名稱
規格
品類
商品連結
原始價格
建議售價
狀態
掃描時間
標籤照片URL
照片FileID
OCR狀態
OCR時間
OCR原始文字
來源
商品首圖URL
商品首圖FileID
首圖狀態
客人展示狀態
現場分貨區
AI分貨區
AI信心
AI原因
AI分類時間
```

## Apps Script 設定

把 `apps-script.gs` 貼到 Google Apps Script 的 `程式碼.gs`。

部署方式：

1. 儲存。
2. 部署。
3. 管理部署。
4. 編輯目前 Web App 部署。
5. 選擇「新版本」。
6. 部署。

Web App 權限建議：

```text
執行身分：我
誰可以存取：任何人
```

## 指令碼屬性

Apps Script 專案設定中新增：

```text
GROQ_API_KEY
```

值填 Groq API Key。

可選：

```text
GROQ_MODEL
```

預設模型：

```text
meta-llama/llama-4-scout-17b-16e-instruct
```

## Google Drive OCR

如果要使用後台 OCR，Apps Script 左側「服務」要加入：

```text
Drive API
```

OCR 用來補完整欄位，例如商品名稱、規格、價格、包裹編號。手機即時分貨不依賴 Drive OCR。

## PC 抓商品首圖

PC 腳本：

```text
pc-fetch-product-images.mjs
```

雙擊啟動檔：

```text
run-fetch-images-safe.bat
```

用途：

1. 從 Google Sheet 找 `首圖狀態 = 待抓圖` 的列。
2. 用已登入淘寶的 Chrome 開商品頁。
3. 抓商品 slider 主圖。
4. 上傳到 Google Drive。
5. 回寫 `商品首圖URL` 和 `商品首圖FileID`。

執行前先在專案目錄安裝依賴：

```powershell
npm install
```

手動執行：

```powershell
npm run fetch-images
```

## 重要檔案

```text
index.html                 員工手機掃描頁
customer.html              客人查看商品頁
ai-classify-test.html      AI 分類測試頁
apps-script.gs             Google Apps Script 後端
pc-fetch-product-images.mjs PC 抓淘寶商品首圖腳本
run-fetch-images-safe.bat  雙擊執行抓圖腳本
```

## 常見問題

### AI 分類超過 3 秒

代表手機端先放棄等待，仍可上傳。資料會寫成 `待分類`。

可以在 `index.html` 搜尋：

```javascript
setTimeout(function() {
```

把 `3000` 改成 `6000` 或 `8000`。

### Groq 有 API Calls 但沒有分類

代表 API Key 有通，但回應超過手機等待時間，或模型回傳錯誤。先看 Apps Script 執行紀錄，再決定是否延長 timeout。

### 上傳成功但沒有照片

檢查 Apps Script 是否重新部署新版，並確認 Web App 執行身分是「我」。

### Google Sheet 欄位錯位

請確認第一列欄位和 `apps-script.gs` 的 `ensureHeaders_` 一致。不要手動刪掉中間欄位。

## 目前建議

退貨包裹多半是單品處理，不建議一開始做正式 SKU 系統。現階段先用 Google Sheet 的列資料、淘寶連結、標籤照片和內部分貨區即可。

如果未來要做倉庫內部條碼，建議使用 `Code 128` 產生內部處理碼，不需要 GS1 國際商品條碼。
