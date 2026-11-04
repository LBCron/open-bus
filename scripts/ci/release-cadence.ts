// Release cadence: arm the release-please PR when it is green and the merge
// queue has drained, and keep one `blocker` issue open while a release is stuck.
// Usage: node --experimental-strip-types scripts/ci/release-cadence.ts <plan|arm|blocker> --repo owner/name
// `plan` prints `write=true|false` (does arm need the App token?).
// Opt-in (#435): only a release PR labeled `release-ok` whose head carries
// the workflow's `release-ok` status is armed (#445), and a `release-hold`
// label still stops it. `arm` re-reads the labels right before it enqueues,
// so a change mid-run wins. A release that is held or lost its approval is
// taken back, whoever armed it: disarmed, and dequeued if queued. This is the
// backstop for release-label.yml's dequeue/disarm jobs.
// Needs GH_TOKEN in the environment. `arm` runs with the release App's token
// (so the merge triggers workflows); `blocker` runs with GITHUB_TOKEN.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const RELEASE_BRANCH =
  "release-please--branches--main--components--open-bus";
const BLOCKED = "Release blocked:";
const DAY_MS = 24 * 3600_000;
/** Once the release PR has been green this long, arm it even if code PRs are still queued. */
export const DRAIN_CAP_MS = 30 * 60_000;
/** On the release PR, this label stops the cadence from arming it (docs/ops/releases.md). */
export const HOLD_LABEL = "release-hold";
/** The cadence arms the release PR only with this label (#435): a person decides a release ships. */
export const OK_LABEL = "release-ok";
/**
 * The commit status that ties an approval to one head (#445). release-label.yml
 * sets it on the head `release-ok` was added on; a later push makes a new head
 * without it, so the cadence waits for a fresh approval.
 */
export const APPROVAL_CONTEXT = "release-ok";
/**
 * Only a status created by this login approves (#445 review): the
 * release-label workflow's GITHUB_TOKEN. Any other token with statuses:write
 * could forge the context. Compared without a `[bot]` suffix.
 */
export const APPROVAL_CREATOR = "github-actions";
/** A release PR waiting for approval gets a gentle `blocker` reminder after this long. */
export const APPROVAL_REMINDER_MS = 3 * DAY_MS;

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (
  cmd: string,
  args: string[],
) => ExecResult | Promise<ExecResult>;

export const QUERY = `query($owner: String!, $name: String!, $head: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, headRefName: $head, first: 10) {
      nodes {
        id
        isCrossRepository
        number
        url
        title
        createdAt
        isInMergeQueue
        labels(first: 20) { nodes { name } }
        autoMergeRequest { enabledAt enabledBy { login } }
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                # Past 100 checks the approval status may be cut off: that
                # fails safe, holding a release rather than shipping one.
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name conclusion status detailsUrl completedAt }
                    ... on StatusContext { context state targetUrl createdAt creator { login } }
                  }
                }
              }
            }
          }
        }
      }
    }
    mergeQueue(branch: $branch) {
      entries(first: 100) {
        totalCount
        nodes { pullRequest { number headRefName } }
      }
    }
  }
}`;

type Context = {
  __typename?: string;
  name?: string;
  conclusion?: string;
  detailsUrl?: string;
  context?: string;
  state?: string;
  targetUrl?: string;
  completedAt?: string | null;
  createdAt?: string | null;
  creator?: { login?: string } | null;
};
export type ReleasePr = {
  /** GraphQL node id, for dequeuePullRequest. */
  id: string;
  number: number;
  url: string;
  title: string;
  createdAt: string;
  queued: boolean;
  armed: boolean;
  armedBy?: string;
  /** Carries the release-ok label (#435). */
  ok: boolean;
  /** The head commit carries a success `release-ok` status (#445): the label was added on this head. */
  approved: boolean;
  /** Carries the release-hold label. */
  held: boolean;
  rollup: string;
  contexts: Context[];
  oid: string;
  /** When the latest check on the current head finished (ms), if known. */
  settledAt?: number;
};
type Snapshot = { pr?: ReleasePr; others: number };

