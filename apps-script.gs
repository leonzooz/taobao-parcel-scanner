function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params.action === "lookup") {
    return lookupProduct_(params);
  }

  if (params.action === "pendingProductImages") {
    return pendingProductImages_(params);
  }

  return ContentService.createTextOutput("success");
}

function doPost(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params.mode === "classifyLabel") {
    return handleClassifyLabel_(params);
  }

  if (params.mode === "productImage") {
    return handleProductImageUpload_(params);
  }

  if (params.mode === "productImageError") {
    return handleProductImageError_(params);
  }

  return handleUpload_(e);
}

function handleClassifyLabel_(params) {
  var startedAt = new Date().getTime();

  try {
    var imageData = params.imageData || params.photoData || "";

    if (!imageData) {
      throw new Error("缺少 imageData");
    }

    var result = classifyLabelWithGroq_(imageData);

    result.status = "success";
    result.elapsed_ms = new Date().getTime() - startedAt;

    return jsonOutput_(result, params.callback || "");

  } catch (error) {
    return jsonOutput_({
      status: "error",
      message: error.toString(),
      elapsed_ms: new Date().getTime() - startedAt
    }, params.callback || "");
  }
}

function handleUpload_(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var mode = params.mode || "";

    if (mode && mode !== "staff") {
      return jsonOutput_({
        status: "error",
        message: "不接受的上傳模式：" + mode
      }, params.callback || "");
    }

    var productUrl = params.productUrl || params.product_url || "";
    var photoData = params.photoData || "";

    if (!productUrl || !photoData) {
      return jsonOutput_({
        status: "error",
        message: "缺少商品連結或標籤照片，未寫入 Sheet"
      }, params.callback || "");
    }

    var status = params.status || "待整理";
    var scanTime = params.scanTime || new Date().toLocaleString();
    var photoName = params.photoName || (new Date().getTime() + ".jpg");
    var sortArea = params.sort_area || params.sortArea || "待分類";
    var aiSortArea = params.ai_sort_area || params.aiSortArea || "";
    var aiConfidence = params.ai_confidence || params.aiConfidence || "";
    var aiReason = params.ai_reason || params.aiReason || "";
    var aiClassifiedAt = params.ai_classified_at || params.aiClassifiedAt || "";

    var photoUrl = "";
    var photoFileId = "";

    if (photoData !== "") {
      var folders = DriveApp.getFoldersByName("TaobaoParcelLabelPhotos");
      var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("TaobaoParcelLabelPhotos");

      var base64 = photoData;

      if (base64.indexOf(",") !== -1) {
        base64 = base64.split(",")[1];
      }

      var decodedData = Utilities.base64Decode(base64);
      var blob = Utilities.newBlob(decodedData, "image/jpeg", photoName);
      var file = folder.createFile(blob);

      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      photoUrl = file.getUrl();
      photoFileId = file.getId();
    }

    var sheet = getDataSheet_();
    ensureHeaders_(sheet);

    sheet.appendRow([
      new Date(),
      "",
      "",
      "",
      "",
      productUrl,
      "",
      "",
      status,
      scanTime,
      photoUrl,
      photoFileId,
      "待 OCR",
      "",
      "",
      "staff",
      "",
      "",
      "待抓圖",
      "整理中",
      sortArea,
      aiSortArea,
      aiConfidence,
      aiReason,
      aiClassifiedAt
    ]);

    return jsonOutput_({
      status: "success",
      productUrl: productUrl,
      photoUrl: photoUrl,
      photoFileId: photoFileId
    }, params.callback);

  } catch (error) {
    return jsonOutput_({
      status: "error",
      message: error.toString()
    }, "");
  }
}

