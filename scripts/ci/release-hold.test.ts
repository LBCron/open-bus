import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HOLD_LABEL, RELEASE_BRANCH } from "./release-cadence.ts";
import { check, dequeue, type Exec, prFromQueueRef } from "./release-hold.ts";

const REPO = "open-artifacts-ai/open-bus";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A fake `gh`: answers `api repos/.../pulls/N` and records every call. */
function fakeGh(pr: { ref: string; labels: string[]; queued?: boolean }) {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === "api" && args[1]?.startsWith(`repos/${REPO}/pulls/`))
      return {
        code: 0,
        stdout: JSON.stringify({
          node_id: "PR_node",
          head: { ref: pr.ref },
          labels: pr.labels.map((name) => ({ name })),
        }),
        stderr: "",
      };
    if (args[0] === "api" && args[1] === "graphql") {
      const q = args.find((a) => a.startsWith("query=")) ?? "";
      if (q.includes("isInMergeQueue"))
        return {
          code: 0,
          stdout: JSON.stringify({
            data: { node: { isInMergeQueue: Boolean(pr.queued) } },
          }),
          stderr: "",
        };
      return { code: 0, stdout: "{}", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { exec, calls };
}

describe("prFromQueueRef", () => {
  it("reads the PR number from a merge-queue ref", () => {
    expect(
      prFromQueueRef("refs/heads/gh-readonly-queue/main/pr-427-5ad3cef0123"),
    ).toBe(427);
    expect(prFromQueueRef("gh-readonly-queue/main/pr-9-abc")).toBe(9);
    expect(prFromQueueRef("refs/heads/main")).toBeUndefined();
    expect(prFromQueueRef("")).toBeUndefined();
  });
});

describe("check: pull_request path", () => {
  const pr = (headRef: string, labels: string[]) =>
    check({
      exec: fakeGh({ ref: "", labels: [] }).exec,
      repo: REPO,
      event: "pull_request",
      headRef,
      labels,
    });

  it("fails only the release PR while it carries the hold", async () => {
    expect((await pr(RELEASE_BRANCH, [HOLD_LABEL])).held).toBe(true);
    expect((await pr(RELEASE_BRANCH, ["autorelease: pending"])).held).toBe(
      false,
    );
    expect((await pr("be/435-x", [HOLD_LABEL])).held).toBe(false);
  });
});

describe("check: merge_group path", () => {
  const queued = (pr: { ref: string; labels: string[] }) => {
    const g = fakeGh(pr);
    return {
      calls: g.calls,
      run: () =>
        check({
          exec: g.exec,
          repo: REPO,
          event: "merge_group",
          headRef: "refs/heads/gh-readonly-queue/main/pr-433-0123abc",
        }),
    };
  };

  it("reads the queued PR's live labels and fails while held", async () => {
    const q = queued({ ref: RELEASE_BRANCH, labels: [HOLD_LABEL] });
    expect((await q.run()).held).toBe(true);
    expect(q.calls[0]).toEqual(["gh", "api", `repos/${REPO}/pulls/433`]);
  });

  it("passes the release PR without the hold, and any other PR", async () => {
    expect((await queued({ ref: RELEASE_BRANCH, labels: [] }).run()).held).toBe(
      false,
    );
    expect(
      (await queued({ ref: "be/x", labels: [HOLD_LABEL] }).run()).held,
    ).toBe(false);
  });

  it("fails closed on an unreadable queue ref", async () => {
    const g = fakeGh({ ref: RELEASE_BRANCH, labels: [] });
    await expect(
      check({
        exec: g.exec,
        repo: REPO,
        event: "merge_group",
        headRef: "refs/heads/main",
      }),
    ).rejects.toThrow(/merge-queue ref/);
  });
});

describe("dequeue", () => {
  it("dequeues the held release PR when it is queued", async () => {
    const g = fakeGh({
      ref: RELEASE_BRANCH,
      labels: [HOLD_LABEL],
      queued: true,
    });
    expect(await dequeue({ exec: g.exec, repo: REPO, pr: 433 })).toBe(
      "dequeued",
    );
    const mutation = g.calls.find((c) =>
      c.some((a) => a.includes("dequeuePullRequest")),
    );
    expect(mutation).toBeDefined();
    expect(mutation?.join(" ")).toContain("PR_node");
  });

  it("does nothing when it is not queued, not held, or not the release PR", async () => {
    for (const pr of [
      { ref: RELEASE_BRANCH, labels: [HOLD_LABEL], queued: false },
      { ref: RELEASE_BRANCH, labels: [], queued: true },
      { ref: "be/x", labels: [HOLD_LABEL], queued: true },
    ]) {
      const g = fakeGh(pr);
      expect(await dequeue({ exec: g.exec, repo: REPO, pr: 433 })).not.toBe(
        "dequeued",
      );
      expect(
        g.calls.some((c) => c.some((a) => a.includes("dequeuePullRequest"))),
      ).toBe(false);
    }
  });
});

describe("release-hold.yml", () => {
  const w = parse(
    readFileSync(join(root, ".github/workflows/release-hold.yml"), "utf8"),
  );
  it("runs on the label events and on merge_group", () => {
    expect(w.on.merge_group).toBeDefined();
    for (const t of [
      "opened",
      "synchronize",
      "reopened",
      "labeled",
      "unlabeled",
    ])
      expect(w.on.pull_request.types).toContain(t);
  });
  it("has a release-hold check job and a dequeue job, least privilege", () => {
    expect(w.permissions).toEqual({});
    const job = w.jobs["release-hold"];
    expect(job.name ?? "release-hold").toBe("release-hold");
    expect(job.permissions).toEqual({ "pull-requests": "read" });
    expect(JSON.stringify(job)).toContain("scripts/ci/release-hold.ts check");
    const dq = w.jobs.dequeue;
    expect(String(dq.if)).toContain("labeled");
    expect(JSON.stringify(dq)).toContain("scripts/ci/release-hold.ts dequeue");
  });
});
