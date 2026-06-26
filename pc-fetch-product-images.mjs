import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbzWWBupdwuar1EvO0qsXAehBawmt_TQk7faI9mYaNdBT6bWwFxqiEOJD5xwWWLVikWy/exec";

const LIMIT = Number(process.env.LIMIT || 20);
const PROFILE_DIR = path.resolve("pc-chrome-profile");
const OUTPUT_DIR = path.resolve("pc-product-images");
const HEADLESS = process.env.HEADLESS === "1";

const rl = readline.createInterface({ input, output });

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const items = await getPendingItems();

  if (!items.length) {
    console.log("沒有待抓首圖的商品。");
    return;
  }

  console.log(`找到 ${items.length} 筆待抓首圖。`);
  console.log("第一次執行如果淘寶要求登入，請在打開的 Chrome 視窗登入後回到這裡按 Enter。");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    locale: "zh-TW",
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    for (const item of items) {
      await processItem(page, item);
    }
  } finally {
    await context.close();
    rl.close();
  }
}

async function getPendingItems() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "pendingProductImages");
  url.searchParams.set("limit", String(LIMIT));

  const response = await fetch(url);
  const body = await response.text();
  const data = parseAppsScriptJson(body, "讀取待抓清單");

  if (data.status !== "success") {
    throw new Error(data.message || "讀取待抓清單失敗");
  }

  return data.items || [];
}

async function processItem(page, item) {
  console.log("");
  console.log(`處理第 ${item.rowNumber} 列：${item.productUrl}`);

  try {
    await page.goto(item.productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(2500);

    if (await looksBlocked(page)) {
      console.log("淘寶顯示安全/登入頁，請在 Chrome 視窗手動完成登入或驗證。");
      await rl.question("完成後按 Enter 繼續...");
      await page.waitForTimeout(1500);
    }

    await gentleScroll(page);

    const imageUrl = await findBestImageUrl(page);

    if (!imageUrl) {
      throw new Error("找不到商品主圖");
    }

    console.log(`抓到圖片：${imageUrl}`);

    const image = await downloadImage(page, imageUrl);
    const itemId = extractItemId(item.productUrl) || String(item.rowNumber);
    const ext = extensionFromContentType(image.contentType) || ".jpg";
    const imageName = `product-${itemId}-${Date.now()}${ext}`;
    const localPath = path.join(OUTPUT_DIR, imageName);

    await fs.writeFile(localPath, image.buffer);
    console.log(`已暫存：${localPath}`);

    const uploadResult = await uploadImageToAppsScript({
      rowNumber: item.rowNumber,
      productUrl: item.productUrl,
      imageName,
      imageData: image.buffer.toString("base64"),
      contentType: image.contentType || "image/jpeg",
      imageSourceUrl: imageUrl
    });

    if (uploadResult.status !== "success") {
      throw new Error(uploadResult.message || "回填 Apps Script 失敗");
    }

    console.log(`已回填 Sheet：${uploadResult.productImageUrl}`);
  } catch (error) {
    console.log(`失敗：${error.message}`);
    await markImageError(item, error.message);
  }
}

async function looksBlocked(page) {
  const url = page.url();
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");

  return (
    /login|passport|login\.taobao|market\.m\.taobao\.com\/app\/msd/.test(url) ||
    /安全|驗證|验证|登入|登录|訪問行為|访问行为|異常|异常/.test(text)
  );
}

async function gentleScroll(page) {
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(700);
  }

  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(700);
}

async function findBestImageUrl(page) {
  const candidates = await page.evaluate(() => {
    const urls = [];

    function add(value, score) {
      if (!value) return;

      let url = String(value).trim();

      if (!url || url.startsWith("data:") || url.startsWith("blob:")) return;
      if (url.startsWith("//")) url = `https:${url}`;
      if (url.startsWith("http://")) url = `https://${url.slice(7)}`;

      urls.push({ url, score });
    }

    for (const meta of document.querySelectorAll("meta[property='og:image'], meta[name='og:image'], meta[name='twitter:image']")) {
      add(meta.getAttribute("content"), 1000);
    }

    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const data = JSON.parse(script.textContent || "{}");
        const image = Array.isArray(data.image) ? data.image[0] : data.image;
        add(image, 950);
      } catch (error) {}
    }

    for (const img of document.images) {
      const rect = img.getBoundingClientRect();
      const src =
        img.currentSrc ||
        img.src ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-ks-lazyload") ||
        img.getAttribute("data-lazyload") ||
        img.getAttribute("data-original");

      let score = 0;

      if (src && src.includes("img.alicdn.com")) score += 500;
      if (rect.width >= 250 && rect.height >= 250) score += 250;
      if (rect.top >= -200 && rect.top <= window.innerHeight + 600) score += 120;
      if (img.alt && /主图|商品|product|item/i.test(img.alt)) score += 80;

      score += Math.min(200, Math.round(rect.width + rect.height));
      add(src, score);
    }

    return urls;
  });

  const clean = candidates
    .map((item) => ({
      url: normalizeImageUrl(item.url),
      score: item.score
    }))
    .filter((item) => isUsableImageUrl(item.url))
    .sort((a, b) => b.score - a.score);

  return clean[0]?.url || "";
}

async function downloadImage(page, imageUrl) {
  const response = await page.request.get(imageUrl, {
    headers: {
      referer: page.url(),
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36"
    },
    timeout: 60000
  });

  if (!response.ok()) {
    throw new Error(`圖片下載失敗 HTTP ${response.status()}`);
  }

  const contentType = response.headers()["content-type"] || "image/jpeg";
  const buffer = Buffer.from(await response.body());

  if (buffer.length < 5000) {
    throw new Error("圖片太小，可能抓到圖示或安全頁圖片");
  }

  return { buffer, contentType: contentType.split(";")[0] };
}

async function uploadImageToAppsScript(data) {
  const params = new URLSearchParams();

  params.set("mode", "productImage");
  params.set("rowNumber", String(data.rowNumber));
  params.set("productUrl", data.productUrl);
  params.set("imageName", data.imageName);
  params.set("imageData", data.imageData);
  params.set("contentType", data.contentType);
  params.set("imageSourceUrl", data.imageSourceUrl);

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: params
  });

  const body = await response.text();
  return parseAppsScriptJson(body, "上傳商品首圖");
}

async function markImageError(item, message) {
  const params = new URLSearchParams();

  params.set("mode", "productImageError");
  params.set("rowNumber", String(item.rowNumber));
  params.set("productUrl", item.productUrl);
  params.set("message", message);

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: params
  }).catch(() => {});
}

function normalizeImageUrl(url) {
  return String(url || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/_(\d+)x(\d+)(?:q\d+)?\.(jpg|jpeg|png|webp).*$/i, ".$3")
    .trim();
}

function isUsableImageUrl(url) {
  if (!url) return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) return false;
  if (/sprite|icon|logo|avatar|loading|placeholder/i.test(url)) return false;
  return true;
}

function extensionFromContentType(contentType) {
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/jpeg|jpg/i.test(contentType)) return ".jpg";
  return ".jpg";
}

function extractItemId(url) {
  return new URL(url).searchParams.get("id");
}

function parseAppsScriptJson(body, actionName) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `${actionName} 回傳不是 JSON：${body.slice(0, 120)}。請確認 Apps Script 已貼最新版並「管理部署 → 編輯 → 新版本 → 部署」。`
    );
  }
}

main().catch((error) => {
  console.error(error);
  rl.close();
  process.exitCode = 1;
});