function lookupProduct_(params) {
  try {
    var productUrl = params.productUrl || params.product_url || "";
    var callback = params.callback || "";
    var sheet = getDataSheet_();

    ensureHeaders_(sheet);

    var values = sheet.getDataRange().getValues();
    var normalizedTarget = normalizeUrl_(productUrl);
    var found = null;

    for (var i = values.length - 1; i >= 1; i--) {
      var row = values[i];
      var rowProductUrl = row[5] || "";

      if (normalizeUrl_(rowProductUrl) === normalizedTarget) {
        found = row;
        break;
      }
    }

    if (!found) {
      return jsonOutput_({
        status: "success",
        found: false,
        productUrl: productUrl,
        message: "商品資料整理中"
      }, callback);
    }

    var productImageUrl = found[16] || "";
    var productImageFileId = found[17] || "";

    if (!productImageUrl && productImageFileId) {
      productImageUrl = driveImageUrl_(productImageFileId);
    }

    return jsonOutput_({
      status: "success",
      found: true,
      timestamp: found[0] || "",
      packageNo: found[1] || "",
      productName: found[2] || "",
      spec: found[3] || "",
      category: found[4] || "",
      productUrl: found[5] || productUrl,
      originalPrice: found[6] || "",
      suggestedPrice: found[7] || "",
      itemStatus: found[8] || "",
      labelPhotoUrl: found[10] || "",
      labelPhotoFileId: found[11] || "",
      ocrStatus: found[12] || "",
      productImageUrl: productImageUrl,
      productImageFileId: productImageFileId,
      imageStatus: found[18] || "",
      customerDisplayStatus: found[19] || "整理中"
    }, callback);

  } catch (error) {
    return jsonOutput_({
      status: "error",
      found: false,
      message: error.toString()
    }, params.callback || "");
  }
}

function pendingProductImages_(params) {
  try {
    var callback = params.callback || "";
    var limit = Number(params.limit || 20);
    var sheet = getDataSheet_();
    ensureHeaders_(sheet);

    var lastRow = sheet.getLastRow();
    var items = [];

    if (lastRow < 2) {
      return jsonOutput_({ status: "success", items: items }, callback);
    }

    var values = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var productUrl = row[5] || "";
      var productImageUrl = row[16] || "";
      var productImageFileId = row[17] || "";
      var imageStatus = row[18] || "";

      if (!productUrl || imageStatus === "已抓圖" || (productImageUrl && productImageFileId)) {
        continue;
      }

      if (imageStatus && imageStatus !== "待抓圖" && imageStatus !== "抓圖失敗") {
        continue;
      }

      items.push({
        rowNumber: i + 2,
        productUrl: productUrl,
        productName: row[2] || "",
        spec: row[3] || "",
        category: row[4] || "",
        originalPrice: row[6] || "",
        imageStatus: imageStatus || "待抓圖"
      });

      if (items.length >= limit) {
        break;
      }
    }

    return jsonOutput_({ status: "success", items: items }, callback);

  } catch (error) {
    return jsonOutput_({
      status: "error",
      message: error.toString(),
      items: []
    }, params.callback || "");
  }
}

function handleProductImageUpload_(params) {
  try {
    var rowNumber = Number(params.rowNumber || 0);
    var productUrl = params.productUrl || "";
    var imageName = params.imageName || ("product-" + new Date().getTime() + ".jpg");
    var imageData = params.imageData || "";
    var imageSourceUrl = params.imageSourceUrl || "";

    if (!rowNumber || !productUrl || !imageData) {
      throw new Error("缺少 rowNumber、productUrl 或 imageData");
    }

    var sheet = getDataSheet_();
    ensureHeaders_(sheet);

    var rowProductUrl = sheet.getRange(rowNumber, 6).getValue();

    if (normalizeUrl_(rowProductUrl) !== normalizeUrl_(productUrl)) {
      throw new Error("商品連結不一致，停止回填");
    }

    var base64 = imageData;

    if (base64.indexOf(",") !== -1) {
      base64 = base64.split(",")[1];
    }

    var contentType = params.contentType || "image/jpeg";
    var folders = DriveApp.getFoldersByName("TaobaoProductImages");
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("TaobaoProductImages");
    var decodedData = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(decodedData, contentType, imageName);
    var file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var photoUrl = driveImageUrl_(fileId);
    var productName = sheet.getRange(rowNumber, 3).getValue();

    sheet.getRange(rowNumber, 17).setValue(photoUrl);
    sheet.getRange(rowNumber, 18).setValue(fileId);
    sheet.getRange(rowNumber, 19).setValue("已抓圖");
    sheet.getRange(rowNumber, 20).setValue(productName ? "可展示" : "整理中");

    return jsonOutput_({
      status: "success",
      rowNumber: rowNumber,
      productUrl: productUrl,
      imageSourceUrl: imageSourceUrl,
      productImageUrl: photoUrl,
      productImageFileId: fileId
    }, params.callback || "");

  } catch (error) {
    return jsonOutput_({
      status: "error",
      message: error.toString()
    }, params.callback || "");
  }
}

