# VPN Phase 2: Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner-only `/tools/vpn` page and its `/api/vpn/*` routes. They add, remove and re-issue peers, set DNS and full or split tunnel, show a new peer's config once as a QR code and a `.conf` download, and show the VM's report.

**Architecture:**

- **Pure model:** `web/lib/vpn/model.ts` holds the item types and the state changes.
- **Store:** `web/lib/vpn/store.ts` reads and writes the `bgm-looper-vpn` table, with an in-memory twin used when `AUTHZ_MODE=local` and `VERCEL` is unset.
- **Browser-only:** `web/lib/vpn/keys.ts` and `web/lib/vpn/client-config.ts` make the keypair and the config text. The private key never leaves the browser.
- **API routes:** each one reads, applies a model function, and writes back with a version-conditional put, retrying once on a conflict.
- **Access:** one Cedar action, `vpn:manage`, in `ownerOnly`, gates the page and every route.

**Tech Stack:**

- Next.js 16, React 19 and TypeScript;
- `@aws-sdk/lib-dynamodb`, already a dependency;
- new dependencies `@noble/curves` (X25519) and `qrcode` with `@types/qrcode`;
- Vitest with `aws-sdk-client-mock`, and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md`, §4, §5 and §7.

**Depends on:** Phase 1's PR B on `dev`, so that `VPN_TABLE_NAME` is set for dev's previews. Unit tests and e2e don't need it.

## Global Constraints

- Table items, exactly as Phase 3's agent reads and writes them:
  - `desired`: `{ pk: "desired", version: number, settingsVersion: number, settings: { dns: string[], tunnel: "full" | "split", cidrs: string[] }, peers: Peer[] }`
  - `Peer`: `{ id: string /* uuid */, name: string, publicKey: string, address: string /* "10.66.66.N" */, createdAt: number /* epoch s */, settingsVersion: number }`
  - `server`: `{ pk: "server", publicKey: string, endpoint: string /* "a.b.c.d:51820" */, appliedVersion: number, lastSeen: number, certNotAfter: number, error: string | null, peers: Record<publicKey, { latestHandshake: number, rxBytes: number, txBytes: number }> }`
- `DEFAULT_DESIRED`, used when the item doesn't exist: `{ pk: "desired", version: 0, settingsVersion: 1, settings: { dns: ["1.1.1.1", "1.0.0.1"], tunnel: "full", cidrs: [] }, peers: [] }`.
- Addresses come from `10.66.66.2` to `10.66.66.254`, lowest free first. The server is `10.66.66.1`.
- A public key is base64 that decodes to exactly 32 bytes (44 characters, ending `=`).
- A peer name is 1–40 characters, matching `^[A-Za-z0-9 ._-]+$`.
- DNS: 1–3 IPv4 addresses.
- Split-tunnel CIDRs: 1–32 IPv4 CIDRs. The list is required when `tunnel = "split"` and ignored for `"full"`.
- `AllowedIPs`: `0.0.0.0/0, ::/0` for full. For split, the CIDRs plus `<dns>/32` for each DNS server.
- Status:
  - online when `now - lastSeen < 180` seconds;
  - "applying" when `appliedVersion < version`;
  - a certificate warning when `certNotAfter - now < 30 * 86400`.
- The client config is exactly:

  ```
  [Interface]
  PrivateKey = <private>
  Address = <address>/32
  DNS = <dns joined ", ">

  [Peer]
  PublicKey = <server.publicKey>
  Endpoint = <server.endpoint>
  AllowedIPs = <allowed joined ", ">
  PersistentKeepalive = 25
  ```

  It ends with a trailing newline.
- The `.conf` filename is the peer name lowercased, with runs of characters outside `[a-z0-9]` replaced by `-`, trimmed of `-`, cut to 32 characters, then `.conf`. If that leaves nothing, the name is `wg-peer.conf`.
- API errors are JSON `{ error }`:

  | Error | Status |
  |---|---|
  | `bad_request` | 400 |
  | `not_found` | 404 |
  | `full` | 409 |
  | `conflict` | 409 |
  | `not_configured` | 503 |
- Import `z` from `web/lib/zod.ts`, never from `"zod"`.
- Every PR into `dev` has an issue first (a sub-issue of #591), a `CHANGELOG.md` entry, and commits ending `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Before each push: `npm test`, `npm run lint` and `npx tsc --noEmit` in `web/`.

