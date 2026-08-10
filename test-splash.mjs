import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: false,
  args: ["--no-sandbox"],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// Navigate and immediately take a screenshot of the splash
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400); // give the enter animation a moment

// Check what's visible
const splashText = await page.textContent("body");
console.log("=== Splash screenshot ===");
console.log(splashText?.slice(0, 500));

// Check if the splash logo image loaded
const imgStatus = await page.evaluate(() => {
  const imgs = document.querySelectorAll("img");
  return Array.from(imgs).map(img => ({
    src: img.src,
    loaded: img.complete && img.naturalWidth > 0,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }));
});
console.log("=== Images ===");
console.log(JSON.stringify(imgStatus, null, 2));

await page.screenshot({ path: "/tmp/splash-verify.png" });

// Wait for splash to finish, then snapshot the next screen
await page.waitForTimeout(3000);
const afterSplashText = await page.textContent("body");
console.log("=== After splash ===");
console.log(afterSplashText?.slice(0, 500));
await page.screenshot({ path: "/tmp/after-splash.png" });

await browser.close();
console.log("✅ Screenshots saved");