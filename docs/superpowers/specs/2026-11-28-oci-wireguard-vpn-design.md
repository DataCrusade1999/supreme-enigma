# Personal WireGuard VPN on Oracle Cloud Always Free — design

Issue: #591 (epic). Written 2026-11-28.

## Intent

The owner wants their own VPN with a US exit for their phone and laptop, at zero cost. Oracle Cloud's Always Free tier gives a small Ampere A1 VM in San Jose and 10 TB a month of outbound traffic. WireGuard runs on that VM, and an owner-only page at `/tools/vpn` manages its peers.

The Oracle tenancy, the `vpn` compartment, the quota guard, the spend alert and the `personal-oci` user are already set up in the private `aws-org` repo. #591 lists them. This design doesn't change `aws-org`.

## Goals

- One A1 VM in compartment `vpn`, built from Terraform in this repo and a first-boot script, running a WireGuard server with NAT out of its public interface.
- A dashboard at `/tools/vpn` that adds and removes peers, shows a QR code and a `.conf` file for a new peer, shows each peer's last handshake and bytes, and sets the client DNS and full or split tunnel.
- $0 on Oracle and on AWS.

## Non-goals

- More than one VM, region or exit country.
- High availability. If the VM is down, the VPN is down.
- IPv6 exit. Clients route `::/0` into the tunnel so IPv6 can't leak around it, and the server drops it. Clients fall back to IPv4.
- Other users. Only the owner opens the page, and only the owner's devices are peers.
- Stopping Oracle from reclaiming an idle VM by generating fake load. Watch for reclamation emails in the first weeks instead.

## Anti-goals

These would make it a failure even if it works:

- Any Oracle credential in this repo, CI, Vercel, Terraform state outputs or the dashboard.
- Any charge on either cloud, including a few cents of S3 requests.
- Public SSH on the VM.
- A private key, server or client, written anywhere other than the device it belongs to.
- A table write that can make the VM run a command.

## Constraints

From #591, all hard:

