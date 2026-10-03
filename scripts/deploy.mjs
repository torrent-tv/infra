// Moves `production` to the checked commit and has doco-cd apply it.
//
// Runs inside the serial `deploy` job (one at a time), so nothing else moves
// `production` while this run applies and verifies its own commit.
//
//   node scripts/deploy.mjs
//
// Environment: GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_OUTPUT, DEPLOY_URL (the
// doco-cd base URL, e.g. https://webauth.courses/_deploy), WEBHOOK_SECRET, API_SECRET.
// Outputs: `outcome` = stale | applied | unchanged | unknown.
//   stale     — `production` already went past this commit; nothing was done.
//   applied   — doco-cd reported the deployment succeeded.
//   unchanged — doco-cd found `production` already applied (its poll got there
//               first, or this is a re-run); the site checks decide.
//   unknown   — doco-cd lost the run (restarted); the site checks decide.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFileSync } from "node:fs";

const REQUEST_MS = 10_000;
const RETRY_MS = 5_000;
const DEADLINE_MS = 600_000;
const TERMINAL = new Set(["succeeded", "failed", "skipped", "canceled", "cancelled"]);

const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repository, DEPLOY_URL: base, WEBHOOK_SECRET, API_SECRET } = process.env;
for (const [name, value] of Object.entries({ GITHUB_SHA: sha, GITHUB_REPOSITORY: repository, DEPLOY_URL: base, WEBHOOK_SECRET, API_SECRET })) {
  if (!value) throw new Error(`${name} is not set`);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const isAncestor = (a, b) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
  }
};
const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + DEADLINE_MS;

async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_MS) });
  const text = await response.text();
  return { status: response.status, text };
}

// 1. Where production stands relative to this commit.
git("fetch", "-q", "origin", "+refs/heads/production:refs/remotes/origin/production");
const production = git("rev-parse", "refs/remotes/origin/production");
if (production === sha) {
  console.log(`production is already at ${sha}: applying and verifying again`);
} else if (isAncestor(sha, production)) {
  console.log(`::notice::production is at ${production}, which already contains ${sha}; this run is superseded and changes nothing`);
  output("outcome", "stale");
  process.exit(0);
} else if (isAncestor(production, sha)) {
  // Not forced: git refuses a move that is not a fast-forward.
  git("push", "origin", `${sha}:refs/heads/production`);
  console.log(`production moved ${production} -> ${sha}`);
} else {
  throw new Error(`production (${production}) and ${sha} have diverged; a person has to decide`);
}

// 2. The signed request. doco-cd answers at once with a job id and deploys, in the
// background, the commit named in `after` — measured on doco-cd 0.123.0: a request
// naming an older commit applies that commit, not the head of the branch. That is
// why only this serial job sends requests, and always for its own commit, which is
// now the head of production. A lost answer is retried: the same commit again.
const payload = JSON.stringify({
  ref: "refs/heads/production",
  before: production,
  after: sha,
  repository: {
    name: repository.split("/")[1],
    full_name: repository,
    clone_url: `https://github.com/${repository}.git`,
  },
  pusher: { name: "github-actions", email: "noreply@github.com" },
});
const signature = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
let job = null;
while (!job) {
  if (Date.now() > deadline) throw new Error("doco-cd did not accept the deployment request in time");
  try {
    const { status, text } = await request(`${base}/v1/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push", "X-Hub-Signature-256": signature },
      body: payload,
    });
    if (status >= 200 && status < 300) {
      job = JSON.parse(text).job_id;
      if (!job) throw new Error(`doco-cd accepted the request without a job id: ${text}`);
      console.log(`doco-cd accepted the deployment as job ${job}`);
      break;
    }
    if (status >= 400 && status < 500) throw new Error(`doco-cd refused the request (${status}): ${text}`);
    console.log(`doco-cd answered ${status}; retrying`);
  } catch (error) {
    if (error.message.startsWith("doco-cd refused")) throw error;
    console.log(`no answer from doco-cd (${error.message}); retrying`);
  }
  await sleep(RETRY_MS);
}

// 3. The run's state. Losing the connection while nginx is reloaded or
// recreated is not a failed deployment; only doco-cd's own verdict or the
// deadline is.
while (Date.now() < deadline) {
  await sleep(RETRY_MS);
  try {
    const { status, text } = await request(`${base}/v1/api/run/${job}`, { headers: { "x-api-key": API_SECRET } });
    if (status === 404) {
      console.log(`::warning::doco-cd no longer knows job ${job} (it restarted); the site checks decide`);
      output("outcome", "unknown");
      process.exit(0);
    }
    if (status !== 200) {
      console.log(`run state answered ${status}; retrying`);
      continue;
    }
    // doco-cd answers { content: { status, message, ... } } (measured, 0.123.0).
    const body = JSON.parse(text);
    const run = body.content ?? body;
    const state = String(run.status ?? "").toLowerCase();
    console.log(`job ${job}: ${state}${run.message ? ` (${run.message})` : ""}`);
    if (!TERMINAL.has(state)) continue;
    if (state === "succeeded") {
      output("outcome", "applied");
      process.exit(0);
    }
    // "deployment skipped" means production was already applied; a skip for any
    // other reason (a webhook filter that did not match) is a misconfiguration.
    if (state === "skipped" && run.message === "deployment skipped") {
      output("outcome", "unchanged");
      process.exit(0);
    }
    throw new Error(`doco-cd reports the deployment ${state}: ${text}`);
  } catch (error) {
    if (error.message.startsWith("doco-cd reports")) throw error;
    console.log(`no answer about job ${job} (${error.message}); retrying`);
  }
}
throw new Error(`job ${job} did not finish within ${DEADLINE_MS / 1000} s`);
