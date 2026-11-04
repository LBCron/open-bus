// R393a: the shared schema decodes `rename` before the hub handles it
// (R393b). Until then the hub must answer it, never drop it, so a daemon
// waiting on `renamed` gets `error bad_frame` and can fall back.
import { describe, expect, it } from "vitest";
import { machine, ns, ready, up, waitFor } from "./helpers.js";

describe("rename before R393b", () => {
  it("is answered error bad_frame with the frame id, socket open", async () => {
    const m = await machine();
    const d = await ready(m.token);
    d.send(up("u1", "ses_a", "Mine", ns()));
    await waitFor(d, "agent_ok");
    d.send({
      v: 1,
      id: "r1",
      type: "rename",
      agent_ref: "ses_a",
      proposed_name: "Other",
    });
    const e = await waitFor(d, "error");
    expect(e).toMatchObject({ id: "r1", code: "bad_frame" });
    d.send({ v: 1, id: "l1", type: "list", from_ref: "ses_a" });
    expect((await waitFor(d, "roster")).id).toBe("l1");
    d.close();
  });
});
