// Release approval and hold, driven by label events on the release PR (#445).
// - `approve` runs when `release-ok` is added. It records a `release-ok`
//   commit status on the exact head the label was added on, so a later push
//   by release-please (a new head, no status) needs a fresh approval. The
//   cadence arms only a head that carries the status (release-cadence.ts).
// - `dequeue` runs when `release-hold` is added or `release-ok` is removed.
//   A queued release PR no longer passes through `plan`, so it takes it out.
// Usage:
//   node --experimental-strip-types scripts/ci/release-label.ts approve --repo owner/name --pr N --sha SHA
//   node --experimental-strip-types scripts/ci/release-label.ts dequeue --repo owner/name --pr N
// Needs GH_TOKEN in the environment.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  APPROVAL_CONTEXT,
  HOLD_LABEL,
  OK_LABEL,
  RELEASE_BRANCH,
} from "./release-cadence.ts";

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

type Pr = {
  nodeId: string;
  headRef: string;
  headSha: string;
  headRepo: string;
  labels: string[];
};

async function readPr(exec: Exec, repo: string, n: number): Promise<Pr> {
  const j = JSON.parse(await gh(exec, ["api", `repos/${repo}/pulls/${n}`]));
  return {
    nodeId: String(j.node_id ?? ""),
    headRef: String(j.head?.ref ?? ""),
    headSha: String(j.head?.sha ?? ""),
    headRepo: String(j.head?.repo?.full_name ?? ""),
    labels: (j.labels ?? []).map((l: { name?: string }) => String(l.name)),
  };
}

/** The repo's own release-please PR, never a fork's branch of the same name. */
const isRelease = (pr: Pr, repo: string): boolean =>
  pr.headRef === RELEASE_BRANCH && pr.headRepo === repo;

const SHA_RE = /^[0-9a-f]{40}$/;

export type ApproveResult =
  | "approved"
  | "stale"
  | "not-release"
  | "not-labeled";

export async function approve(o: {
  exec: Exec;
  repo: string;
  pr: number;
  /** The head when the label was added (the event's pull_request.head.sha). */
  sha: string;
}): Promise<ApproveResult> {
  if (!SHA_RE.test(o.sha)) throw new Error(`not a commit sha: ${o.sha}`);
  const pr = await readPr(o.exec, o.repo, o.pr);
  if (!isRelease(pr, o.repo)) return "not-release";
  if (!pr.labels.includes(OK_LABEL)) return "not-labeled";
  // A push between the label and this run: the labeled contents are gone,
  // so approve nothing. Re-adding the label approves the new head.
  if (pr.headSha !== o.sha) return "stale";
  await gh(o.exec, [
    "api",
    `repos/${o.repo}/statuses/${o.sha}`,
    "-f",
    "state=success",
    "-f",
    `context=${APPROVAL_CONTEXT}`,
    "-f",
    `description=${OK_LABEL} added on this commit`,
  ]);
  return "approved";
}

export type DequeueResult =
  | "dequeued"
  | "not-queued"
  | "not-held"
  | "not-release";

export async function dequeue(o: {
  exec: Exec;
  repo: string;
  pr: number;
}): Promise<DequeueResult> {
  // Re-read the labels: the event may be stale by now.
  const pr = await readPr(o.exec, o.repo, o.pr);
  if (!isRelease(pr, o.repo)) return "not-release";
  const stop = pr.labels.includes(HOLD_LABEL) || !pr.labels.includes(OK_LABEL);
  if (!stop) return "not-held";
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
  const pr = Number(arg("--pr"));
  if (
    !repo ||
    !Number.isInteger(pr) ||
    pr <= 0 ||
    (mode !== "approve" && mode !== "dequeue")
  ) {
    console.error(
      "usage: release-label.ts approve --repo owner/name --pr N --sha SHA | dequeue --repo owner/name --pr N",
    );
    return 2;
  }
  const r =
    mode === "approve"
      ? await approve({ exec: realExec, repo, pr, sha: arg("--sha") ?? "" })
      : await dequeue({ exec: realExec, repo, pr });
  console.log(r);
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
