# Agent card: roles, status and a signed identity shared with Open Artifacts

Status: draft for review, 2026-10-29. Owner: openbus-e0. Open Artifacts half: Artifacts Manager.

## Intent

One description of "which agent is this" that both OpenBus and Open Artifacts (OA) show. OA's half already exists: #587, Settings › Connected agents, where the owner's label comes first and a "reported by the agent" tag marks anything the agent claimed. OpenBus adds the parts only it can vouch for, and signs them so OA can show them as attested, not merely claimed. **[user]**

Origin: Blue Banjo asks M2 (role addresses) and N2 (status), and the Oct 24 identity-card thread between the two managers. **[user]** approved "spec it, with the signing step", and picked approach 1 (the agent carries a signed card).

## Goals

1. **Role labels.** The owner points a role such as `lane-6` at a live agent in the dashboard. A send to `lane-6` resolves to its holder when it is sent. **[user]**
2. **Status.** A `set_status` tool: one of `working`, `idle`, `blocked` or `waiting_on_owner`, plus a one-line task label. It shows on the dashboard Agents page and in the REST roster, always tagged as self-reported. **[user]**
3. **Signed card.** OpenBus signs a short-lived card for one agent. The agent hands it to OA, and OA verifies it offline against OpenBus's published key. **[user]**

## Non-goals

- The 24-hour role mailbox (M2b). It would be the first durable mail, and it needs its own **[user]** decision. A role here holds no mail.
- Owner messages (M3): deferred. **[user]**
- Using the card for any permission, in either product. It is for display only. **[user]**, and OA's position.
- Sub-task identities, history and search (existing non-goals).

## Anti-goals

- An agent choosing or claiming a role. Only the owner assigns roles, which keeps the spec anti-goal "a sender choosing its own name".
- A role silently following a reopened session. A role points at one agent id, and when that agent closes, the role is vacant until the owner re-points it.
- A card for one agent accepted for another. See the nonce binding below.
- Status shown as fact. It is labelled "agent says" everywhere, including inside a signed card, because signing doesn't make it true.
- A card that leaks the owner's email or the namespace to OA.

## Approaches considered

1. **The agent carries a signed card (chosen, [user]).** OpenBus signs a JWS, and OA verifies it against OpenBus's JWKS. The two servers never connect, there is no shared secret, and it is the same pattern as OA's hosted auth broker.
2. **OA asks OpenBus server to server.** OA holds an owner credential for the bus. Rejected: a standing key in OA, and both servers must be up.
3. **Pass the card at OAuth time.** Rejected: MCP clients don't pass custom parameters through the authorization request (OA's finding).

## Design

### Role labels (OpenBus only)

- Hub table `roles(namespace, role, agent_id NULL, set_at)` in the hub DO's SQLite. A role name follows `BusNameSchema` and lives in the agent-name space of its namespace.
- **Scoping:** the `agentId` in `PUT /roles/{ns}/{role}` must be an open agent (live or queued) whose namespace is `{ns}`, or a global agent. Otherwise the request is refused with 400. **[call]**
- **Collisions:**
  - Creating a role that equals the name of any open agent (live or queued) in that namespace is refused.
  - An agent whose proposed name equals a role gets the usual `-2` suffix.
  - A global sender resolves roles only in namespaces it can already reach. If the same role exists in two of them, the send is refused `ambiguous`, as for names today. `to_namespace` disambiguates.
- **Send resolution** happens in the hub, for every client version: `send(to: "lane-6")` resolves to the holder's agent id at send time. An old daemon's send to a role name reaches the holder like any send. **[call]**
  - Holder open and live: delivered as today.
  - Holder open but its machine is disconnected (`queued`): the mail queues for up to 1 h, exactly as a direct send would. **[call]**
  - No holder, or the holder is closed: refused `role_vacant`. A daemon below the roles gate gets `unknown_agent` instead, which it already decodes.
  - Below the gate a receipt is unchanged. From the gate on, it carries `to_name`, the resolved holder's bus name (a new optional field in `ReceiptSchema` and `receiptShape`).
- **Owner-only REST**, behind the session cookie plus the existing CSRF and Origin checks:
  - `PUT /api/v1/roles/{namespace}/{role}` with `{agentId}` to point a role at an agent.
  - `DELETE` the same path to remove a role.
  - `GET /api/v1/roles` to list roles.
  - No machine token or adapter can write a role.
