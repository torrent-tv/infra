// Checks what a deployment must leave behind, from outside, without a torrent.
//
//   node scripts/verify-site.mjs proxies > before.json      # before applying
//   node scripts/verify-site.mjs check before.json           # after applying
//   node scripts/verify-site.mjs disk                        # daily
//   node scripts/verify-site.mjs watch before.json           # while applying, until SIGTERM
//
// `watch` asks for the list of proxies again and again, each request as soon
// as the previous one is answered, for as long as the deployment runs, and on
// SIGTERM states what a page connecting at those moments found: answers that
// failed, lists that were empty while proxies had been connected before, and
// how often each of those proxies was missing. The server runs in two slots and
// hands over at a release (torrent-tv/meta#94), so a failed answer or an empty
// list fails the deployment. A server that ran alone before the deployment
// cannot hand over, and then the result is only stated.
//
// `check` reads the expected server version from docker-compose.yml and the expected
// nginx revision from nginx/revision.common, and verifies on the live sites:
//   1. webauth.courses serves index.html and an ES module as application/javascript;
//   2. /env.js (cache-busted, no-cache) reports the expected server version;
//   3. /_infra/revision equals the revision of this commit (nginx accepted it);
//   4. wss://webauth.courses/ws/browser-signal opens and stays open;
//   5. every proxy connected before is listed again within 120 s;
//   6. the droplet has room for the next server image (see `disk` below).
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

// The server runs in two slots, and the slot with the newer version serves, so
// the version the site must report is the newest one pinned.
const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const newestPinnedServer = () => {
  const pins = [...readFileSync("docker-compose.yml", "utf8").matchAll(/ghcr\.io\/torrent-tv\/server:([0-9]+\.[0-9]+\.[0-9]+)@(sha256:[0-9a-f]{64})/g)]
    .map(([, version, digest]) => ({ version, digest }));
  if (pins.length === 0) throw new Error("docker-compose.yml names no pinned server image");
  return pins.reduce((newest, pin) => (compareVersions(pin.version, newest.version) > 0 ? pin : newest));
};
const expectedVersion = () => newestPinnedServer().version;
const pinnedServerDigest = () => newestPinnedServer().digest;

// The size of the pinned server image for linux/amd64 as GHCR stores it: its
// config and compressed layers. Docker keeps these on the droplet beside the
// unpacked layers, so the next pull needs at least this much and in practice
// more; it is a lower bound, not the whole cost.
async function serverImageBytes() {
  const repository = "torrent-tv/server";
  const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${repository}:pull`, { signal: AbortSignal.timeout(10_000) });
  if (!tokenResponse.ok) throw new Error(`GHCR token answered ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  const manifest = async (reference) => {
    const response = await fetch(`https://ghcr.io/v2/${repository}/manifests/${reference}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.oci.image.manifest.v1+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
          "application/vnd.docker.distribution.manifest.v2+json",
        ].join(","),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GHCR manifest ${reference} answered ${response.status}`);
    return response.json();
  };
  let image = await manifest(pinnedServerDigest());
  if (image.manifests) {
    const amd64 = image.manifests.find((entry) => entry.platform?.os === "linux" && entry.platform?.architecture === "amd64");
    if (!amd64) throw new Error("the pinned server image has no linux/amd64 manifest");
    image = await manifest(amd64.digest);
  }
  return image.config.size + image.layers.reduce((sum, layer) => sum + layer.size, 0);
}

const mib = (bytes) => `${(bytes / 1024 ** 2).toFixed(0)} MiB`;

// What the server states about the filesystem holding its cache, which on the
// droplet also holds Docker's images (torrent-tv/meta#71). A full disk once
// stopped every release from rolling out, unnoticed. The check fails when the
// next pull of the server image would eat into the reserve the server cache keeps.
async function diskSpace() {
  const response = await get(`${SITE}/health`);
  if (!response.ok) throw new Error(`/health answered ${response.status}`);
  const { disk } = await response.json();
  if (!disk) throw new Error("/health states no disk space");
  const imageBytes = await serverImageBytes();
  const neededBytes = disk.reserveBytes + imageBytes;
  const text = `${mib(disk.freeBytes)} free; the next server image needs at least ${mib(imageBytes)} above the cache reserve of ${mib(disk.reserveBytes)}`;
  if (disk.freeBytes < neededBytes) throw new Error(`the droplet has ${text}`);
  return text;
}

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
  ["disk space", async () => console.log(`disk: ${await diskSpace()}`)],
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

async function watch(before) {
  let strict = false;
  try {
    const { instance } = await (await get(`${SITE}/healthz`)).json();
    strict = Boolean(instance) && instance.slot !== "solo";
  } catch {
    // silent-ok: a server that cannot say which slot it is predates the slots.
  }
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  const started = Date.now();
  const samples = { total: 0, failed: 0, empty: 0, firstProblem: null };
  const missing = new Map(before.map((id) => [id, 0]));
  while (!stopping) {
    samples.total += 1;
    try {
      const now = new Set(await proxies());
      if (now.size === 0 && before.length > 0) {
        samples.empty += 1;
        samples.firstProblem ??= `${((Date.now() - started) / 1000).toFixed(1)} s: empty list`;
      }
      for (const id of before) if (!now.has(id)) missing.set(id, missing.get(id) + 1);
    } catch (error) {
      samples.failed += 1;
      samples.firstProblem ??= `${((Date.now() - started) / 1000).toFixed(1)} s: ${error.message}`;
    }
  }
  const absent = [...missing].filter(([, count]) => count > 0).map(([id, count]) => `${id} missing from ${count}`);
  const text = [
    `${samples.total} answers in ${((Date.now() - started) / 1000).toFixed(1)} s: ${samples.failed} failed, ${samples.empty} empty`,
    absent.length ? `proxies missing at times: ${absent.join(", ")}` : "every proxy connected before was listed every time",
    samples.firstProblem ? `first problem at ${samples.firstProblem}` : null,
    strict ? null : "the server ran alone before the deployment, so this is not a failure"
  ].filter(Boolean).join("; ");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### What a connecting page found during the deployment\n\n${text}\n`);
  if (strict && (samples.failed > 0 || samples.empty > 0)) {
    console.log(`::error::during the deployment: ${text}`);
    process.exitCode = 1;
  } else {
    console.log(`during the deployment: ${text}`);
  }
}

const [mode, file] = process.argv.slice(2);
if (mode === "proxies") {
  process.stdout.write(`${JSON.stringify(await proxies())}\n`);
} else if (mode === "check") {
  await check(file ? JSON.parse(readFileSync(file, "utf8")) : []);
} else if (mode === "disk") {
  try {
    const text = await diskSpace();
    console.log(`ok: disk space: ${text}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Droplet disk

${text}
`);
  } catch (error) {
    console.log(`::error::disk space: ${error.message}`);
    process.exitCode = 1;
  }
} else if (mode === "watch") {
  await watch(file ? JSON.parse(readFileSync(file, "utf8")) : []);
} else {
  throw new Error("usage: verify-site.mjs proxies | check [before.json] | disk | watch [before.json]");
}