function handleProductImageError_(params) {
  try {
    var rowNumber = Number(params.rowNumber || 0);
    var productUrl = params.productUrl || "";
    var message = params.message || "PC抓圖失敗";

    if (!rowNumber || !productUrl) {
      throw new Error("缺少 rowNumber 或 productUrl");
    }

    var sheet = getDataSheet_();
    ensureHeaders_(sheet);

    var rowProductUrl = sheet.getRange(rowNumber, 6).getValue();

    if (normalizeUrl_(rowProductUrl) !== normalizeUrl_(productUrl)) {
      throw new Error("商品連結不一致，停止回填錯誤狀態");
    }

    sheet.getRange(rowNumber, 19).setValue("抓圖失敗");
    sheet.getRange(rowNumber, 20).setValue("整理中");

    return jsonOutput_({
      status: "success",
      rowNumber: rowNumber,
      message: message
    }, params.callback || "");

  } catch (error) {
    return jsonOutput_({
      status: "error",
      message: error.toString()
    }, params.callback || "");
  }
}

function processPendingOcr() {
  var sheet = getDataSheet_();
  ensureHeaders_(sheet);

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  var processedCount = 0;

  for (var i = 0; i < values.length; i++) {
    var rowNumber = i + 2;
    var row = values[i];
    var photoFileId = row[11] || "";
    var ocrStatus = row[12] || "";

    if (!photoFileId || ocrStatus !== "待 OCR") {
      continue;
    }

    try {
      sheet.getRange(rowNumber, 13).setValue("OCR中");
      SpreadsheetApp.flush();

      var rawText = runDriveOcr_(photoFileId);
      var parsed = parseLabelText_(rawText);
      var now = new Date();

      sheet.getRange(rowNumber, 2).setValue(parsed.packageNo);
      sheet.getRange(rowNumber, 3).setValue(parsed.productName);
      sheet.getRange(rowNumber, 4).setValue(parsed.spec);
      sheet.getRange(rowNumber, 5).setValue(parsed.category);
      sheet.getRange(rowNumber, 7).setValue(parsed.price);
      sheet.getRange(rowNumber, 13).setValue("已 OCR");
      sheet.getRange(rowNumber, 14).setValue(now);
      sheet.getRange(rowNumber, 15).setValue(rawText);

      processedCount++;

      if (processedCount >= 10) {
        break;
      }

    } catch (error) {
      sheet.getRange(rowNumber, 13).setValue("OCR失敗");
      sheet.getRange(rowNumber, 14).setValue(new Date());
      sheet.getRange(rowNumber, 15).setValue(error.toString());
    }
  }
}

function processPendingProductImages() {
  var sheet = getDataSheet_();
  ensureHeaders_(sheet);

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  var processedCount = 0;

  for (var i = 0; i < values.length; i++) {
    var rowNumber = i + 2;
    var row = values[i];
    var productUrl = row[5] || "";
    var productName = row[2] || "";
    var productImageUrl = row[16] || "";
    var productImageFileId = row[17] || "";
    var imageStatus = row[18] || "";

    if (!productUrl || (productImageUrl && productImageFileId) || imageStatus === "已抓圖") {
      continue;
    }

    if (imageStatus && imageStatus !== "待抓圖" && imageStatus !== "抓圖失敗") {
      continue;
    }

    try {
      sheet.getRange(rowNumber, 19).setValue("抓圖中");
      SpreadsheetApp.flush();

      var imageUrl = findProductImageUrl_(productUrl);

      if (!imageUrl) {
        sheet.getRange(rowNumber, 19).setValue("抓圖失敗");
        sheet.getRange(rowNumber, 20).setValue("整理中");
        continue;
      }

      var savedImage = saveProductImage_(imageUrl, productUrl);

      sheet.getRange(rowNumber, 17).setValue(savedImage.url || imageUrl);
      sheet.getRange(rowNumber, 18).setValue(savedImage.fileId || "");
      sheet.getRange(rowNumber, 19).setValue("已抓圖");

      if (productName) {
        sheet.getRange(rowNumber, 20).setValue("可展示");
      } else {
        sheet.getRange(rowNumber, 20).setValue("整理中");
      }

      processedCount++;

      if (processedCount >= 10) {
        break;
      }

    } catch (error) {
      sheet.getRange(rowNumber, 19).setValue("抓圖失敗");
      sheet.getRange(rowNumber, 20).setValue("整理中");
    }
  }
}

