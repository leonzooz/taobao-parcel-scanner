function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params.action === "lookup") {
    return lookupProduct_(params);
  }

  return ContentService.createTextOutput("success");
}

function doPost(e) {
  return handleUpload_(e);
}

function handleUpload_(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};

    var productUrl = params.productUrl || params.product_url || "";
    var status = params.status || "待整理";
    var scanTime = params.scanTime || new Date().toLocaleString();
    var photoName = params.photoName || (new Date().getTime() + ".jpg");
    var photoData = params.photoData || "";

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
      "整理中"
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
    "客人展示狀態"
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
