// #394: roles are gone. A send to a former role name takes the normal
// not-found path, /api/v1/roles is an unmounted route, and a hub that still
// has the old roles table drops it on wake.
import { runInDurableObject, SELF } from "cloudflare:test";
import { AGENT_CARD_MIN_CLIENT, PONG } from "@ob/shared";
import { describe, expect, it } from "vitest";
import { sessionCookieName, signSession } from "../src/auth/session.js";
import { Hub } from "../src/hub/do.js";
import { hub } from "../src/hub/stub.js";
import { daemon, e, inOwnerHub, machine, ns, up, waitFor } from "./helpers.js";

let seq = 0;
const id = (t: string) => `${t}${++seq}`;

describe("roles removed (#394)", () => {
  it("a send to an unknown name answers unknown_agent on a gated daemon", async () => {
    const d = await daemon((await machine()).token);
    try {
      d.send({
        v: 1,
        id: id("h"),
        type: "hello",
        machine_label: "M",
        client_version: AGENT_CARD_MIN_CLIENT,
      });
      await waitFor(d, "hello_ok");
      d.send(up(id("u"), "r-s", "Sender", ns("rr")));
      await waitFor(d, "agent_ok");
      const fid = id("s");
      d.send({
        v: 1,
        id: fid,
        type: "send",
        from_ref: "r-s",
        to_name: "lane-6",
        body: "hi",
      });
      const r = await waitFor(d, "receipt");
      expect(r).toMatchObject({
        id: fid,
        state: "refused",
        reason: "unknown_agent",
      });
      expect(d.raw.filter((t) => t !== PONG).join("")).not.toContain(
        "role_vacant",
      );
    } finally {
      d.close();
    }
  });

  it("GET /api/v1/roles with a session 404s like any unmounted /api/v1 path", async () => {
    const origin = `https://${e.APP_HOST}`;
    const cookie = `${sessionCookieName(e)}=${await signSession(e)}`;
    const get = (p: string) =>
      SELF.fetch(`${origin}${p}`, { headers: { cookie } });
    const roles = await get("/api/v1/roles");
    const nope = await get("/api/v1/nope");
    expect(roles.status).toBe(404);
    expect(roles.status).toBe(nope.status);
    expect(roles.headers.get("content-type")).toBe(
      nope.headers.get("content-type"),
    );
    expect(await roles.text()).toBe(await nope.text());
  });

  it("a hub with the old roles table drops it on wake", async () => {
    const tables = () =>
      inOwnerHub((s) =>
        s.storage.sql
          .exec<{ name: string }>(
            "select name from sqlite_master where name in ('roles', 'roles_agent', 'roles_lrole')",
          )
          .toArray()
          .map((r) => r.name)
          .sort(),
      );
    // The pre-#394 schema, as hub/schema.ts created it.
    await inOwnerHub((s) => {
      s.storage.sql.exec(`
create table if not exists roles (
  org_id text not null,
  namespace text not null,
  role text not null,
  lrole text not null,
  agent_id text,
  set_at integer not null,
  primary key (org_id, namespace, lrole)
);
create index if not exists roles_agent on roles(agent_id);
create index if not exists roles_lrole on roles(org_id, lrole);
insert into roles (org_id, namespace, role, lrole, agent_id, set_at)
  values ('o', 'n', 'Lane', 'lane', null, 0);`);
    });
    expect(await tables()).toEqual(["roles", "roles_agent", "roles_lrole"]);
    // The wake: a fresh instance runs the schema and migrations.
    await runInDurableObject(
      hub(e) as unknown as DurableObjectStub<Hub>,
      (_: Hub, st: DurableObjectState) => {
        new Hub(st, e);
      },
    );
    expect(await tables()).toEqual([]);
  });
});