function processAllPending() {
  processPendingOcr();
  processPendingProductImages();
}

function classifyLabelWithGroq_(imageData) {
  var apiKey = getGroqApiKey_();
  var model = PropertiesService.getScriptProperties().getProperty("GROQ_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct";
  var dataUrl = normalizeImageDataUrl_(imageData);
  var prompt = [
    "你是倉庫分貨員的助手。請看淘寶包裹標籤照片，讀取標籤上的中文商品資訊，判斷現場分貨大類。",
    "只能從以下 sort_area 選一個：衣鞋包、家居電器、3C數碼、美妝個護、母嬰兒童、文具樂器、其他。",
    "判斷順序：第一優先讀標籤中「品类」或「品類」後面的文字，作為 source_category；常見位置在「重量:0 价格:xx.xx 品类xxxx」這一行。",
    "如果 source_category 可讀，必須優先用 source_category 判斷 sort_area；只有讀不到品类/品類時，才用商品名稱判斷。",
    "對應規則：內搭、襪、足球襪、鞋、拖鞋、包、衣、褲、帽歸衣鞋包；破壁機、卷紙器、紙巾架、燈、廚房電器、家用電器、收納、居家用品歸家居電器；手機配件、投影儀、相機、耳機、電子設備歸3C數碼；笛子、樂器、文具歸文具樂器；美妝、護膚、化妝品歸美妝個護；嬰兒、兒童、奶瓶、玩具歸母嬰兒童。",
    "如果品类文字與商品名稱衝突，以品类文字優先；如果看不清或不確定，sort_area 用其他，confidence 用 low。",
    "只回傳 JSON，不要 markdown，不要解釋文字。格式：{\"sort_area\":\"衣鞋包\",\"confidence\":\"high\",\"reason\":\"品类=足球袜 → 衣鞋包\",\"product_hint\":\"春夏薄款兒童足球襪\",\"source_category\":\"足球袜\"}"
  ].join("\n");

  var payload = {
    model: model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          }
        ]
      }
    ],
    temperature: 0.1,
    max_completion_tokens: 220,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_object"
    }
  };

  var response = UrlFetchApp.fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "post",
    muteHttpExceptions: true,
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + apiKey
    },
    payload: JSON.stringify(payload)
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error("Groq API error " + code + ": " + text);
  }

  var data = JSON.parse(text);
  var outputText = extractGroqOutputText_(data);
  var parsed = parseJsonFromText_(outputText);
  var normalized = normalizeClassification_(parsed);

  normalized.raw_output = outputText;

  return normalized;
}

function getGroqApiKey_() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");

  if (!apiKey) {
    throw new Error("請先在 Apps Script Script Properties 設定 GROQ_API_KEY");
  }

  return apiKey;
}

function normalizeImageDataUrl_(imageData) {
  var value = String(imageData || "");

  if (value.indexOf("data:image/") === 0) {
    return value;
  }

  return "data:image/jpeg;base64," + value;
}

function extractGroqOutputText_(data) {
  var choices = data.choices || [];

  if (!choices.length || !choices[0].message) {
    throw new Error("Groq 回傳格式異常");
  }

  return choices[0].message.content || "";
}

function parseJsonFromText_(text) {
  var cleaned = String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  var match = cleaned.match(/\{[\s\S]*\}/);

  if (match) {
    cleaned = match[0];
  }

  return JSON.parse(cleaned);
}

