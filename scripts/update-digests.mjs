// Keeps the pinned images current within the tags they follow.
//
//   node scripts/update-digests.mjs
//
// docker-compose.yml pins every image as `<repository>:<tag>@<digest>`. For each one
// except the server (which only a server release moves), this reads the digest the
// tag points to now and writes it in place: `nginx:alpine` follows nginx's main line
// this way, as watchtower used to. Writes `changed=<images>` to GITHUB_OUTPUT.
//
// doco-cd is not changed here — it is updated by hand (host/doco-cd/docker-compose.yml).
// When its project has a newer release than the pinned one, this prints an error and
// exits 1 after writing the digests, so the daily run stays red until someone updates it.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const COMPOSE = "docker-compose.yml";
const DOCO = "host/doco-cd/docker-compose.yml";
const PIN = /^(\s+image:\s+)([^\s@:]+(?:\/[^\s@:]+)*):([^\s@]+)@(sha256:[0-9a-f]{64})\s*$/;

const digestOf = (reference) =>
  JSON.parse(execFileSync("docker", ["buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest.Digest}}"], { encoding: "utf8" }));

const lines = readFileSync(COMPOSE, "utf8").split("\n");
const changed = [];
for (let i = 0; i < lines.length; i += 1) {
  const match = PIN.exec(lines[i]);
  if (!match) continue;
  const [, indent, repository, tag, digest] = match;
  if (repository === "ghcr.io/torrent-tv/server") continue;
  const current = digestOf(`${repository}:${tag}`);
  if (current !== digest) {
    lines[i] = `${indent}${repository}:${tag}@${current}`;
    changed.push(`${repository}:${tag}`);
    console.log(`${repository}:${tag} ${digest} -> ${current}`);
  } else {
    console.log(`${repository}:${tag} is current`);
  }
}
if (changed.length) writeFileSync(COMPOSE, lines.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.join(", ")}\n`);

// doco-cd: a newer release is reported, not applied.
const pinned = /ghcr\.io\/kimdre\/doco-cd:([0-9.]+)@/.exec(readFileSync(DOCO, "utf8"))?.[1];
const latest = JSON.parse(execFileSync("gh", ["api", "repos/kimdre/doco-cd/releases/latest", "--jq", "{tag: .tag_name}"], { encoding: "utf8" })).tag.replace(/^v/, "");
if (pinned && latest !== pinned) {
  console.log(`::error file=${DOCO}::doco-cd ${latest} is released and ${pinned} is pinned; update it by hand as the file describes`);
  process.exitCode = 1;
} else {
  console.log(`doco-cd ${pinned} is the latest release`);
}
