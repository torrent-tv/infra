// Checks what a deployment must leave behind, from outside, without a torrent.
//
//   node scripts/verify-site.mjs proxies > before.json      # before applying
//   node scripts/verify-site.mjs check before.json           # after applying
//
// `check` reads the expected server version from docker-compose.yml and the expected
// nginx revision from nginx/revision.common, and verifies on the live sites:
//   1. webauth.courses serves index.html and an ES module as application/javascript;
//   2. /env.js (cache-busted, no-cache) reports the expected server version;
//   3. /_infra/revision equals the revision of this commit (nginx accepted it);
//   4. wss://webauth.courses/ws/browser-signal opens and stays open;
//   5. every proxy connected before is listed again within 120 s.
// It retries each check until DEADLINE_MS, so a container that is still starting
// is waited for, and it writes the time each check took into the job summary.
import { appendFileSync, readFileSync } from "node:fs";

const SITE = process.env.SITE ?? "https://webauth.courses";
const DEADLINE_MS = Number(process.env.VERIFY_DEADLINE_MS ?? 120_000);
const RETRY_MS = 3_000;
const HOLD_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nocache = (url) => `${url}${url.includes("?") ? "&" : "?"}verify=${Date.now()}`;
const get = (url) => fetch(nocache(url), { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10_000) });

async function proxies() {
  const response = await get(`${SITE}/api/proxy-clients/health`);
  if (!response.ok) throw new Error(`proxy health answered ${response.status}`);
  return (await response.json()).clients.map((client) => client.id);
}

function holdWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${url} did not open`));
    }, 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
          resolve();
        } else {
          reject(new Error(`${url} closed within ${HOLD_MS} ms`));
        }
      }, HOLD_MS);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`${url} failed to open`));
    });
  });
}

const expectedVersion = () => {
  const match = /ghcr\.io\/torrent-tv\/server:([0-9]+\.[0-9]+\.[0-9]+)@/.exec(readFileSync("docker-compose.yml", "utf8"));
  if (!match) throw new Error("docker-compose.yml names no pinned server version");
  return match[1];
};
const expectedRevision = () => {
  const match = /return 200 "([0-9]+)\\n";/.exec(readFileSync("nginx/revision.common", "utf8"));
  if (!match) throw new Error("nginx/revision.common states no revision");
  return match[1];
};

const checks = (before) => [
  ["static files", async () => {
    const index = await get(`${SITE}/`);
    if (!index.ok || !(await index.text()).includes('id="torrent"')) throw new Error(`/ answered ${index.status} without the page`);
    const module = await get(`${SITE}/domain/webrtc-proxy.js`);
    const type = module.headers.get("content-type") ?? "";
    if (!module.ok || !type.includes("javascript")) throw new Error(`a module answered ${module.status} as ${type}`);
  }],
  ["server version", async () => {
    const version = /version: "([^"]+)"/.exec(await (await get(`${SITE}/env.js`)).text())?.[1];
    if (version !== expectedVersion()) throw new Error(`/env.js reports ${version}, expected ${expectedVersion()}`);
  }],
  ["nginx revision", async () => {
    const revision = (await (await get(`${SITE}/_infra/revision`)).text()).trim();
    if (revision !== expectedRevision()) throw new Error(`nginx serves revision ${revision}, expected ${expectedRevision()}`);
  }],
  ["signalling WebSocket", () => holdWebSocket(`${SITE.replace(/^http/, "ws")}/ws/browser-signal`)],
  ["proxies reconnected", async () => {
    const now = new Set(await proxies());
    const missing = before.filter((id) => !now.has(id));
    if (missing.length) throw new Error(`not reconnected yet: ${missing.join(", ")}`);
  }],
];

async function check(before) {
  const started = Date.now();
  const rows = [];
  for (const [name, run] of checks(before)) {
    let last = null;
    for (;;) {
      try {
        await run();
        rows.push([name, `${((Date.now() - started) / 1000).toFixed(1)} s`]);
        console.log(`ok: ${name}`);
        break;
      } catch (error) {
        last = error;
      }
      if (Date.now() - started > DEADLINE_MS) {
        console.log(`::error::${name}: ${last.message}`);
        process.exitCode = 1;
        rows.push([name, `failed: ${last.message}`]);
        break;
      }
      await sleep(RETRY_MS);
    }
  }
  const table = ["| Check | Passed after |", "|---|---|", ...rows.map(([name, time]) => `| ${name} | ${time} |`)].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Site after deployment\n\n${table}\n`);
  console.log(table);
}

const [mode, file] = process.argv.slice(2);
if (mode === "proxies") {
  process.stdout.write(`${JSON.stringify(await proxies())}\n`);
} else if (mode === "check") {
  await check(file ? JSON.parse(readFileSync(file, "utf8")) : []);
} else {
  throw new Error("usage: verify-site.mjs proxies | check [before.json]");
}
