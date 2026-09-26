// Screenshots the podium HTML at 1080x1350. Usage: node render.cjs <in.html> <out.png>
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [html, png] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto('file://' + path.resolve(html));
  await page.waitForTimeout(300); // let fonts/emoji and the curve script settle
  await page.screenshot({ path: png });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
