// Opens the live page in a headless browser after a deployment and waits until it
// is usable: it has asked the server for the proxies and got at least one, the
// file picker is open, and no error is shown. No torrent is opened.
//
//   node scripts/verify-page.mjs
//
// Needs the `playwright` package and its Chromium (the workflow installs both).
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";

const SITE = process.env.SITE ?? "https://webauth.courses";
const DEADLINE_MS = Number(process.env.VERIFY_DEADLINE_MS ?? 120_000);

const browser = await chromium.launch();
const started = Date.now();
try {
  for (;;) {
    const page = await browser.newPage();
    try {
      // The page asks the server for a proxy as it opens: `choose` since server
      // 0.50 (torrent-tv/meta#36), the list of every proxy before it.
      const asked = page.waitForResponse((response) => /\/api\/proxy-clients\/(?:choose|health)(?:\?|$)/u.test(response.url()), { timeout: 30_000 });
      await page.goto(`${SITE}/?verify=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const response = await asked;
      const answer = response.ok() ? await response.json() : {};
      const proxies = Array.isArray(answer.clients) ? answer.clients.length : answer.chosen ? (answer.candidates?.length ?? 1) : 0;
      if (proxies < 1) throw new Error(`the page found ${proxies} proxies (status ${response.status()})`);
      await page.waitForSelector("dialog#torrent[open]", { timeout: 15_000 });
      if (await page.$("dialog#error[open]")) throw new Error(`the page shows an error: ${await page.textContent("#error__description")}`);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`the page is usable after ${seconds} s with ${proxies} proxy(ies)`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Page after deployment\n\nUsable after ${seconds} s with ${proxies} proxy(ies).\n`);
      }
      break;
    } catch (error) {
      if (Date.now() - started > DEADLINE_MS) {
        console.log(`::error::the page did not become usable: ${error.message}`);
        process.exitCode = 1;
        break;
      }
      console.log(`not usable yet (${error.message}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
