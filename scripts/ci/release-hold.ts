// The structural release hold (#435). A `release-hold` label on the release
// PR must stop it merging even after release-cadence has queued it:
// - `check` is the `release-hold` CI job. It fails while the release PR
//   carries the label, on pull_request (label events re-run it) and on
//   merge_group (it reads the queued PR's live labels).
// - `dequeue` runs when the label is added. A check that already passed in
//   the merge queue doesn't re-run, so it takes the queued release PR out.
// Usage:
//   node --experimental-strip-types scripts/ci/release-hold.ts check --repo owner/name
//     (env EVENT_NAME, HEAD_REF, and LABELS as a JSON array on pull_request)
//   node --experimental-strip-types scripts/ci/release-hold.ts dequeue --repo owner/name --pr N
// Needs GH_TOKEN in the environment.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HOLD_LABEL, RELEASE_BRANCH } from "./release-cadence.ts";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (
  cmd: string,
  args: string[],
) => ExecResult | Promise<ExecResult>;

async function gh(exec: Exec, args: string[]): Promise<string> {
  const r = await exec("gh", args);
  if (r.code !== 0)
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`,
    );
  return r.stdout;
}

/** The PR number in a merge-queue ref (`[refs/heads/]gh-readonly-queue/<base>/pr-<n>-<sha>`). */
export function prFromQueueRef(ref: string): number | undefined {
  const m = /(?:^|\/)gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]+$/.exec(ref);
  return m ? Number(m[1]) : undefined;
}

type Pr = { nodeId: string; headRef: string; labels: string[] };

async function readPr(exec: Exec, repo: string, n: number): Promise<Pr> {
  const j = JSON.parse(await gh(exec, ["api", `repos/${repo}/pulls/${n}`]));
  return {
    nodeId: String(j.node_id ?? ""),
    headRef: String(j.head?.ref ?? ""),
    labels: (j.labels ?? []).map((l: { name?: string }) => String(l.name)),
  };
}

const isHeld = (headRef: string, labels: string[]): boolean =>
  headRef === RELEASE_BRANCH && labels.includes(HOLD_LABEL);

export type CheckResult = { held: boolean; pr?: number };

export async function check(o: {
  exec: Exec;
  repo: string;
  event: string;
  headRef: string;
  /** The PR's labels, from the pull_request event payload. */
  labels?: string[];
}): Promise<CheckResult> {
  if (o.event === "merge_group") {
    const n = prFromQueueRef(o.headRef);
    // Fail closed: an unreadable ref must not let a held release through.
    if (n === undefined)
      throw new Error(`not a merge-queue ref: ${o.headRef || "(empty)"}`);
    const pr = await readPr(o.exec, o.repo, n);
    return { held: isHeld(pr.headRef, pr.labels), pr: n };
  }
  return { held: isHeld(o.headRef, o.labels ?? []) };
}

export type DequeueResult = "dequeued" | "not-queued" | "not-held";

export async function dequeue(o: {
  exec: Exec;
  repo: string;
  pr: number;
}): Promise<DequeueResult> {
  // Re-read the labels: the hold may have been lifted since the event fired.
  const pr = await readPr(o.exec, o.repo, o.pr);
  if (!isHeld(pr.headRef, pr.labels)) return "not-held";
  const q = JSON.parse(
    await gh(o.exec, [
      "api",
      "graphql",
      "-f",
      "query=query($id: ID!) { node(id: $id) { ... on PullRequest { isInMergeQueue } } }",
      "-f",
      `id=${pr.nodeId}`,
    ]),
  );
  if (!q?.data?.node?.isInMergeQueue) return "not-queued";
  await gh(o.exec, [
    "api",
    "graphql",
    "-f",
    "query=mutation($id: ID!) { dequeuePullRequest(input: {id: $id}) { clientMutationId } }",
    "-f",
    `id=${pr.nodeId}`,
  ]);
  return "dequeued";
}

const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
};

async function main(argv: string[]): Promise<number> {
  const [mode, ...rest] = argv;
  const arg = (k: string) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const repo = arg("--repo");
  if (!repo || (mode !== "check" && mode !== "dequeue")) {
    console.error(
      "usage: release-hold.ts check --repo owner/name | dequeue --repo owner/name --pr N",
    );
    return 2;
  }
  if (mode === "dequeue") {
    const pr = Number(arg("--pr"));
    if (!Number.isInteger(pr) || pr <= 0) {
      console.error("dequeue needs --pr N");
      return 2;
    }
    console.log(await dequeue({ exec: realExec, repo, pr }));
    return 0;
  }
  const r = await check({
    exec: realExec,
    repo,
    event: process.env.EVENT_NAME ?? "",
    headRef: process.env.HEAD_REF ?? "",
    labels: JSON.parse(process.env.LABELS || "[]"),
  });
  if (r.held) {
    console.log(
      `Release held: the release PR${r.pr ? ` #${r.pr}` : ""} carries ${HOLD_LABEL}. Remove the label to release (docs/ops/releases.md).`,
    );
    return 1;
  }
  console.log("not held");
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