- Everything Oracle-side goes in compartment `vpn` and is created as `personal-oci`. That user can't create anything outside `vpn`.
- The quota guard allows A1 up to 2 OCPUs / 12 GB, 200 GB of block storage including boot volumes, and nothing for backups, load balancers, Object Storage, Logging, Notifications, Vault or Functions. Don't design anything that depends on those.
- Oracle sign-in is a browser session token (60 minutes, refreshable for 24 hours). CI has no Oracle credential, so the Oracle stack is planned and applied only locally.
- Each AWS account in this repo is separate, with no cross-account grant between them (#397).

## Approaches considered

How does a Vercel-hosted page, which can't join the tunnel, reach WireGuard on the VM?

1. **The VM pulls from a DynamoDB table.** Picked: the owner accepted it in the conversation on 2026-11-28. The dashboard writes the desired peer list to a DynamoDB table. The VM polls the table, applies changes and writes stats back.
   - No port opens besides WireGuard.
   - If the VM is down, edits still save and apply when it comes back.
   - Cost is $0: a provisioned-capacity table stays inside DynamoDB's always-free 25 read and 25 write units. The VM authenticates with IAM Roles Anywhere, which has no charge, using a certificate from a CA the owner makes and keeps offline. AWS Private CA (about $400 a month) isn't used.
   - The cost is latency: a change takes up to about 30 seconds to apply, and stats are up to about a minute old.
2. **An agent on the VM with its own HTTPS port.** Rejected.
   - A second public port takes internet scans, and Vercel's outbound IPs aren't fixed, so there's no allowlist to put in front of it.
   - The bearer token in Vercel becomes a direct key to the server.
   - When the VM is down, the dashboard can't change anything.
3. **S3 as the store.** Rejected. Every GET and PUT is billed, which is a few cents a month at a 30-second poll, and that breaks the $0 rule.

Also rejected: a third-party tunnel such as Cloudflare Tunnel (a new vendor and account), and OCI instance principals federated to AWS (OCI instance principals have no OIDC issuer that AWS STS accepts).

## Design

### Overview

```
 browser (/tools/vpn)                     Vercel (Next.js)                AWS 223376380711
 ─ generates peer keypair ──pubkey──▶  /api/vpn/*  ──(Vercel OIDC role)──▶ DynamoDB vpn-state
 ─ shows QR / .conf once                                                     ▲   │
                                                                             │   │ poll 30 s
                                       Oracle us-sanjose-1, compartment vpn  │   ▼
                                       A1 VM: wg0 + vpn-agent ─(Roles Anywhere cert)─┘
 phone / laptop ══ WireGuard UDP 51820 ══▶ A1 VM ══ NAT ══▶ internet (San Jose)
```

### 1. AWS side

**Table.** One table per environment, `vpn-state`, in `infra/modules/app`: provisioned mode, 2 RCU / 2 WCU, no autoscaling, hash key `pk` (string). Three tables use 6 RCU and 6 WCU of the 25 free. Following `.claude/rules/infra.md`, dev's table is applied first through `dev/app`. Only production's table has a VM reading it. On dev and stage, the dashboard runs against a table with no VM behind it, and it shows "server not seen yet". That is enough for e2e tests and previews to exercise add and remove.

The table has two items:

- `pk = "desired"`: written only by the dashboard.
  - `version` (number): every write is conditional on the version it read.
  - `peers`: a list of `{id, name, publicKey, address, createdAt}`.
  - `settings`: `{dns: [ip...], tunnel: "full" | "split", cidrs: [cidr...]}`.
- `pk = "server"`: written only by the VM.
  - `publicKey`, `endpoint` (`ip:port`), `appliedVersion`, `lastSeen` and `certNotAfter`.
  - `peers`: a map from public key to `{latestHandshake, rxBytes, txBytes}`.

Nothing in the table is secret. Peer and server public keys are public by design.

**Vercel grant.** Added to `aws_iam_role_policy.vercel` in `infra/modules/app/vercel.tf`: `dynamodb:GetItem` on the table, and `dynamodb:PutItem` and `dynamodb:UpdateItem` with `dynamodb:LeadingKeys = ["desired"]`. A new Vercel env var, `VPN_TABLE_NAME`, is set per target the same way as `S3_BUCKET_NAME`.

**The VM's credential (production only),** in a new `infra/prod/account/vpn.tf`:

- `aws_rolesanywhere_trust_anchor` with a `CERTIFICATE_BUNDLE` source. Its value is the owner's CA certificate, committed as `infra/prod/account/vpn-ca.pem`. A CA certificate is public, and committing it lets CI apply `prod/account` with no new secret.
- `aws_iam_role` `vpn-agent`. Its trust policy lets `rolesanywhere.amazonaws.com` call `sts:AssumeRole`, `sts:TagSession` and `sts:SetSourceIdentity`, on two conditions:
  - `aws:SourceArn` equals the trust anchor;
  - `aws:PrincipalTag/x509Subject/CN` equals `vpn-vm`.
- The role's policy:
  - `dynamodb:GetItem` with `LeadingKeys = ["desired"]`;
  - `dynamodb:PutItem` and `dynamodb:UpdateItem` with `LeadingKeys = ["server"]`;
  - all on production's `vpn-state` only, looked up by its fixed name.
- `aws_rolesanywhere_profile` for that role, with a 1-hour session duration.
- Outputs: the trust anchor, profile and role ARNs, which the Oracle stack reads.

**The CA.**

- The owner makes it once on their machine with `openssl`: EC P-256, valid 10 years. A script in the repo, `infra/vpn/scripts/make-ca.sh`, does this.
- The CA's private key never enters the repo. It lives in the owner's password manager. `.gitignore` covers `infra/vpn/ca/`.
- The VM's certificate is valid 1 year, with CN `vpn-vm`. `infra/vpn/scripts/sign-vm-cert.sh` signs it.
- Rotation: sign a new certificate from a new CSR before `certNotAfter`. The dashboard warns 30 days ahead.
- Revocation: remove or disable the trust anchor in `prod/account`.

### 2. Oracle stack: `infra/vpn/`

**Stack setup.**

- Provider `oracle/oci ~> 9.15`, with `auth = "SecurityToken"`, `config_file_profile = var.oci_profile` and `region = var.region`.
- State goes in the prod state bucket `bgm-looper-tf-state-223376380711` under key `vpn/terraform.tfstate`, with `use_lockfile`. A run needs both `oci session authenticate --profile-name personal-oci` and `aws sso login --profile personal`.
- It reads `prod/account`'s outputs with `terraform_remote_state` from the same bucket, so no ARN is copied by hand.
- Variables live in a gitignored `terraform.tfvars`, with a committed `.example`: `compartment_id`, `region`, `availability_domain`, `oci_profile`, `ssh_public_key` and `bastion_client_cidr`.

**Resources.**

- VCN `10.0.0.0/16` and a public subnet `10.0.0.0/24`.
- Internet gateway and route table.
- A security list allowing:
  - ingress UDP 51820 from `0.0.0.0/0`;
  - ingress TCP 22 from `10.0.0.0/24` only, for the Bastion's private endpoint;
  - all egress.
- One `VM.Standard.A1.Flex` instance:
  - 1 OCPU / 6 GB, from the latest Oracle Linux 9 aarch64 platform image, looked up with a data source;
  - a 50 GB boot volume;
  - an ephemeral public IP.
- `oci_bastion_bastion` on the subnet, with `client_cidr_block_allow_list = [var.bastion_client_cidr]` and a 3-hour max session TTL. Sessions are created on demand with the CLI, not by Terraform.

**Why an ephemeral IP is enough.** An ephemeral public IP stays with the instance through stop and start, and is released only when the instance is terminated. Terminating the instance also destroys the server's private key, which must never leave the VM, so every client config has to be reissued after a rebuild anyway. A reserved IP or DNS name wouldn't save that step. It would also bring a price question (#591 asks to check reserved-IP pricing, and Oracle's pages don't state it plainly) and, for DNS, an updater that holds a Route 53 credential.

**`user_data`.**

- A cloud-init file built with `templatefile`. It carries the agent code and the Roles Anywhere ARNs, but no secret.
- It must stay under OCI's user_data limit, so check that.
- `lifecycle { ignore_changes = [metadata["user_data"]] }`, because a change to it replaces the instance, which also changes the server key.
- Later agent updates go over SSH with `infra/vpn/scripts/deploy-agent.sh`.

**CI.**

- The `Terraform` workflow's `paths` gets `!infra/vpn/**` for both `pull_request` and `push`, so a VPN-only change doesn't plan three AWS stacks. `tf-stacks.sh` doesn't change.
- `fmt -check -recursive infra/` and `tflint --recursive` still lint `infra/vpn/` whenever another infra PR runs, so the stack must stay lint-clean. The plan's local checklist runs both before each VPN PR.
- Trivy's `misconfig` scanner reads `infra/vpn/` on every `test` run. Run it locally first. A finding for the intended public UDP ingress gets a `.trivyignore` entry with its reason, like the existing ones.
- Dependabot gets `/infra/vpn` in its Terraform `directories`, and a `pip` entry for the agent.

### 3. The VM

**First boot (cloud-init).**

- Install `wireguard-tools`, Python 3.12, `dnf-automatic` and the AWS Roles Anywhere credential helper (`aws_signing_helper`). The helper is pinned by version and sha256 for linux/arm64; check that AWS publishes an arm64 build.
- Generate the server keypair with `wg genkey` into `/etc/wireguard/server.key`, mode 0600, root-owned. It is never logged or copied.
- Write `/etc/wireguard/wg0.conf`:
  - `Address = 10.66.66.1/24` and `ListenPort = 51820`;
  - `PrivateKey` read from the key file by `PostUp`;
  - fixed `PostUp`/`PostDown` lines that cloud-init writes and the agent never touches;
  - no `[Peer]` sections.
- Turn on `net.ipv4.ip_forward=1` and enable `wg-quick@wg0`.
- Set up `firewalld`:
  - public zone: allow 51820/udp, enable masquerade, remove the `ssh` service;
  - add `wg0` to a zone that allows SSH from `10.66.66.0/24` only, so SSH works over the tunnel;
  - accept TCP 22 from `10.0.0.0/24` on the public interface, for Bastion;
  - forward `wg0` to the public interface. Peer-to-peer forwarding between clients is dropped.
- `dnf-automatic` with `upgrade_type = security` and `apply_updates = yes`, plus a weekly timer that reboots only when `needs-restarting -r` says a reboot is needed.
- Generate the agent's EC P-256 key and a CSR with CN `vpn-vm` under `/var/lib/vpn-agent/`. Then wait: the agent stays stopped until a signed certificate exists.

**The agent (`vpn-agent`).**

- A Python 3.12 service in `infra/vpn/agent/`, using boto3 with `credential_process = aws_signing_helper credential-process ...`, run as a systemd service.
- Every 30 seconds:
  1. `GetItem desired` (eventually consistent).
  2. If `version` changed, validate every peer:
     - `publicKey` decodes as base64 to exactly 32 bytes;
     - `address` is a single IPv4 in `10.66.66.2–254`, unique across peers;
     - names and other fields are ignored.
     If any peer fails, it keeps the last good state and reports the error in the `server` item.
  3. Apply with `wg set wg0 peer <key> allowed-ips <addr>/32` for added or changed peers and `wg set wg0 peer <key> remove` for dropped ones. No table value is ever written into a `wg-quick` file. That rule is what stops a table write from reaching `PostUp`.
- Every 60 seconds, and right after applying a version: read `wg show wg0 dump` and write the `server` item:
  - the server public key and per-peer stats;
  - `appliedVersion`, the last error and `lastSeen`;
  - `certNotAfter`;
  - `endpoint`, the public IP from `checkip.amazonaws.com` once at start, plus `:51820`.
- After a reboot, the next poll restores the peers from `desired`, because `wg0.conf` has none.
- Tests: pytest, run as a new step in the existing `test` job in `deploy.yml`, not a new job (#320). Covered:
  - peer validation, including hostile input: newlines, `PostUp=`, oversized lists and duplicate addresses;
  - the diff between the current and desired peers;
  - parsing `wg show dump`;
  - the shape of the `server` item.

**Bootstrap order (done once, in a runbook):**

1. `terraform apply` in `prod/account`, through CI from `main`. This creates the trust anchor, role and profile.
2. `terraform apply` in `infra/vpn`, locally.
3. Create a Bastion port-forwarding session with the CLI. Port forwarding is used because managed SSH needs the Cloud Agent Bastion plugin, which Oracle documents as unreliable on some A1 images.
4. SSH through the session, copy the CSR off, sign it locally with `sign-vm-cert.sh`, copy the certificate back, and start `vpn-agent`.
5. The agent writes the `server` item, and the dashboard shows the server as online with its endpoint and public key.

After that, SSH works over the tunnel at `10.66.66.1`. Bastion stays as the fallback.

### 4. The dashboard

**Access.**

- Tool `vpn` at `/tools/vpn`, with routes under `/api/vpn/*`. `/api/vpn` is added to `GATED_PREFIXES`.
- A new Cedar action, `vpn:manage`, in the `ownerOnly` group, used as both the page action and the API action. `owner-only-guard.cedar` therefore keeps everyone but the owner out.
- The Cedar schema JSON, `ROUTE_ACTIONS` and the `TOOLS` entry all change together. The policy and route-coverage tests enforce that.

**API (server side).**

- `GET /api/vpn`: returns both items.
- `PUT /api/vpn/settings`: validates the DNS IPs and the CIDRs.
- `POST /api/vpn/peers`: takes `{name, publicKey}`. The server assigns the lowest free address and writes the new `desired` with a conditional write on `version`. On a conflict it rereads and retries once.
- `POST /api/vpn/peers/:id/reissue`: takes `{publicKey}`.
- `DELETE /api/vpn/peers/:id`.
- The server never receives a private key.

**Adding a peer (in the browser).**

- Generate an X25519 keypair with `@noble/curves`.
- Send only the public key.
- On success, build the client config:
  - `[Interface]`: `PrivateKey`, `Address = <addr>/32` and `DNS = <settings.dns>`.
  - `[Peer]`: the server public key and `Endpoint = <server.endpoint>`.
  - `AllowedIPs`: `0.0.0.0/0, ::/0` for full tunnel. For split tunnel, the configured CIDRs plus each DNS server's `/32`, so DNS queries still go through the tunnel.
  - `PersistentKeepalive = 25`.
- Show it once as a QR code (the `qrcode` package, rendered in the page) and as a `.conf` download (a Blob URL). Then drop the private key from memory.
- If the server item doesn't exist yet (the VM hasn't reported), adding a peer is disabled, because there's no server key or endpoint to put in the config.

**Default DNS.** `1.1.1.1, 1.0.0.1`. In full tunnel, these queries go through the tunnel, so the local network never sees them.

**Display.**

- The server's status: online if `lastSeen` is under 3 minutes old, `appliedVersion` against `version` ("applying…" until they match), and a certificate-expiry warning within 30 days.
- A row per peer: name, address, last handshake and bytes received and sent, from the `server` item.

**Settings changes and existing peers.** This was the owner's pick, on 2026-11-28.

- A DNS or tunnel-mode change applies to every config the dashboard builds from then on.
- Existing peers keep their old settings until they are re-issued. The page marks each peer whose settings are older than the current ones, which needs a `settingsVersion` on each peer and on `settings`.
- Each peer row has a **Re-issue** button. In the browser it:
  1. generates a new keypair;
  2. sends `POST /api/vpn/peers/:id/reissue` with the new public key, which swaps the key in `desired` in one conditional write, keeping the peer's id, name and address;
  3. shows the new QR code and `.conf` once.
- The old key stops working when the VM applies the new version.

### 5. Environments

The page and API ship to every branch as normal, each against its own account's `vpn-state`. The VM exists only for production. Dev and stage show "server not seen yet" and are where the UI is tested.

## Cost

- **Oracle.** A1 at 1 OCPU / 6 GB and a 50 GB boot volume are inside Always Free. VCN, internet gateway, security list, ephemeral IP and Bastion have no charge. The quota guard blocks anything else.
- **AWS.**
  - DynamoDB provisioned at 6 RCU and 6 WCU across three tables, inside the 25 / 25 always-free allowance. That allowance is per payer account, so it is shared across the organization: check that no other table in the organization uses provisioned capacity.
  - Roles Anywhere has no charge.
  - Data out to the VM is kilobytes a month.
- **Total: $0.** ARCHITECTURE.md's cost table gets a row.

### 6. CI Terraform roles

The CI apply roles are scoped by resource name. In `infra/prod/account/terraform-ci-roles.tf`, `ProjectNamedResources` names only `table/site-access-grants` for DynamoDB, and nothing covers Roles Anywhere. `infra/modules/nonprod-account` has the same kind of roles for dev and stage. Each policy is in the stack it gates.

Phase 1 is therefore split into two PRs:

- **1a** widens the roles:
  - `table/vpn-state` on the prod, dev and stage apply roles;
  - on the prod apply role only, `rolesanywhere:*` on this account's trust anchors and profiles, plus IAM on `role/vpn-agent`.
  - Check whether the plan roles (`ReadOnlyAccess`) can read Roles Anywhere, and add the missing read actions if not.
- **1b** adds the resources once 1a has applied on each branch.

This avoids a break-glass local apply.

The Oracle stack reads `prod/account`'s outputs, so Phase 3's apply waits until 1b has reached `main` through `dev → stage → main`. Phase 2 and Phase 3's code proceed on `dev` in the meantime.

### 7. Tests without AWS

CI's Playwright run and local `npm run dev` have no AWS credentials. A `VPN_STORE=memory` switch, like `AUTHZ_MODE=local`, swaps the DynamoDB store for an in-process one that holds `desired` and a fake `server` item. The fake `server` item has a fixed test public key and endpoint, so adding a peer can be exercised end to end. Unit tests cover the DynamoDB store with a mocked client. Dev and stage deployments use their real tables.

## Phases

Each phase is its own issue under epic #591, with its own PR into `dev`:

1. **AWS control plane:** 1a widens the CI roles (§6), and 1b adds the `vpn-state` table and Vercel grant in `infra/modules/app`, Roles Anywhere in `prod/account`, the CA scripts, and the Cedar action and route gate.
2. **Dashboard:** the page and API, with unit and e2e tests against the in-memory store (§7), then a manual check on dev's deployment.
3. **Oracle stack, VM and agent:** `infra/vpn/`, cloud-init, the agent and its tests, the CI path exclusion, Dependabot, and the bootstrap runbook. Applied locally, with the plan pasted into the PR.
4. **End-to-end check and docs:**
   - a phone and a laptop connect;
   - the exit IP is in San Jose and a DNS leak test is clean;
   - README and ARCHITECTURE updated;
   - after the first full month, Oracle shows $0.00.

## Calls I made (the owner can overrule)

- Peers use `10.66.66.0/24` and the server is `.1`.
- IPv4-only exit. `::/0` is routed into the tunnel and dropped there.
- Default DNS is Cloudflare `1.1.1.1` / `1.0.0.1`.
- A1 sized at 1 OCPU / 6 GB with a 50 GB boot volume.
- An ephemeral public IP. A rebuild reissues every client anyway.
- Bastion port forwarding, not managed SSH.
- A provisioned `vpn-state` table per environment. The VM exists only for production.
- The CA certificate is committed, and the CA key is kept in the owner's password manager.
- The agent is Python 3.12 with boto3, polling every 30 seconds and reporting every 60 seconds.
- The agent ships in `user_data`, with `ignore_changes` on it, and is updated over SSH after that.
- No WireGuard preshared key. It would be a secret stored in the table.
- Client-to-client traffic is dropped on the VM.
- `infra/vpn/**` is excluded from the `Terraform` workflow's triggers.
- The CI role widening lands as its own PR before the resources (§6).
- Phase 3's apply waits for Phase 1 to reach `main`.
- e2e and local dev use an in-memory store (§7).

## Left to the builder

- Names of files, modules and React components.
- Exact cloud-init layout and how the agent is packaged inside it, within the user_data limit.
- Exact firewalld commands.
- UI layout, within the existing tools' look.
- Test file layout.