function normalizeClassification_(parsed) {
  var allowed = ["衣鞋包", "家居電器", "3C數碼", "美妝個護", "母嬰兒童", "文具樂器", "其他"];
  var sortArea = parsed.sort_area || parsed.category || "其他";

  if (allowed.indexOf(sortArea) === -1) {
    sortArea = "其他";
  }

  var confidence = parsed.confidence || "low";

  if (["high", "medium", "low"].indexOf(confidence) === -1) {
    confidence = "low";
  }

  return {
    sort_area: sortArea,
    confidence: confidence,
    reason: parsed.reason || "",
    product_hint: parsed.product_hint || "",
    source_category: parsed.source_category || ""
  };
}

function runDriveOcr_(photoFileId) {
  var sourceFile = DriveApp.getFileById(photoFileId);
  var resource = {
    title: "ocr-" + photoFileId + "-" + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS
  };

  var ocrFile = Drive.Files.copy(resource, photoFileId, {
    ocr: true,
    ocrLanguage: "zh-TW"
  });

  Utilities.sleep(1500);

  var text = DocumentApp.openById(ocrFile.id).getBody().getText();
  DriveApp.getFileById(ocrFile.id).setTrashed(true);

  return text || sourceFile.getName();
}

function findProductImageUrl_(productUrl) {
  var html = fetchProductHtml_(productUrl);

  if (!html) {
    return "";
  }

  html = decodeHtml_(html);

  var imageUrl = firstMatch_(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  if (!imageUrl) {
    imageUrl = firstMatch_(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  }

  if (!imageUrl) {
    imageUrl = firstMatch_(html, /"picUrl"\s*:\s*"([^"]+)"/i);
  }

  if (!imageUrl) {
    imageUrl = firstMatch_(html, /"mainPic"\s*:\s*"([^"]+)"/i);
  }

  if (!imageUrl) {
    imageUrl = firstMatch_(html, /(\/\/img\.alicdn\.com\/[^"'\s<>\\]+?\.(?:jpg|jpeg|png|webp))/i);
  }

  return normalizeImageUrl_(imageUrl);
}

function fetchProductHtml_(productUrl) {
  var response = UrlFetchApp.fetch(productUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh-CN;q=0.9,en;q=0.6"
    }
  });

  var code = response.getResponseCode();

  if (code < 200 || code >= 400) {
    return "";
  }

  return response.getContentText();
}

function saveProductImage_(imageUrl, productUrl) {
  var normalizedUrl = normalizeImageUrl_(imageUrl);

  if (!normalizedUrl) {
    return { url: "", fileId: "" };
  }

  var response = UrlFetchApp.fetch(normalizedUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": "https://item.taobao.com/"
    }
  });

  var code = response.getResponseCode();

  if (code < 200 || code >= 400) {
    return { url: normalizedUrl, fileId: "" };
  }

  var folders = DriveApp.getFoldersByName("TaobaoProductImages");
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("TaobaoProductImages");
  var blob = response.getBlob();
  var fileName = "product-" + extractItemId_(productUrl) + "-" + new Date().getTime() + ".jpg";
  var file = folder.createFile(blob.setName(fileName));

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    url: driveImageUrl_(file.getId()),
    fileId: file.getId()
  };
}

function parseLabelText_(rawText) {
  var text = String(rawText || "").replace(/\r/g, "\n");
  var lines = text.split("\n");
  var cleanLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || "").replace(/\s+/g, " ").trim();

    if (line) {
      cleanLines.push(line);
    }
  }

  var joined = cleanLines.join("\n");
  var packageNo = firstMatch_(joined, /G\d{8,}/);
  var price = firstMatch_(joined, /(?:价格|價(?:格)?|金额|金額)[:：]?\s*([0-9]+(?:\.[0-9]+)?)/);
  var spec = extractSpec_(joined);
  var category = firstMatch_(joined, /(?:品类|品類)[:：]?\s*([^\n]+)/);

  if (category) {
    category = category.replace(/^(商品)?/, "").trim();
  }

  var productName = extractProductName_(cleanLines);

  if (!category) {
    category = detectCategory_(productName + " " + spec);
  }

  return {
    packageNo: packageNo,
    productName: productName,
    spec: spec,
    category: category,
    price: price
  };
}

