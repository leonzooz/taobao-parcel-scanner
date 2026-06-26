const SHEET_NAME = "包裹資料";
const DRIVE_FOLDER_NAME = "淘寶包裹標籤照片";

function doGet() {
  return ContentService
    .createTextOutput("OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const p = e.parameter || {};

    const productUrl = p.productUrl || p.product_url || "";
    const status = p.status || "待整理";
    const ocrStatus = p.ocrStatus || "待 OCR";
    const scanTime = p.scanTime || formatDate_(new Date());
    const photoName = p.photoName || ("label-" + Date.now() + ".jpg");
    const photoData = p.photoData || "";

    if (!isTaobaoUrl_(productUrl)) {
      return jsonOutput_({
        success: false,
        message: "不是淘寶商品連結"
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet_(ss);

    let photoUrl = "";
    let photoFileId = "";

    if (photoData) {
      const savedPhoto = saveBase64Image_(photoData, photoName);
      photoUrl = savedPhoto.url;
      photoFileId = savedPhoto.id;
    }

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
      ocrStatus,
      "",
      "",
      "staff"
    ]);

    return jsonOutput_({
      success: true,
      message: "uploaded",
      photoUrl: photoUrl,
      photoFileId: photoFileId
    });
  } catch (err) {
    return jsonOutput_({
      success: false,
      message: err.message
    });
  }
}

function isTaobaoUrl_(url) {
  const text = String(url || "").toLowerCase();

  return text.includes("taobao.com") ||
    text.includes("item.taobao") ||
    text.includes("m.tb.cn") ||
    text.includes("tb.cn") ||
    text.includes("tmall.com");
}

function getOrCreateSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
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
      "來源"
    ]);
  }

  return sheet;
}

function saveBase64Image_(photoData, photoName) {
  const folder = getOrCreateFolder_();
  let base64 = String(photoData);
  let mimeType = "image/jpeg";

  const match = base64.match(/^data:(.+);base64,/);

  if (match) {
    mimeType = match[1];
    base64 = base64.split(",").pop();
  }

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, photoName);
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: file.getId(),
    url: file.getUrl()
  };
}

function getOrCreateFolder_() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);

  if (folders.hasNext()) {
    return folders.next();
  }

  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