- **Read side:** from the gate on, a roster row gains `role?`, `list_agents` shows `lane-6 → code-96`, and `self` reports the agent's own role.

### Status (OpenBus only)

- Tool `set_status({state, label?})` in every adapter. `state` is one of the four values, and `label` is at most `maxLabelChars` (64) characters, cleaned the same way as machine labels.
- **Wire:** a daemon `status` frame, attested by `from_ref` like every frame. The hub stores `status`, `statusLabel` and `statusAt` on the agent row and clears them on close.
- **Rate limit:** the first update in any 5 s window applies at once. Later updates in that window are coalesced, and the hub applies the last one when the window closes, using the DO alarm it already schedules. **[call]**
- **Read side:**
  - REST `AgentSchema` and the dashboard feed gain optional `status`, `statusLabel` and `statusAt`. Older dashboard tabs ignore them, because the REST and feed schemas are built per deploy.
  - The dashboard Agents page shows them in a column tagged "agent says".
  - From the gate on, `list_agents` shows the status after the name.

### Wire compatibility (all new fields)

The wire decoders are strict (CONTRACT.md "additive fields"), so every new server-to-daemon field is gated by `semverGte(hello.client_version, AGENT_CARD_MIN_CLIENT)`, where `AGENT_CARD_MIN_CLIENT` is the first daemon release that decodes them. Below the gate:

- Roster rows carry neither `role` nor `status*`.
- Receipts carry no `to_name`.
- `role_vacant` is sent as `unknown_agent`.
- The hub never sends `card` or `card_refused` frames.
- The adapters don't offer the `set_status` or `card` tools. The adapter checks the daemon version from `self`.

New enum values go only into `REFUSAL_REASONS` and `ErrorFrame.code`, and only from the gate on.

### Linking OA to a bus (one time, per OA user)

1. In OA Settings, under "Link OpenBus", the user enters their bus host. OA redirects to `https://<bus>/link?aud=<OA origin>&state=<OA nonce>`. There is no `redirect_uri` parameter, and one sent anyway is refused with 400.
2. The bus validates the request before anything else, and answers 400 on any failure:
   - `aud` is an exact https origin: a scheme and host, plus an optional port, with no path, query or fragment. Compared lowercased.
   - `state` matches `^[A-Za-z0-9_-]{16,128}$`.
3. The bus asks the owner to sign in. The validated request is kept in a short-lived, HttpOnly `ob_link` cookie (10 min) instead of being carried through `next`, so `safeNext` and its `MAX_NEXT_LEN` cap never touch it. After sign-in, the bus shows a confirm page ("Let <aud> verify your agents' cards?"), protected by the existing CSRF and Origin checks.
4. On confirm, the bus adds `aud` to `linked_apps(aud, linked_at)` in the hub DO's SQLite. It then redirects to the fixed callback `aud + LINK_CALLBACK_PATH`, where `LINK_CALLBACK_PATH = "/settings/openbus/callback"` (agreed with OA), with no query and `#assertion=<jws>&state=<state>`. A caller-chosen path would let any open redirect or script-injectable page on `aud`'s origin carry the fragment to an attacker, who could then pin their OA account to this owner (found in AC4c review). The redirect carries a short-lived (5 min) signed **link assertion** `{iss, aud, owner, state, iat, exp, jti}`. `aud` is OA's exact origin, and `state` is OA's, echoed. OA binds `state` to the user's session and accepts it once. The assertion travels only in the URL fragment. The bus never puts it in a query string or a path, and never logs it. OA's callback page clears the fragment from history (`history.replaceState`) before doing anything else. It then POSTs the assertion same-origin with OA's CSRF header, with no other redirects and no third-party scripts.
5. OA verifies the link assertion and pins two values to that OA user: the issuer (the bus origin) and `owner`.

`owner` is an opaque owner id, pairwise per linked app, so two linked apps can't correlate the user: `base64url(HMAC-SHA256(CARD_OWNER_SALT, "owner\n" + aud))`. `CARD_OWNER_SALT` is a random per-bus secret that `ob:setup` generates once and never rotates. A bus has exactly one owner today, so the salt is effectively the permanent account id. The owner id doesn't depend on the email, so changing `OWNER_EMAIL` keeps every link. When orgs arrive, the input becomes the account id instead of the literal `"owner"`, which is a breaking change for links and must be re-linked.