function extractSpec_(text) {
  var spec = firstMatch_(text, /(?:分类|分類|规格|規格)[:：]\s*([^\n]+)/);

  if (!spec) {
    var colorMatch = String(text || "").match(/(?:颜色|顏色)[:：]\s*([^\n]+)/);
    spec = colorMatch ? colorMatch[1].trim() : "";
  }

  if (spec) {
    return spec.replace(/(?:重量|价格|價格|品类|品類|金额|金額)[:：].*$/, "").trim();
  }

  return "";
}

function extractProductName_(lines) {
  var candidates = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (isNoiseLine_(line)) {
      continue;
    }

    candidates.push(line);
  }

  var name = candidates.join(" ");

  name = name
    .replace(/(?:分类|分類|规格|規格|颜色|顏色|尺码|尺碼)[:：].*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length > 120) {
    name = name.substring(0, 120);
  }

  return name;
}

function isNoiseLine_(line) {
  if (/^G\d{8,}/.test(line)) return true;
  if (/质检码|質檢碼/.test(line)) return true;
  if (/重量|价格|價格|金额|金額|品类|品類/.test(line)) return true;
  if (/国泰|國泰|太平洋|保险|保險/.test(line)) return true;
  if (/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(line)) return true;
  if (/^[0-9\s:：.-]+$/.test(line)) return true;

  return false;
}

function detectCategory_(text) {
  text = String(text || "");

  if (/鞋|靴|拖|凉鞋|涼鞋|衣|裤|褲|裙|袜|襪|帽|包|皮带|皮帶/.test(text)) {
    return "衣褲鞋";
  }

  if (/手机|手機|充电|充電|保护膜|保護膜|壳|殼|数据线|數據線/.test(text)) {
    return "手機配件";
  }

  if (/电器|電器|灯|燈|锅|鍋|水机|水器|插座|风扇|風扇/.test(text)) {
    return "家居電器";
  }

  if (/化妆|化妝|护肤|護膚|面膜|口红|口紅|精华|精華/.test(text)) {
    return "美妝護膚";
  }

  if (/婴|嬰|宝宝|寶寶|奶瓶|童|儿童|兒童|孕/.test(text)) {
    return "母嬰用品";
  }

  return "其他";
}

function firstMatch_(text, pattern) {
  var match = String(text || "").match(pattern);

  if (!match) {
    return "";
  }

  return (match[1] || match[0] || "").trim();
}

function getDataSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("包裹資料");

  if (!sheet) {
    sheet = ss.insertSheet("包裹資料");
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  var headers = [
    "時間戳記",
    "包裹編號",
    "商品名稱",
    "規格",
    "品類",
    "商品連結",
    "原始價格",
    "建議售價",
    "狀態",
    "掃描時間",
    "標籤照片URL",
    "照片FileID",
    "OCR狀態",
    "OCR時間",
    "OCR原始文字",
    "來源",
    "商品首圖URL",
    "商品首圖FileID",
    "首圖狀態",
    "客人展示狀態",
    "現場分貨區",
    "AI建議分貨區",
    "AI信心",
    "AI原因",
    "AI分類時間"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];

  for (var i = 0; i < headers.length; i++) {
    if (!existing[i]) {
      sheet.getRange(1, i + 1).setValue(headers[i]);
    }
  }
}

function normalizeUrl_(url) {
  return String(url || "")
    .trim()
    .replace(/^http:\/\//, "https://")
    .replace(/#.*$/, "")
    .replace(/&?spm=[^&]*/g, "")
    .replace(/&?ut_sk=[^&]*/g, "");
}

function normalizeImageUrl_(url) {
  url = String(url || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  if (!url) {
    return "";
  }

  if (url.indexOf("//") === 0) {
    url = "https:" + url;
  }

  if (url.indexOf("http://") === 0) {
    url = "https://" + url.substring(7);
  }

  return url;
}

function decodeHtml_(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

function extractItemId_(url) {
  var id = firstMatch_(url, /[?&]id=([0-9]+)/);

  if (!id) {
    id = new Date().getTime();
  }

  return id;
}

function driveImageUrl_(fileId) {
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
}

function jsonOutput_(obj, callback) {
  var json = JSON.stringify(obj);

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
