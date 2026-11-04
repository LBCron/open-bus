// The owner's side of the agent card e2e (AC5d): the dashboard's REST reads
// and writes with a real session cookie (dev-login on the loopback hub), the
// hub's JWKS, and a card checked the way a verifier checks it.
import { createPublicKey, type JsonWebKey, verify } from "node:crypto";
import { AgentsResponseSchema, AUTH, CARD_TYP, R } from "@ob/shared";

export type Owner = {
  /** The roster as the dashboard reads it, for one namespace. */
  agents: (namespace: string) => Promise<OwnerAgent[]>;
};
export type OwnerAgent = ReturnType<
  typeof AgentsResponseSchema.parse
>["agents"][number];

/** Signs in as the owner through dev-login (ENVIRONMENT=dev, loopback only). */
export async function ownerSession(hub: string): Promise<Owner> {
  const res = await fetch(`${hub}${AUTH.devLogin}`, { redirect: "manual" });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith("ob_session="));
  if (!cookie) throw new Error(`dev-login: ${res.status}, no session cookie`);
  return {
    agents: async (namespace) => {
      const r = await fetch(
        `${hub}${R.agents}?namespace=${encodeURIComponent(namespace)}`,
        { headers: { cookie } },
      );
      if (r.status !== 200) throw new Error(`agents: ${r.status}`);
      return AgentsResponseSchema.parse(await r.json()).agents;
    },
  };
}

/**
 * POST /__e2e/link: links `aud` as /link/confirm does. 204, or 409 when the
 * hub's linked-app cap is full; 501 before the hub can link.
 */
export async function linkApp(hub: string, aud: string): Promise<number> {
  const r = await fetch(`${hub}/__e2e/link`, {
    method: "POST",
    headers: { "X-OB-E2E": "1" },
    body: JSON.stringify({ aud }),
  });
  await r.body?.cancel();
  return r.status;
}

export type Jwks = { keys: (JsonWebKey & { kid?: string })[] };

export async function jwks(hub: string): Promise<Jwks> {
  const r = await fetch(`${hub}${R.jwks}`);
  if (r.status !== 200) throw new Error(`jwks: ${r.status}`);
  return (await r.json()) as Jwks;
}

const part = (s: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(s ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

/**
 * A card's header and claims once its signature verifies against a key in
 * `keys` with its `kid`, as a verifier does (typ ob-card+jwt, EdDSA). Throws
 * on anything else.
 */
export function verifyCard(
  jwt: string,
  keys: Jwks,
): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s || jwt.split(".").length !== 3)
    throw new Error("not a compact JWS");
  const header = part(h);
  if (header.typ !== CARD_TYP || header.alg !== "EdDSA")
    throw new Error(`header ${JSON.stringify(header)}`);
  const jwk = keys.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`no key ${String(header.kid)} in the JWKS`);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (!verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url")))
    throw new Error("bad signature");
  return { header, claims: part(p) };
}
