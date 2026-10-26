// Says whether deploying <to> over <from> changes the nginx-upgrade image.
//
//   node scripts/nginx-upgrade-required.mjs <from> <to>
//
// A changed helper image runs nginx's live executable upgrade. It may briefly
// empty the proxy list while established proxy WebSockets reconnect, but the
// HTTP listener must continue answering (torrent-tv/meta#236). Writes
// `upgrade=true|false` to GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage: nginx-upgrade-required.mjs <from> <to>");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const serviceAt = (commit) => {
  let text;
  try {
    text = git("show", `${commit}:docker-compose.yml`);
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^  nginx-upgrade:\s*$/.test(line));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^\s*#/.test(line))
    .join("\n");
};

const upgrade = serviceAt(from) !== serviceAt(to);
console.log(upgrade ? `the nginx-upgrade service changed from ${from} to ${to}` : "the nginx-upgrade service is unchanged");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `upgrade=${upgrade}\n`);
