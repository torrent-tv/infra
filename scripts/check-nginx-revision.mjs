// Fails when commits change the nginx configuration without raising its revision.
//
//   node scripts/check-nginx-revision.mjs <from>..<to>
//
// The revision is the number in nginx/revision.common. After a deployment CI reads
// it back from /_infra/revision: that is how it tells a configuration nginx
// accepted on SIGHUP from one it rejected. So every change under nginx/ has to
// raise it, or the check after the deployment could not see the difference.
import { execFileSync } from "node:child_process";

const [range] = process.argv.slice(2);
if (!range) throw new Error("usage: check-nginx-revision.mjs <from>..<to>");
const [from, to] = range.split("..");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const revisionAt = (commit) => {
  try {
    const text = git("show", `${commit}:nginx/revision.common`);
    return Number(/return 200 "([0-9]+)\\n";/.exec(text)?.[1]);
  } catch {
    return 0;
  }
};

const changed = git("diff", "--name-only", from, to, "--", "nginx").split("\n").filter(Boolean);
if (changed.length === 0) {
  console.log("nginx/ unchanged");
  process.exit(0);
}
const before = revisionAt(from);
const after = revisionAt(to);
if (!(after > before)) {
  console.log(`::error file=nginx/revision.common::nginx/ changed (${changed.join(", ")}) but its revision did not rise (${before} -> ${after})`);
  process.exitCode = 1;
} else {
  console.log(`nginx/ changed and its revision rose ${before} -> ${after}`);
}