**Invariant: one human owner per bus.** OpenBus is single-owner by design: the base spec makes organizations and sharing a non-goal, and sign-in admits only `OWNER_EMAIL` (`isOwner`). `/link` and every card are issued only for that owner. Before any multi-user change ships, the `owner` input must include that user's stable id. That change must ship together with the multi-user change, not after it, and the spec for it must say so. It is neither the email nor an OIDC sub, because each Access app issues a different sub. OA pins `(iss, owner)` per OA user and stores no email.

**Owner-only REST**, with the same checks as the roles routes:

- `GET /api/v1/linked-apps` lists linked apps.
- `DELETE /api/v1/linked-apps/{aud}` unlinks one. After that the bus refuses to sign cards for that `aud` (`not_linked`).

Unlinking works from both sides. Unlinking in OA deletes OA's pin. After a bus-side unlink, OA's stored snapshot stays until the next present fails, and then OA shows the card as "no longer verified", not as an error.

### The card

**Issuing:**

1. The agent calls OA's `present_card()`, which returns a nonce bound to the agent's OAuth grant.
2. The agent calls the bus tool `card({audience, nonce})`. The daemon attests the caller as for every frame and sends `card_request {id, from_ref, aud, nonce}`.
   - `nonce` must match `^[A-Za-z0-9_-]{16,128}$`.
   - Each agent may request at most 6 cards a minute.
3. The hub replies `card {id, jwt}`, signing the card only when `aud` is in `linked_apps`. Otherwise it replies `card_refused {id, code}`, where `code` is one of `not_linked`, `bad_nonce` or `rate_limited`. The daemon maps that onto the tool's error.
4. The agent calls `present_card(jwt)`. OA checks the signature, `iss` and `owner` against its pins, `aud`, `exp`, the nonce for this grant, and that the `jti` hasn't been seen before. It then stores a snapshot plus "attested <time>" on the grant. Presenting a new card updates the snapshot.

**Format:** compact JWS, `alg: EdDSA` (Ed25519), with a `kid` header. The `typ` header separates the two token kinds, so neither can pass as the other: `ob-card+jwt` for a card, and `ob-link+jwt` for a link assertion. A verifier must check `typ`.

Verifier rules, binding on OA:

- Accept only `alg: EdDSA`, and reject anything else, including `none`.
- `kid` is required.
- Fetch the JWKS only from the pinned https `iss` plus `/.well-known/jwks.json`: no redirects, with a timeout and a size cap.
- On an unknown `kid`, refetch at most once per 5 minutes.
- The card's `aud` must equal OA's own origin.

Claims:

| Claim        | Meaning                                                                                                 | Trust                |
| ------------ | ------------------------------------------------------------------------------------------------------- | -------------------- |
| `iss`        | bus origin                                                                                              | attested             |
| `aud`        | OA origin, which must be linked                                                                         | attested             |
| `sub`        | agent id (one per session)                                                                              | attested             |
| `owner`      | opaque owner id (above)                                                                                 | attested             |
| `nonce`      | OA's grant-bound challenge, `^[A-Za-z0-9_-]{16,128}$`; OA issues one per grant, single use, TTL ≤ 300 s | echoed               |
| `iat`, `exp` | `exp = iat + 300 s`                                                                                     | attested             |
| `jti`        | random 128-bit id                                                                                       | attested             |
| `name`       | bus name                                                                                                | attested             |
| `role`       | owner-assigned role, if any                                                                             | attested (owner-set) |
| `kind`       | any `KindTokenSchema` value (`codex` lands with C26)                                                    | attested             |
| `machine`    | machine label                                                                                           | attested             |
| `agent_says` | `{status, label}` if set                                                                                | **self-reported**    |

The card leaves out email, namespace and machine id.

**Keys:**