async function gh(exec: Exec, args: string[]): Promise<string> {
  const r = await exec("gh", args);
  if (r.code !== 0)
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`,
    );
  return r.stdout;
}

async function snapshot(exec: Exec, repo: string): Promise<Snapshot> {
  const [owner, name] = repo.split("/");
  const out = await gh(exec, [
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `head=${RELEASE_BRANCH}`,
    "-f",
    "branch=main",
  ]);
  const repository = JSON.parse(out)?.data?.repository;
  // A fork can open a PR from a branch with the same name: only ours counts.
  const n = (repository?.pullRequests?.nodes ?? []).find(
    (p: { isCrossRepository?: unknown }) => p?.isCrossRepository === false,
  );
  const entries: { pullRequest?: { headRefName?: string } }[] =
    repository?.mergeQueue?.entries?.nodes ?? [];
  const others = entries.filter(
    (e) =>
      !String(e.pullRequest?.headRefName ?? "").startsWith("release-please--"),
  ).length;
  if (!n) return { others };
  const commit = n.commits?.nodes?.[0]?.commit;
  const rollup = commit?.statusCheckRollup;
  const contexts: Context[] = rollup?.contexts?.nodes ?? [];
  const times = contexts
    .map((c) => Date.parse(String(c.completedAt ?? c.createdAt ?? "")))
    .filter((t) => !Number.isNaN(t));
  return {
    others,
    pr: {
      id: String(n.id ?? ""),
      number: n.number,
      url: n.url,
      title: n.title,
      createdAt: n.createdAt,
      queued: Boolean(n.isInMergeQueue),
      armed: Boolean(n.autoMergeRequest),
      armedBy: n.autoMergeRequest?.enabledBy?.login,
      held: (n.labels?.nodes ?? []).some(
        (l: { name?: string }) => l.name === HOLD_LABEL,
      ),
      ok: (n.labels?.nodes ?? []).some(
        (l: { name?: string }) => l.name === OK_LABEL,
      ),
      approved: contexts.some(
        (c) =>
          c.__typename === "StatusContext" &&
          c.context === APPROVAL_CONTEXT &&
          c.state === "SUCCESS" &&
          bare(c.creator?.login) === APPROVAL_CREATOR,
      ),
      rollup: rollup?.state ?? "NONE",
      contexts,
      oid: String(commit?.oid ?? ""),
      settledAt: times.length ? Math.max(...times) : undefined,
    },
  };
}

export type ArmResult =
  | { action: "none" }
  | { action: "already"; pr: number }
  | { action: "not-green"; pr: number; state: string }
  | { action: "waiting"; entries: number }
  | { action: "held"; pr: number }
  | { action: "not-ok"; pr: number }
  | { action: "disarmed"; pr: number }
  | { action: "dequeued"; pr: number }
  | { action: "armed"; pr: number };

type Opts = {
  exec: Exec;
  repo: string;
  now?: () => number;
  capMs?: number;
  /** The release App's bot login: the drain rule only re-checks an arm it set. A hold or lost approval disarms any arm. */
  appLogin?: string;
};
type Plan =
  | { do: "none"; result: ArmResult; msg: string }
  | { do: "disarm"; pr: ReleasePr }
  | { do: "stop"; pr: ReleasePr }
  | { do: "arm"; pr: ReleasePr; capHit: boolean };

const bare = (l?: string) => String(l ?? "").replace(/\[bot\]$/, "");

const STATE_QUERY =
  "query($id: ID!) { node(id: $id) { ... on PullRequest { isInMergeQueue autoMergeRequest { enabledAt } } } }";

/** Reads whether the PR is queued and armed. An unexpected reply throws: it must never read as "not queued". */
async function mergeState(
  exec: Exec,
  id: string,
): Promise<{ queued: boolean; armed: boolean }> {
  const out = await gh(exec, [
    "api",
    "graphql",
    "-f",
    `query=${STATE_QUERY}`,
    "-f",
    `id=${id}`,
  ]);
  const node = JSON.parse(out)?.data?.node;
  if (
    !node ||
    typeof node.isInMergeQueue !== "boolean" ||
    !("autoMergeRequest" in node)
  )
    throw new Error(`unexpected merge-queue state for ${id}: ${out.trim()}`);
  return { queued: node.isInMergeQueue, armed: node.autoMergeRequest != null };
}

export type Stopped = { dequeued: boolean; disarmed: boolean };

/**
 * Takes a release PR back: dequeues it if queued, then disables auto-merge
 * if it is still set (whoever armed it), so GitHub can't enqueue it again.
 */
export async function stopRelease(o: {
  exec: Exec;
  repo: string;
  id: string;
  number: number;
}): Promise<Stopped> {
  let s = await mergeState(o.exec, o.id);
  let dequeued = false;
  if (s.queued) {
    await gh(o.exec, [
      "api",
      "graphql",
      "-f",
      "query=mutation($id: ID!) { dequeuePullRequest(input: {id: $id}) { clientMutationId } }",
      "-f",
      `id=${o.id}`,
    ]);
    dequeued = true;
    s = await mergeState(o.exec, o.id);
  }
  if (!s.armed) return { dequeued, disarmed: false };
  await gh(o.exec, [
    "pr",
    "merge",
    String(o.number),
    "--disable-auto",
    "--repo",
    o.repo,
  ]);
  return { dequeued, disarmed: true };
}

function plan(
  s: Snapshot,
  now: number,
  capMs: number,
  appLogin?: string,
): Plan {
  const { pr, others } = s;
  if (!pr)
    return {
      do: "none",
      result: { action: "none" },
      msg: "no open release PR",
    };
  const capHit =
    pr.rollup === "SUCCESS" &&
    pr.settledAt !== undefined &&
    now - pr.settledAt >= capMs;
  const blocked = pr.held || !pr.ok || !pr.approved;
  // Held, or no approval on this head (a push since it was armed, say):
  // take it out of the queue. The backstop for release-label.yml (#445 review).
  if (pr.queued && blocked) return { do: "stop", pr };
  if (pr.queued)
    return {
      do: "none",
      result: { action: "already", pr: pr.number },
      msg: `release PR #${pr.number} is already queued`,
    };
  if (pr.held) {
    // A hold takes back any arm, the App's or a person's.
    if (pr.armed) return { do: "disarm", pr };
    return {
      do: "none",
      result: { action: "held", pr: pr.number },
      msg: `release PR #${pr.number} has the ${HOLD_LABEL} label, not arming`,
    };
  }
  if (!pr.ok || !pr.approved) {
    // Opt-in (#435), tied to the head (#445): without release-ok on this exact
    // head, take back any arm, a person's too (#445 review).
    if (pr.armed) return { do: "disarm", pr };
    return {
      do: "none",
      result: { action: "not-ok", pr: pr.number },
      msg: !pr.ok
        ? `release PR #${pr.number} has no ${OK_LABEL} label, not arming`
        : `release PR #${pr.number}: ${OK_LABEL} was added on an older head; remove and re-add it to approve ${pr.oid.slice(0, 7)}`,
    };
  }
  if (pr.armed) {
    // A fresh head must re-qualify under the drain rule.
    const ours = Boolean(appLogin) && bare(pr.armedBy) === bare(appLogin);
    if (ours && others > 0 && !capHit) return { do: "disarm", pr };
    return {
      do: "none",
      result: { action: "already", pr: pr.number },
      msg: `release PR #${pr.number} is already armed`,
    };
  }
  if (pr.rollup !== "SUCCESS")
    return {
      do: "none",
      result: { action: "not-green", pr: pr.number, state: pr.rollup },
      msg: `release PR #${pr.number} checks are ${pr.rollup}, not arming`,
    };
  if (others > 0 && !capHit)
    return {
      do: "none",
      result: { action: "waiting", entries: others },
      msg: `waiting for the queue to drain (${others} entries)`,
    };
  return { do: "arm", pr, capHit: others > 0 };
}

