// Says whether deploying <to> over <from> bootstraps nginx or updates its image.
//
//   node scripts/nginx-upgrade-required.mjs <from> <to>
//
// A changed nginx service requires the one-time container bootstrap. A changed
// helper image runs nginx's live executable upgrade. It may briefly empty the
// proxy list while established proxy WebSockets reconnect, but the HTTP
// listener must continue answering (torrent-tv/meta#236). Writes `bootstrap`
// and `upgrade` to GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage: nginx-upgrade-required.mjs <from> <to>");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const serviceAt = (commit, name) => {
  let text;
  try {
    text = git("show", `${commit}:docker-compose.yml`);
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^\s*#/.test(line))
    .join("\n");
};

const bootstrap = serviceAt(from, "nginx") !== serviceAt(to, "nginx");
const upgrade = serviceAt(from, "nginx-upgrade") !== serviceAt(to, "nginx-upgrade");
console.log(bootstrap ? `the nginx service changed from ${from} to ${to}` : "the nginx service is unchanged");
console.log(upgrade ? `the nginx-upgrade service changed from ${from} to ${to}` : "the nginx-upgrade service is unchanged");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `bootstrap=${bootstrap}\nupgrade=${upgrade}\n`);