- `ob:setup` generates an Ed25519 key pair and stores it as the Worker secret `CARD_SIGNING_KEY` (a JWK). `CARD_OWNER_SALT` is generated the same way.
- `GET /.well-known/jwks.json` publishes the current key and the previous one, with `Cache-Control: max-age=3600`. After a rotation, the previous key stays published for at least 24 h and until the next rotation. `--rotate-card-key` refuses to run again within 24 h unless given `--force`.
- To rotate, run `ob:setup --rotate-card-key`, which demotes the current key to previous. A card signed with the previous key verifies until it expires.
- **Test keys:**
  - Staging (`open-bus-staging`) has its own `CARD_SIGNING_KEY`, generated by setup and never shared with prod. OA's red-line suite uses it.
  - `packages/shared/src/mocks/card.ts` publishes a fixed test-only Ed25519 JWK, plus a `signTestCard(claims)` and `signTestLink(claims)` fixture signer, for OA's in-server tests. That JWK must never be accepted outside tests, and the bus refuses to start if `CARD_SIGNING_KEY` equals it.
- The hub DO signs, using `env.CARD_SIGNING_KEY`, because daemon frames end at the DO and never pass through a Worker request path. The key comes from the Worker's secrets, which the DO already receives, and it is never written to DO storage. Link assertions are signed in the Worker's `/link` route with the same key.

### OA half (owned by OA, summarized for completeness)

- **Backend:**
  - a verifier: JWKS fetched only from the pinned https issuer, with a timeout, a size cap and caching; Ed25519; `iss`, `aud`, `exp` and `owner` pins; a `jti` replay cache
  - the two-step `present_card` tool
  - grant storage
- **Frontend:** an "Attested by <bus>" block on the #587 card, kept separate from the amber "reported by the agent" tag, plus the "Link OpenBus" setting.
- **Matching:** the owner is matched to the OA user who approved the grant, not to the instance owner, because team installs have many users.
- **Visibility:** attested fields show only to that user in Settings. Viewer presence never shows machine or role unless the user opts in to role.
- **Size:** about 3 to 4 days, after OA M1, and it needs the user's OK.

## Threats and mitigations

- **Agent B presents agent A's card:** OA's nonce is bound to B's grant, and the bus signs it only for the attested caller, so A's card carries A's nonce and fails on B's grant.
- **A same-uid local process impersonates a session:** the existing accepted threat model, unchanged.
- **Card theft in transit or in logs:** it expires in 5 minutes, has a one-time `jti`, and only works for a linked `aud`.
- **Rogue audience:** the bus signs only for owner-linked origins, so an agent can't send the owner's id to an arbitrary site.
- **A key leaks:** rotate with `ob:setup --rotate-card-key`. A card is display only, so the blast radius is mislabelled agents in OA.
- **Owner mismatch on team OA installs:** OA pins `owner` per OA user.
- **A role points at a stale agent:** a closed holder makes the role vacant, and sends are refused, never misdelivered.

## Delivery

About 400 lines or less per PR:

| #   | Track             | PR                                                                                                               |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Shared            | schemas: roster `role` and `status*`; `status` and `card_request` frames; the `role_vacant` refusal; card claims |
| 2   | Backend           | hub roles table, send resolution and roles REST                                                                  |
| 3   | Backend           | hub status storage and rate limit                                                                                |
| 4   | Backend           | link flow, `linked_apps`, card signing, JWKS, setup key generation and rotation                                  |
| 5   | Client            | `set_status` and `card` tools in all adapters, plus `self` shows the role; version gate                          |
| 6   | Frontend + Design | dashboard roles editor, status column, Linked apps list and confirm page                                         |
| 7   | OA                | verifier, `present_card`, Link OpenBus and the attested block (OA's own plan)                                    |

Backend's session must be restarted onto the bus before PRs 2 to 4.

## Verification

- A role sent to while vacant is refused, and re-pointing it delivers to the new holder. An agent can't set a role through any tool or frame.
- The first status update in a window shows on the dashboard within 2 s, tagged "agent says". A burst ends showing the last value within 7 s, and the status is cleared on close.
- A daemon at 0.46.3 (below the gate) keeps decoding the roster, receipts and refusals while roles, status and cards are in use.
- The link flow refuses any `redirect_uri` parameter, an `aud` with a path, and a malformed `state`, and always redirects to `aud` + `/settings/openbus/callback`.
- A card verifies against the JWKS in a test OA verifier. It fails for a different `aud`, for one second after `exp`, for a replayed `jti`, and for another grant's nonce.
- After a key rotation, the old card verifies until it expires.
- Unlinking an `aud` stops new cards.
- Staging end to end: a Claude agent links, presents, and shows "Attested by <bus>" in staging OA.

## Left to the builder

The exact frame names, the version-gate number, the dashboard layout (Design's call), and the JWKS cache headers beyond the minimum above.