/** True when `arm` would change the release PR (so it needs the App token). Read-only. */
export async function willWrite(o: Opts): Promise<boolean> {
  const p = plan(
    await snapshot(o.exec, o.repo),
    (o.now ?? Date.now)(),
    o.capMs ?? DRAIN_CAP_MS,
    o.appLogin,
  );
  return p.do !== "none";
}

/** Arms auto-merge on the release PR once it is green and the queue holds nothing but release PRs (or the drain cap is hit). */
export async function arm(
  o: Opts & { log: (line: string) => void },
): Promise<ArmResult> {
  const p = plan(
    await snapshot(o.exec, o.repo),
    (o.now ?? Date.now)(),
    o.capMs ?? DRAIN_CAP_MS,
    o.appLogin,
  );
  if (p.do === "none") {
    o.log(p.msg);
    return p.result;
  }
  if (p.do === "stop") {
    const r = await stopRelease({
      exec: o.exec,
      repo: o.repo,
      id: p.pr.id,
      number: p.pr.number,
    });
    const why = p.pr.held
      ? `it has the ${HOLD_LABEL} label`
      : !p.pr.ok
        ? `it has no ${OK_LABEL} label`
        : `its head ${p.pr.oid.slice(0, 7)} has no ${OK_LABEL} approval`;
    o.log(
      `took release PR #${p.pr.number} out of the merge queue${r.disarmed ? " and disabled auto-merge" : ""}: ${why}`,
    );
    return { action: "dequeued", pr: p.pr.number };
  }
  if (p.do === "disarm") {
    await gh(o.exec, [
      "pr",
      "merge",
      String(p.pr.number),
      "--disable-auto",
      "--repo",
      o.repo,
    ]);
    o.log(
      p.pr.held
        ? `disabled auto-merge on release PR #${p.pr.number}: it has the ${HOLD_LABEL} label`
        : !p.pr.ok
          ? `disabled auto-merge on release PR #${p.pr.number}: it has no ${OK_LABEL} label`
          : !p.pr.approved
            ? `disabled auto-merge on release PR #${p.pr.number}: its head has no ${OK_LABEL} approval`
            : `disabled auto-merge on release PR #${p.pr.number} to re-check the drain on its current head`,
    );
    return { action: "disarmed", pr: p.pr.number };
  }
  // Re-check the hold right before enqueueing: the snapshot may be minutes old.
  const labels = await gh(o.exec, [
    "pr",
    "view",
    String(p.pr.number),
    "--repo",
    o.repo,
    "--json",
    "labels",
    "--jq",
    ".labels[].name",
  ]);
  const now = labels.split("\n").map((l) => l.trim());
  if (now.includes(HOLD_LABEL)) {
    o.log(`release PR #${p.pr.number} has the ${HOLD_LABEL} label, not arming`);
    return { action: "held", pr: p.pr.number };
  }
  if (!now.includes(OK_LABEL)) {
    o.log(`release PR #${p.pr.number} has no ${OK_LABEL} label, not arming`);
    return { action: "not-ok", pr: p.pr.number };
  }
  if (p.capHit)
    o.log(
      `cap hit: release PR #${p.pr.number} has been green for 30 minutes or more, arming despite queued PRs`,
    );
  await gh(o.exec, [
    "pr",
    "merge",
    String(p.pr.number),
    "--auto",
    "--squash",
    "--match-head-commit",
    p.pr.oid,
    "--repo",
    o.repo,
  ]);
  o.log(`armed auto-merge on release PR #${p.pr.number}`);
  return { action: "armed", pr: p.pr.number };
}

const FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
function failing(contexts: Context[]): { name: string; url?: string }[] {
  const out: { name: string; url?: string }[] = [];
  for (const c of contexts) {
    if (c.__typename === "StatusContext") {
      if (c.state === "FAILURE" || c.state === "ERROR")
        out.push({ name: String(c.context), url: c.targetUrl });
    } else if (c.conclusion && FAILED.has(c.conclusion))
      out.push({ name: String(c.name), url: c.detailsUrl });
  }
  return out;
}

export type BlockerResult =
  | { action: "none" }
  | { action: "opened" }
  | { action: "refreshed"; issue: number }
  | { action: "closed"; issues: number[] };

/** Keeps one `blocker` issue in step with a stuck release PR, and closes it once the release shipped. */
export async function blocker(o: {
  exec: Exec;
  repo: string;
  now: () => number;
  log: (line: string) => void;
}): Promise<BlockerResult> {
  const { pr } = await snapshot(o.exec, o.repo);
  let issues: {
    number: number;
    title: string;
    createdAt: string;
    body?: string;
  }[] = JSON.parse(
    await gh(o.exec, [
      "issue",
      "list",
      "--repo",
      o.repo,
      "--label",
      "blocker",
      "--state",
      "open",
      "--json",
      "number,title,createdAt,body",
      "--limit",
      "50",
    ]),
  ).filter((i: { title: string }) => i.title.startsWith(BLOCKED));

  // Close stale blockers on every run: a release newer than the issue means it shipped.
  const closed: number[] = [];
  if (issues.length) {
    const latest = await o.exec("gh", [
      "api",
      `repos/${o.repo}/releases/latest`,
    ]);
    if (latest.code === 0) {
      const rel: { tag_name?: string; published_at?: string } = JSON.parse(
        latest.stdout,
      );
      const shipped = Date.parse(rel.published_at ?? "");
      for (const i of issues) {
        if (!(shipped > Date.parse(i.createdAt))) continue;
        await gh(o.exec, [
          "issue",
          "close",
          String(i.number),
          "--repo",
          o.repo,
          "--comment",
          `Released ${rel.tag_name}. Closing.`,
        ]);
        closed.push(i.number);
      }
      issues = issues.filter((i) => !closed.includes(i.number));
    }
  }

  if (pr) {
    const bad = pr.rollup === "FAILURE" || pr.rollup === "ERROR";
    // Waiting for release-ok (#435) is a person's choice, not a stuck release:
    // an approved one is stuck after 24 h, an unapproved one gets a gentle
    // reminder after APPROVAL_REMINDER_MS (#445).
    const live = pr.ok && pr.approved;
    const age = o.now() - Date.parse(pr.createdAt);
    const old = live ? age > DAY_MS : age > APPROVAL_REMINDER_MS;
    if (!bad && !old)
      return closed.length
        ? { action: "closed", issues: closed }
        : { action: "none" };
    const reasons = [
      ...(bad ? [`release PR #${pr.number} has failing checks`] : []),
      ...(old
        ? [
            live
              ? `release PR #${pr.number} has been open for over 24 hours`
              : `release PR #${pr.number} has waited over 3 days for ${OK_LABEL} on its current head (every release-please push needs ${OK_LABEL} removed and added again)`,
          ]
        : []),
    ];
    const lines = [
      `${pr.title}: ${pr.url}`,
      "",
      ...reasons.map((r) => `- ${r}`),
      ...(bad
        ? [
            "",
            "Failing checks:",
            ...failing(pr.contexts).map((f) =>
              f.url ? `- [${f.name}](${f.url})` : `- ${f.name}`,
            ),
          ]
        : []),
      "",
      "This issue closes itself when the release ships.",
    ];
    const title = `${BLOCKED} ${reasons[0]}`;
    const body = lines.join("\n");
    const existing = issues[0];
    if (existing) {
      if (existing.title === title && existing.body === body)
        return closed.length
          ? { action: "closed", issues: closed }
          : { action: "none" };
      await gh(o.exec, [
        "issue",
        "edit",
        String(existing.number),
        "--repo",
        o.repo,
        "--title",
        title,
        "--body",
        body,
      ]);
      return { action: "refreshed", issue: existing.number };
    }
    await gh(o.exec, [
      "label",
      "create",
      "blocker",
      "--repo",
      o.repo,
      "--force",
      "--color",
      "B60205",
      "--description",
      "A release or deploy is stuck",
    ]);
    await gh(o.exec, [
      "issue",
      "create",
      "--repo",
      o.repo,
      "--title",
      title,
      "--body",
      body,
      "--label",
      "blocker",
    ]);
    return { action: "opened" };
  }

  return closed.length
    ? { action: "closed", issues: closed }
    : { action: "none" };
}

const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
};

async function main(argv: string[]) {
  const [mode, flag, repo] = argv;
  if (
    (mode !== "arm" && mode !== "blocker" && mode !== "plan") ||
    flag !== "--repo" ||
    !repo
  ) {
    console.error(
      "usage: release-cadence.ts <arm|blocker|plan> --repo owner/name",
    );
    return 2;
  }
  if (mode === "plan") {
    // stdout is appended to $GITHUB_OUTPUT: `write=true` when arm needs the App token
    console.log(
      `write=${await willWrite({ exec: realExec, repo, appLogin: process.env.RELEASE_APP_LOGIN })}`,
    );
    return 0;
  }
  const log = (s: string) => console.log(s);
  const r =
    mode === "arm"
      ? await arm({
          exec: realExec,
          repo,
          log,
          appLogin: process.env.RELEASE_APP_LOGIN,
        })
      : await blocker({ exec: realExec, repo, now: Date.now, log });
  console.log(JSON.stringify(r));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
    },
  );
