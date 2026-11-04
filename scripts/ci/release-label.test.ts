import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  APPROVAL_CONTEXT,
  HOLD_LABEL,
  OK_LABEL,
  RELEASE_BRANCH,
} from "./release-cadence.ts";
import { approve, dequeue, type Exec } from "./release-label.ts";

const REPO = "open-artifacts-ai/open-bus";
const SHA = "a".repeat(40);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A fake `gh` answering `api repos/.../pulls/N`, the queue query and writes; records calls. */
function fakeGh(pr: {
  ref: string;
  labels: string[];
  head?: string;
  queued?: boolean;
  sameRepo?: boolean;
}) {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const ok = (o: unknown) => ({
      code: 0,
      stdout: JSON.stringify(o),
      stderr: "",
    });
    if (args[0] === "api" && args[1] === `repos/${REPO}/pulls/301`)
      return ok({
        node_id: "PR_node",
        head: {
          ref: pr.ref,
          sha: pr.head ?? SHA,
          repo: { full_name: pr.sameRepo === false ? "fork/open-bus" : REPO },
        },
        labels: pr.labels.map((name) => ({ name })),
      });
    if (args[0] === "api" && args[1] === "graphql") {
      const q = args.find((a) => a.startsWith("query=")) ?? "";
      if (q.includes("isInMergeQueue"))
        return ok({ data: { node: { isInMergeQueue: Boolean(pr.queued) } } });
      return ok({});
    }
    if (args[0] === "api" && args[1]?.startsWith(`repos/${REPO}/statuses/`))
      return ok({});
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  const wrote = (needle: string) =>
    calls.filter((c) => c.some((a) => a.includes(needle)));
  return { exec, calls, wrote };
}

describe("approve: release-ok is tied to the labeled head (#445)", () => {
  it("records a success status for the exact SHA the label was added on", async () => {
    const g = fakeGh({ ref: RELEASE_BRANCH, labels: [OK_LABEL] });
    expect(await approve({ exec: g.exec, repo: REPO, pr: 301, sha: SHA })).toBe(
      "approved",
    );
    const [w] = g.wrote(`statuses/${SHA}`);
    expect(w).toBeDefined();
    expect(w?.join(" ")).toContain(`context=${APPROVAL_CONTEXT}`);
    expect(w?.join(" ")).toContain("state=success");
  });

  it("refuses a SHA that is no longer the head: the push won the race", async () => {
    const g = fakeGh({
      ref: RELEASE_BRANCH,
      labels: [OK_LABEL],
      head: "b".repeat(40),
    });
    expect(await approve({ exec: g.exec, repo: REPO, pr: 301, sha: SHA })).toBe(
      "stale",
    );
    expect(g.wrote("statuses/")).toEqual([]);
  });

  it("does nothing for another PR, a fork, a bad SHA, or once the label is gone", async () => {
    for (const pr of [
      { ref: "be/x", labels: [OK_LABEL] },
      { ref: RELEASE_BRANCH, labels: [OK_LABEL], sameRepo: false },
      { ref: RELEASE_BRANCH, labels: [] },
    ]) {
      const g = fakeGh(pr);
      expect(
        await approve({ exec: g.exec, repo: REPO, pr: 301, sha: SHA }),
      ).not.toBe("approved");
      expect(g.wrote("statuses/")).toEqual([]);
    }
    const g = fakeGh({ ref: RELEASE_BRANCH, labels: [OK_LABEL] });
    await expect(
      approve({ exec: g.exec, repo: REPO, pr: 301, sha: "nope" }),
    ).rejects.toThrow(/sha/);
  });
});

describe("dequeue: a hold, or a withdrawn approval, takes a queued release out (#445)", () => {
  const dq = (g: ReturnType<typeof fakeGh>) =>
    g.calls.some((c) => c.some((a) => a.includes("dequeuePullRequest")));

  it("dequeues a queued release PR that is held", async () => {
    const g = fakeGh({
      ref: RELEASE_BRANCH,
      labels: [OK_LABEL, HOLD_LABEL],
      queued: true,
    });
    expect(await dequeue({ exec: g.exec, repo: REPO, pr: 301 })).toBe(
      "dequeued",
    );
    expect(dq(g)).toBe(true);
  });

  it("dequeues a queued release PR whose release-ok was removed", async () => {
    const g = fakeGh({ ref: RELEASE_BRANCH, labels: [], queued: true });
    expect(await dequeue({ exec: g.exec, repo: REPO, pr: 301 })).toBe(
      "dequeued",
    );
  });

  it("leaves an approved, unheld, queued release; and anything not queued or not the release", async () => {
    for (const pr of [
      { ref: RELEASE_BRANCH, labels: [OK_LABEL], queued: true },
      { ref: RELEASE_BRANCH, labels: [HOLD_LABEL], queued: false },
      { ref: "be/x", labels: [HOLD_LABEL], queued: true },
    ]) {
      const g = fakeGh(pr);
      expect(await dequeue({ exec: g.exec, repo: REPO, pr: 301 })).not.toBe(
        "dequeued",
      );
      expect(dq(g)).toBe(false);
    }
  });
});

describe("release-label.yml", () => {
  const w = parse(
    readFileSync(join(root, ".github/workflows/release-label.yml"), "utf8"),
  );
  it("runs only on label events, never on pushes or the merge queue", () => {
    expect(w.on.pull_request.types).toEqual(["labeled", "unlabeled"]);
    expect(w.on.merge_group).toBeUndefined();
    expect(w.on.push).toBeUndefined();
    expect(w.permissions).toEqual({});
  });
  it("approves on release-ok added and dequeues on hold added or release-ok removed", () => {
    const a = w.jobs.approve;
    expect(String(a.if)).toContain("'labeled'");
    expect(String(a.if)).toContain("'release-ok'");
    expect(a.permissions).toEqual({
      statuses: "write",
      "pull-requests": "read",
    });
    expect(JSON.stringify(a)).toContain("release-label.ts approve");
    expect(JSON.stringify(a)).toContain("pull_request.head.sha");
    const d = w.jobs.dequeue;
    expect(String(d.if)).toContain("'release-hold'");
    expect(String(d.if)).toContain("'unlabeled'");
    expect(JSON.stringify(d)).toContain("release-label.ts dequeue");
    // Neither job may be cancelled by a later label event.
    expect(w.concurrency).toBeUndefined();
    expect(a.concurrency).toBeUndefined();
    expect(d.concurrency).toBeUndefined();
  });
});
