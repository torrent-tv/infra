// Says whether deploying <to> over <from> recreates nginx.
//
//   node scripts/nginx-recreated.mjs <from> <to>
//
// Any change of the `nginx` service in docker-compose.yml (a new image digest,
// mostly) recreates the container, and the site does not answer until the new
// one listens (torrent-tv/meta#236). A change under nginx/ only reloads it
// (SIGHUP) and does not count. Comment lines do not count either. Writes
// `recreated=true|false` to GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage: nginx-recreated.mjs <from> <to>");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

// The lines of the `nginx` service, from its key to the next key of the same
// or a lower level; none when the commit or the service does not exist.
const serviceAt = (commit) => {
  let text;
  try {
    text = git("show", `${commit}:docker-compose.yml`);
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^  nginx:\s*$/.test(line));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^\s*#/.test(line))
    .join("\n");
};

const recreated = serviceAt(from) !== serviceAt(to);
console.log(recreated ? `the nginx service changed from ${from} to ${to}: nginx is recreated` : "the nginx service is unchanged");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `recreated=${recreated}\n`);
