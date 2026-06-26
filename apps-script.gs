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