## Review Focus

1. **Two tabs, one stale.** A write based on an old `version` must not drop the other tab's peer. The conditional write plus a single retry handles it. Task 3 has `"retries once on a version conflict, then reports conflict"`.
2. **Hostile input.** A peer name or public key carrying a newline or `PostUp =` must be refused at the API. Phase 3's agent refuses it too, but the API is the first gate. Task 2 has `"isPublicKey refuses newline and padding tricks"`, and Task 4 has `"POST /api/vpn/peers refuses a name with a newline"`.
3. **All 253 addresses in use.** The next add returns `full` (409) and writes nothing. Task 2 has `"addPeer throws full when 253 peers exist"`.
4. **The VM never reported (no `server` item).** The page disables Add and Re-issue and says why, and doesn't crash on a missing `server`. Task 5 has `"disables Add peer until the server has reported"`.
5. **Split tunnel with DNS outside the CIDRs.** The DNS servers' `/32`s must still be in `AllowedIPs`, or DNS leaks to the local network. Task 2 has `"split tunnel adds each DNS server's /32"`.

---

### Task 1: `vpn:manage`, the route gate and the hub entry

**Files:**
- Modify: `infra/modules/auth/cedar/schema.cedarschema.json` (add `"vpn:manage"`, a copy of `access:manage`'s entry: `memberOf: [{ "id": "ownerOnly" }]`, the same `appliesTo`)
- Modify: `web/lib/route-gate.ts`:
  - `ToolId` gets `"vpn"`;
  - `ActionId` gets `"vpn:manage"`;
  - a `TOOLS` entry placed before `access-admin`: `{ id: "vpn", href: "/tools/vpn", name: "VPN", kind: "Network", blurb: "Add and remove WireGuard devices on the San Jose exit, and see when each last connected.", pageAction: "vpn:manage" }`;
  - `ROUTE_ACTIONS` rows `{ methods: PAGE, path: /^\/tools\/vpn$/, tool: "vpn", action: "vpn:manage" }` and `{ methods: "*", path: /^\/api\/vpn(\/.*)?$/, tool: "vpn", action: "vpn:manage" }`;
  - `"/api/vpn"` added to `GATED_PREFIXES`.
- Modify: `web/lib/site/commands.ts` (row `{ id: "open-vpn", label: "open vpn", hint: "Manage VPN devices", run: (ctx) => ctx.push("/tools/vpn") }`, before `open-access-admin`)
- Test: `web/lib/authz/policies.test.ts` (`OWNER_ONLY` gets `["vpn:manage", "vpn"]`; the friends `it.each` list gets `"vpn"`)
- Test: `web/lib/route-gate.test.ts` (gated-path rows `["/tools/vpn", true]` and `["/api/vpn/peers", true]`; action rows `["GET", "/tools/vpn", "vpn", "vpn:manage", false]` and `["DELETE", "/api/vpn/peers/abc", "vpn", "vpn:manage", false]`)
- Test: `web/e2e/access.spec.ts` (add `"VPN"` to both name lists)

**Interfaces:**
- Produces: `ToolId` `"vpn"` and `ActionId` `"vpn:manage"`. Every later task's route sits under the two new `ROUTE_ACTIONS` rows.

- [ ] **Step 1: File the issue and branch**

  Title "feat(portfolio): VPN dashboard at /tools/vpn". Make it a sub-issue of #591. Branch `feat/<N>-vpn-dashboard`. All of Phase 2 is one PR.

- [ ] **Step 2: Add the test rows above, then run the tests and check that they fail**

  Run `cd web && npx vitest run lib/authz/policies.test.ts lib/route-gate.test.ts`. Expected: FAIL, because `vpn:manage` is not in the schema and `/tools/vpn` is unmapped.

- [ ] **Step 3: Make the schema, `route-gate.ts` and `commands.ts` edits listed under Files**

- [ ] **Step 4: Run the tests again and check that they pass**

  Run `cd web && npx vitest run lib/authz lib/route-gate.test.ts lib/route-coverage.test.ts app/tools/page.test.tsx`. Expected: PASS. `route-coverage` passes because no VPN `route.ts` or `page.tsx` exists yet.

- [ ] **Step 5: Commit**

  `feat(vpn): add the owner-only vpn:manage action and the /tools/vpn route gate (#N)`

---

### Task 2: The VPN model

**Files:**
- Create: `web/lib/vpn/model.ts`
- Test: `web/lib/vpn/model.test.ts`

**Interfaces:**
- Produces these exports from `web/lib/vpn/model.ts`:
  - Types: `Settings`, `Peer`, `Desired`, `PeerStats`, `ServerReport` (the Global Constraints shapes); `class VpnError extends Error { code: "full" | "not_found" | "bad_request" }`.
  - `DEFAULT_DESIRED: Desired`
  - `isPublicKey(s: string): boolean`
  - `nextAddress(peers: Peer[]): string | null`
  - `addPeer(d: Desired, p: { id: string; name: string; publicKey: string; now: number }): Desired`. It sets the next address and the peer's `settingsVersion = d.settingsVersion`, and increments `version`. It throws `VpnError("full")`.
  - `removePeer(d: Desired, id: string): Desired`. Increments `version`; throws `not_found`.
  - `reissuePeer(d: Desired, id: string, publicKey: string): Desired`. Keeps `id`, `name` and `address`, sets `publicKey` and `settingsVersion = d.settingsVersion`, and increments `version`; throws `not_found`.
  - `updateSettings(d: Desired, s: Settings): Desired`. Increments both `version` and `settingsVersion`.
  - `allowedIps(s: Settings): string[]`
  - `serverStatus(server: ServerReport | null, d: Desired, now: number): { seen: boolean; online: boolean; applying: boolean; certExpiresSoon: boolean }`
  - `settingsSchema` and `peerInputSchema` (Zod; `peerInputSchema = { name, publicKey }`)
- Every function returns a new object; none mutates its input. Duplicate public keys throw `VpnError("bad_request")`.

- [ ] **Step 1: Write the failing tests in `model.test.ts`**

  Use these test names and assertions:
  - `"nextAddress returns 10.66.66.2 for no peers and fills the lowest gap"`: peers at `.2` and `.4` give `"10.66.66.3"`.
  - `"addPeer throws full when 253 peers exist"`: build 253 peers at `.2`–`.254`, expect `VpnError` with `code: "full"`.
  - `"addPeer stamps the current settingsVersion and bumps version"`
  - `"addPeer refuses a public key already in use"`, with code `bad_request`.
  - `"removePeer and reissuePeer throw not_found for an unknown id"`
  - `"reissuePeer keeps id, name and address and swaps the key"`
  - `"updateSettings bumps settingsVersion so older peers read as out of date"`
  - `"isPublicKey refuses newline and padding tricks"`. The key `"A".repeat(43) + "="` passes. The same with `"\n"` appended fails, and so do a 32-character string, the string `"PostUp = x"`, and base64 that decodes to 31 or 33 bytes.
  - `"full tunnel routes 0.0.0.0/0 and ::/0"`
  - `"split tunnel adds each DNS server's /32"`: `{ tunnel: "split", cidrs: ["10.1.0.0/16"], dns: ["1.1.1.1", "9.9.9.9"] }` gives `["10.1.0.0/16", "1.1.1.1/32", "9.9.9.9/32"]`, with no duplicate when a DNS `/32` is already listed.
  - `"settingsSchema requires cidrs for split and rejects IPv6 and bad CIDRs"`: it rejects `"10.0.0.0/33"`, `"::/0"` and `"300.1.1.1"`.
  - `"serverStatus: unseen, offline after 180 s, applying, cert warning inside 30 days"`

- [ ] **Step 2: Run the tests and check that they fail**

  Run `cd web && npx vitest run lib/vpn/model.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `model.ts`**

  Validate IPv4 by parsing four octets from 0 to 255, and the prefix from 0 to 32. Don't add a library. `isPublicKey` checks `/^[A-Za-z0-9+/]{43}=$/` and that `Buffer.from(s, "base64").length === 32`.

- [ ] **Step 4: Run the tests again and check that they pass**

  Run `cd web && npx vitest run lib/vpn/model.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

  `feat(vpn): add the VPN peer and settings model (#N)`

---

### Task 3: The VPN store, in DynamoDB and in memory

**Files:**
- Create: `web/lib/vpn/store.ts`
- Test: `web/lib/vpn/store.test.ts` (`// @vitest-environment node`, using `mockClient(DynamoDBDocumentClient)` like `web/lib/authz/grants.test.ts`)

**Interfaces:**
- Consumes: `Desired`, `ServerReport`, `DEFAULT_DESIRED` and `VpnError` from Task 2; `awsCredentials()` from `web/lib/aws.ts`.
- Produces:
  - `interface VpnStore { read(): Promise<{ desired: Desired; server: ServerReport | null }>; writeDesired(next: Desired, expectedVersion: number): Promise<boolean> }`. `writeDesired` resolves `false` on `ConditionalCheckFailedException` and throws on anything else.
  - `getVpnStore(env?: NodeJS.ProcessEnv): VpnStore | null`. It returns the memory store when `AUTHZ_MODE === "local" && !VERCEL`, the DynamoDB store when `VPN_TABLE_NAME` is set, and `null` otherwise.
  - `mutateDesired(store: VpnStore, change: (d: Desired) => Desired): Promise<Desired>`. It reads, applies `change` and writes with `expectedVersion = d.version`. If the write returns `false`, it rereads and tries once more. A second `false` throws `new VpnError("conflict")` (add `"conflict"` to `VpnError`'s code union in Task 2's file).
  - `resetMemoryVpnStore(): void`, for tests.
- The memory store starts with `DEFAULT_DESIRED` and this fake `server`:
  - `{ pk: "server", publicKey: "TESTSERVERKEYTESTSERVERKEYTESTSERVERKEY0000=", endpoint: "203.0.113.10:51820", appliedVersion: 0, lastSeen: <now at read>, certNotAfter: <now + 365 d>, error: null, peers: {} }`;
  - each `read()` sets `appliedVersion` to the current `version`, so e2e sees "applied".

- [ ] **Step 1: Write the failing tests**

  - `"reads both items with consistent reads"`: two `GetCommand`s. Assert the inputs are `{ TableName: "bgm-looper-vpn", Key: { pk: "desired" }, ConsistentRead: true }` and the same with `pk: "server"`.
  - `"returns DEFAULT_DESIRED and null server when neither item exists"`
  - `"writes desired with a version condition"`: for `expectedVersion = 3`, the `PutCommand` input has `ConditionExpression: "#v = :v"`, `ExpressionAttributeNames: { "#v": "version" }` and `ExpressionAttributeValues: { ":v": 3 }`.
  - `"first write uses attribute_not_exists"`: for `expectedVersion = 0`, the condition is `"attribute_not_exists(pk)"`.
  - `"writeDesired resolves false on ConditionalCheckFailedException"`
  - `"retries once on a version conflict, then reports conflict"`: the first `PutCommand` rejects with `ConditionalCheckFailedException`, the second resolves, so `mutateDesired` resolves and `GetCommand` was called twice for `desired`. Then both puts reject, and it throws `VpnError` with code `conflict`.
  - `"getVpnStore picks memory only off Vercel"`: `{ AUTHZ_MODE: "local", VERCEL: "1", VPN_TABLE_NAME: "t" }` gives the DynamoDB store (not the memory one), and `{}` gives `null`.

- [ ] **Step 2: Run the tests and check that they fail**

  Run `cd web && npx vitest run lib/vpn/store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `store.ts`**

  Use one cached `DynamoDBDocumentClient` with `marshallOptions: { removeUndefinedValues: true }`, as `grants.ts` does.

- [ ] **Step 4: Run the tests again and check that they pass**

  Run `cd web && npx vitest run lib/vpn`. Expected: PASS.

- [ ] **Step 5: Commit**

  `feat(vpn): add the VPN table store with an in-memory twin for local runs (#N)`

---

### Task 4: The `/api/vpn` routes

**Files:**
- Create: `web/app/api/vpn/route.ts` (`GET`)
- Create: `web/app/api/vpn/settings/route.ts` (`PUT`)
- Create: `web/app/api/vpn/peers/route.ts` (`POST`)
- Create: `web/app/api/vpn/peers/[id]/route.ts` (`DELETE`)
- Create: `web/app/api/vpn/peers/[id]/reissue/route.ts` (`POST`)
- Create: `web/lib/vpn/api.ts` (`respond`)
- Test: `web/app/api/vpn/routes.test.ts`

**Interfaces:**
- Consumes: `getVpnStore` and `mutateDesired` from Task 3; the model functions and schemas from Task 2.
- Produces this HTTP contract, which Task 5's client uses:
  - `GET /api/vpn` → `200 { desired, server }`.
  - `PUT /api/vpn/settings` with body `Settings` → `200 { desired }`.
  - `POST /api/vpn/peers` with body `{ name, publicKey }` → `201 { desired, peer }`, where `peer` is the stored peer.
  - `POST /api/vpn/peers/:id/reissue` with body `{ publicKey }` → `200 { desired, peer }`.
  - `DELETE /api/vpn/peers/:id` → `200 { desired }`.
  - Errors as in Global Constraints. A `null` store gives `503 not_configured`, and an unparsable body or failed schema gives `400 bad_request`.
- `respond(fn: () => Promise<Response>): Promise<Response>` in `web/lib/vpn/api.ts` maps `VpnError` codes to statuses and logs anything else as `console.error("vpn: …", err)` with a 500 `{ error: "internal" }`.
- The peer `id` is `crypto.randomUUID()`, made in `POST /api/vpn/peers`, and `now` is `Math.floor(Date.now() / 1000)`.

- [ ] **Step 1: Write the failing tests**

  Use `resetMemoryVpnStore()` in `beforeEach`, with `process.env.AUTHZ_MODE = "local"` and `VERCEL` deleted. Call the handlers directly with `new Request(...)`.
  - `"GET returns the default desired and the fake server"`
  - `"POST /api/vpn/peers adds a peer at 10.66.66.2 and returns it"`
  - `"POST /api/vpn/peers refuses a name with a newline"`: `{ name: "a\nPostUp = rm -rf /", publicKey: <valid> }` gives 400 `bad_request`.
  - `"POST /api/vpn/peers refuses a bad public key"`, with 400.
  - `"reissue keeps the address and swaps the key"`
  - `"DELETE an unknown id is 404"`
  - `"PUT settings with split and no cidrs is 400"`
  - `"PUT settings bumps settingsVersion"`
  - `"503 not_configured when no store"`: set `AUTHZ_MODE` unset and `VPN_TABLE_NAME` unset.
  - `"409 full"`: seed 253 peers through repeated POSTs, or by calling `mutateDesired` directly in the test.

- [ ] **Step 2: Run the tests and check that they fail**

  Run `cd web && npx vitest run app/api/vpn`. Expected: FAIL.

- [ ] **Step 3: Implement the five route files and `api.ts`**

  For the dynamic segment, use `export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> })`, as the existing `[sub]` routes do.

- [ ] **Step 4: Run the tests again and check that they pass**

  Run `cd web && npx vitest run app/api/vpn lib/route-coverage.test.ts`. Expected: PASS. Route coverage now sees the five routes, and every one matches `/api/vpn(/.*)?`.

- [ ] **Step 5: Commit**

  `feat(vpn): add the /api/vpn routes (#N)`

---

### Task 5: Keys, the client config and the page

**Files:**
- Modify: `web/package.json` (dependencies `@noble/curves` and `qrcode`; dev dependency `@types/qrcode`; run `npm install` in `web/`)
- Create: `web/lib/vpn/keys.ts`
- Create: `web/lib/vpn/client-config.ts`
- Create: `web/components/vpn/VpnDashboard.tsx` (`"use client"`)
- Create: `web/components/vpn/NewPeerConfig.tsx` (`"use client"`)
- Create: `web/app/tools/vpn/page.tsx` (the same shell as `web/app/tools/access-admin/page.tsx`, with eyebrow "Owner" and h1 "VPN")
- Test: `web/lib/vpn/keys.test.ts`
- Test: `web/lib/vpn/client-config.test.ts`
- Test: `web/components/vpn/VpnDashboard.test.tsx`

**Interfaces:**
- Consumes: Task 4's HTTP contract, and `allowedIps` and `serverStatus` from Task 2.
- Produces:
  - `generateKeypair(): { privateKey: string; publicKey: string }` (base64), and `publicKeyFor(privateKey: string): string`;
  - `clientConfig(a: { privateKey: string; peer: Peer; settings: Settings; server: ServerReport }): string`;
  - `confFilename(name: string): string`.
- These modules import nothing from `next/headers` or the AWS SDK; they run in the browser.

- [ ] **Step 1: Write the failing tests**

  - `keys.test.ts`, `"derives the RFC 7748 §6.1 public key"`: `publicKeyFor(base64("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"))` equals `base64("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")`.
  - `keys.test.ts`, `"generateKeypair gives a 32-byte pair whose public half matches"`: `isPublicKey(pub)` is true, and `publicKeyFor(priv) === pub`.
  - `client-config.test.ts`, `"renders the exact config text"`: compare against the Global Constraints template, for one full-tunnel and one split-tunnel case.
  - `client-config.test.ts`, `"confFilename slugs and caps at 32"`: `"Ashu's Pixel 9"` gives `"ashu-s-pixel-9.conf"`, `"***"` gives `"wg-peer.conf"`, and a 60-character name gives 32 characters plus `.conf`.

  `VpnDashboard.test.tsx` (React Testing Library, with `fetch` mocked):
  - `"disables Add peer until the server has reported"`: with `server: null`, the button `Add peer` is disabled, and the text "The VPN server hasn't reported yet" is shown.
  - `"after adding, shows the QR and .conf once and never posts the private key"`: assert the POST body has `name` and `publicKey` only. The dialog shows a `<canvas>` and a link `Download .conf`. Closing it removes both, and the private key text is no longer in the document.
  - `"marks peers whose settingsVersion is older than the current one"`: the row shows "Out of date — re-issue" and a `Re-issue` button.
  - `"shows handshake time and bytes from the server report"`

- [ ] **Step 2: Run the tests and check that they fail**

  Run `cd web && npx vitest run lib/vpn components/vpn`. Expected: FAIL.

- [ ] **Step 3: Implement `keys.ts` and `client-config.ts`**

  `keys.ts` uses `x25519` from `@noble/curves/ed25519`. Use the random-secret-key helper that the installed version exports (`utils.randomSecretKey` in v2, `utils.randomPrivateKey` in v1), and `getPublicKey`.

- [ ] **Step 4: Implement `NewPeerConfig.tsx` and `VpnDashboard.tsx`**

  **`NewPeerConfig.tsx`** takes `{ config: string; filename: string; onClose(): void }`:
  - It draws the QR with `QRCode.toCanvas(canvasRef.current, config, { errorCorrectionLevel: "M" })`. Use a canvas, not a data URL, so the page's `img-src` CSP isn't involved.
  - It makes the download link from `URL.createObjectURL(new Blob([config], { type: "text/plain" }))`. Revoke that URL on close and on unmount.
  - Below the QR, it says: "This is the only time this key is shown. Scan it on the phone, or download the .conf and import it in the WireGuard app, then delete the file."

  **`VpnDashboard.tsx`:**
  - It loads `GET /api/vpn` on mount, and every 15 seconds while the tab is visible.
  - It renders the server status line: online or offline with `lastSeen`; "Applying…" while `appliedVersion < version`; the certificate warning; and the agent's `error` if present.
  - It renders a settings form: DNS as comma-separated, Full or Split as a radio, and CIDRs as a textarea shown when Split is selected.
  - Each peer row shows name, address, last handshake (relative), received and sent bytes (human-readable), and the "Out of date" marker. It has `Re-issue` and `Remove` buttons.
  - The Add peer form has a name field. On submit it runs `generateKeypair` → POST → `clientConfig` → `<NewPeerConfig>`. Re-issue follows the same path with the reissue POST.
  - Match the existing tools' classes (`font-ui`, `border-rule-heavy`, `text-muted`). Don't use `alert` or `confirm`: Remove asks for confirmation with an inline second button.

- [ ] **Step 5: Run the tests again, plus lint and type-check**

  Run `cd web && npx vitest run && npm run lint && npx tsc --noEmit`. Expected: all pass.

- [ ] **Step 6: Commit**

  `feat(vpn): add the VPN dashboard page with in-browser keys, QR and .conf (#N)`

---

### Task 6: e2e, the CHANGELOG and the PR

**Files:**
- Create: `web/e2e/vpn.spec.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write `web/e2e/vpn.spec.ts`**

  It uses `signIn(page, baseURL!)` for the owner, against the memory store.
  - `"the owner adds a peer and sees its QR and .conf once"`: fill in the name "laptop" and click `Add peer`. Expect a canvas and the `Download .conf` link. Check that the download's filename is `laptop.conf` and that its text has `Address = 10.66.66.2/32` and `Endpoint = 203.0.113.10:51820`. Close the dialog and expect the row "laptop".
  - `"switching to split tunnel marks the peer out of date, and re-issue clears it"`
  - `"removing a peer takes it off the list"`
  - `"a friend is sent to Access denied"`: `signIn(page, baseURL!, "friends")`, `goto("/tools/vpn")`, then expect the URL `/access-denied?reason=forbidden&tool=vpn&action=vpn%3Amanage`, or `vpn:manage`, matching however the proxy encodes `access-admin`'s `access:manage` today.

  The memory store is per server process, and Playwright reuses one server, so each test removes the peers it added.

- [ ] **Step 2: Run e2e**

  Run `cd web && npm run test:e2e -- vpn.spec.ts access.spec.ts`. Expected: PASS.

- [ ] **Step 3: Add the CHANGELOG entry and commit**

  `### Added`: "Owner-only VPN dashboard at `/tools/vpn`: add, remove and re-issue WireGuard peers, with keys made in the browser and shown once as a QR code or `.conf` (#N)."

- [ ] **Step 4: Push, open the PR into `dev`, then check dev's preview by hand**

  Open the preview's `/tools/vpn` with the Playwright MCP. With Phase 1 applied on dev, it loads and shows "The VPN server hasn't reported yet", and Add peer is disabled. Merge through the `merging-a-pr` skill.
