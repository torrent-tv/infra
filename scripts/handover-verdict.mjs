// Where the server's handover between its two slots stands (torrent-tv/meta#94,
// #140), from the latest `/healthz` report of each slot. Used by
// `verify-site.mjs handover`.

// The states of an instance in which a handover has not ended yet
// (server `services/instance-role.js`).
const UNDER_WAY = new Set(["starting", "taking-over", "handing-over", "draining"]);

/**
 * @param {Map<string, { version: string, state: string }>} reports - The latest report of each slot that has answered.
 * @param {string[]} slots - Every slot that must have reported.
 * @param {string} version - The version that must serve.
 * @returns {{ verdict: "done" | "under-way" | "absent" | "standby" | "unseen", text: string }}
 *   done      — the slot running `version` serves and no slot is in the middle of a handover;
 *   under-way — some slot is starting, taking over, handing over or draining;
 *   absent    — no slot has reported `version` yet;
 *   standby   — the slot running `version` stands by and nothing is under way;
 *   unseen    — not every slot has reported yet.
 */
export function handoverVerdict(reports, slots, version) {
  const text = slots.map((slot) => {
    const report = reports.get(slot);
    return report ? `${slot}=${report.version} ${report.state}` : `${slot}=?`;
  }).join(", ");
  const target = [...reports.values()].find((report) => report.version === version);
  if (!target) return { verdict: "absent", text };
  if ([...reports.values()].some((report) => UNDER_WAY.has(report.state))) return { verdict: "under-way", text };
  if (target.state === "standby") return { verdict: "standby", text };
  if (slots.some((slot) => !reports.has(slot))) return { verdict: "unseen", text };
  return { verdict: target.state === "serving" ? "done" : "under-way", text };
}
