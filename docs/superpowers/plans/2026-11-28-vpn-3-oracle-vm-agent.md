# VPN Phase 3: Oracle stack, VM and agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**

- Build `infra/vpn/`, a local-only Terraform stack. It creates the network, the Bastion and one `VM.Standard.A1.Flex` running WireGuard in Oracle compartment `vpn`.
- Build `vpn-agent`, which keeps the VM's peers in step with `desired` and reports to `server`.
- Bootstrap the agent's certificate.
- Run the end-to-end checks and update the docs (the spec's Phase 4).

**Architecture:**

- Cloud-init installs WireGuard, firewalld rules, `dnf-automatic`, the Roles Anywhere signing helper and the agent, and it writes the agent's key and CSR.
- The owner signs the CSR over a Bastion port-forwarding session, which starts the agent.
- The agent is a small Python 3.12 package of pure functions (validation, diff, dump parsing, report) plus a loop that calls `wg set` and DynamoDB. Only the pure functions are unit-tested.

**Tech Stack:**

- Terraform 1.15 with `oracle/oci ~> 9.15` and an S3 backend;
- cloud-init, Oracle Linux 9 aarch64, `wireguard-tools` and firewalld;
- Python 3.12, boto3 (hash-locked through pip-compile, like `lambda/`) and pytest.

**Spec:** `docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md`, §2, §3 and "Cost".

**Depends on:**

- Phase 1 applied on `main`. `terraform_remote_state` reads `vpn_trust_anchor_arn`, `vpn_profile_arn` and `vpn_role_arn`.
- Phase 2 on `main`, for the end-to-end check in Task 6.

Tasks 1–3 can be built on `dev` before either is merged.

## Global Constraints

- **Oracle:**
  - Region `us-sanjose-1`, compartment `vpn`, CLI profile `personal-oci` with `--auth security_token`, and provider `auth = "SecurityToken"`.
  - Never `personal-oci-admin`. On Windows, set `OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING=True`.
  - Nothing outside compartment `vpn`. No resource from a quota family that #591 lists as zeroed.
- **Network:**
  - VCN `10.0.0.0/16`, subnet `10.0.0.0/24`.
  - WireGuard UDP `51820`, tunnel `10.66.66.0/24`, server `10.66.66.1/24`.
  - Ingress allows UDP 51820 from anywhere, TCP 22 from `10.0.0.0/24` only, and ICMP type 3 code 4 from anywhere (path MTU).
  - No public port 22.
- **Instance:**
  - `VM.Standard.A1.Flex`, `ocpus = 1`, `memory_in_gbs = 6`, `boot_volume_size_in_gbs = 50`, `assign_public_ip = true` (ephemeral).
  - The latest Oracle Linux 9 aarch64 image at creation, with `lifecycle { ignore_changes = [metadata["user_data"], source_details[0].source_id] }`.
- **Bastion:** `bastion_type = "STANDARD"`, `max_session_ttl_in_seconds = 10800`, `client_cidr_block_allow_list = [var.bastion_client_cidr]`.
- **State:** bucket `bgm-looper-tf-state-223376380711`, key `vpn/terraform.tfstate`, region `us-east-1`, `use_lockfile = true`.
- **Running it:** needs `AWS_PROFILE=personal` and a live `personal-oci` session.
- **Rendered user_data:** at most 32,000 bytes after base64. This is OCI's metadata limit.
- **Agent:**
  - Polls `desired` every 30 seconds and reports `server` every 60 seconds and right after an apply.
  - Table `bgm-looper-vpn`, region `us-east-1`.
  - Runs as system user `vpn-agent` with `AmbientCapabilities=CAP_NET_ADMIN`. It never writes a `wg-quick` file.
- **Item shapes:** exactly Phase 2's Global Constraints (`docs/superpowers/plans/2026-11-28-vpn-2-dashboard.md`).
- **Peer validation, on the VM:**
  - `publicKey` matches `^[A-Za-z0-9+/]{43}=$` and decodes to 32 bytes;
  - `address` is `10.66.66.N` with N from 2 to 254, unique;
  - public keys are unique;
  - at most 253 peers.

  If any peer fails, the whole version is refused, the last good state is kept, and the error goes into `server.error`.
- **Secrets:** the server key at `/etc/wireguard/server.key` (0600 root) and the agent key at `/var/lib/vpn-agent/key.pem` (0600 `vpn-agent`) never leave the VM. Nothing prints them.
- **CI:**
  - `infra/vpn/**` is excluded from `.github/workflows/terraform.yml`'s `pull_request` and `push` `paths`.
  - The agent's tests run in `deploy.yml`'s existing `test` job, never a new job (#320).
- **Every PR into `dev`:**
  - an issue first, as a sub-issue of #591;
  - a `CHANGELOG.md` entry;
  - commits ending `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`;
  - the local `terraform plan` output pasted into the PR. CI doesn't plan this stack.

## Review Focus

1. **A hostile `desired` item.** A table write must never run a command on the VM: a public key with a newline, an `address` of `10.66.66.2/32, 0.0.0.0/0`, or 10,000 peers. Task 1 has `test_refuses_injection_and_route_widening` and `test_refuses_too_many_peers`.
2. **The agent restarts or the VM reboots.** `wg0` comes up with no peers, and the first poll restores every peer from `desired`, even though `version` equals the last one it applied. Task 1 has `test_plan_changes_restores_all_after_reboot`.
3. **DynamoDB or the network is down.** The loop logs, keeps the current peers and retries on the next tick, without crashing or removing peers. Task 2 has `test_tick_keeps_peers_when_get_item_fails`.
4. **A newer image or a cloud-init edit.** A later `terraform plan` must not replace the instance. Task 4 Step 6 checks that a second plan is `No changes`.
5. **The certificate is near expiry.** `certNotAfter` is reported, and the dashboard (Phase 2) warns 30 days ahead. Task 2 has `test_report_includes_cert_not_after`.

---

### Task 1: The agent's pure functions

**Files:**
- Create: `infra/vpn/agent/vpn_agent/__init__.py`
- Create: `infra/vpn/agent/vpn_agent/peers.py`
- Create: `infra/vpn/agent/vpn_agent/wg.py`
- Create: `infra/vpn/agent/pytest.ini` (`pythonpath = .`, `testpaths = tests`)
- Create: `infra/vpn/agent/requirements.in` (`boto3`), `infra/vpn/agent/requirements-dev.in` (`-r requirements.in`, `pytest`), and the hash-locked `.txt` files that `pip-compile --allow-unsafe --generate-hashes --strip-extras` produces from them, the same as `lambda/`
- Test: `infra/vpn/agent/tests/test_peers.py`
- Test: `infra/vpn/agent/tests/test_wg.py`

**Interfaces:**
- Produces:
  - `peers.py`:
    - `@dataclass(frozen=True) class Peer: public_key: str; address: str`;
    - `class InvalidDesired(ValueError)`;
    - `validate_desired(item: dict) -> tuple[int, list[Peer]]`, which returns `(version, peers)` and ignores `name`, `settings` and the other fields.
  - `wg.py`:
    - `@dataclass(frozen=True) class Stats: latest_handshake: int; rx_bytes: int; tx_bytes: int`;
    - `parse_dump(text: str) -> tuple[str, dict[str, tuple[str, Stats]]]`, returning `(server_public_key, {public_key: (allowed_ips, stats)})` from `wg show wg0 dump`;
    - `plan_changes(current: dict[str, str], desired: list[Peer]) -> list[list[str]]`, which returns argv lists such as `["wg", "set", "wg0", "peer", key, "allowed-ips", "10.66.66.2/32"]` and `["wg", "set", "wg0", "peer", key, "remove"]`. Removals come first, then additions and changes, and a peer whose allowed-ips already match is left alone.

- [ ] **Step 1: Write the failing tests**

  `test_peers.py`:
  - `test_accepts_valid_desired`
  - `test_missing_item_is_version_0_no_peers`
  - `test_refuses_injection_and_route_widening`: parametrize with
    - a key plus `"\nPostUp = id"`;
    - a key of 43 characters;
    - `address` set to `"10.66.66.2/32, 0.0.0.0/0"`, `"10.66.66.1"`, `"10.66.66.255"`, `"10.66.67.2"` and `"10.66.66.02"`.

    Each raises `InvalidDesired`.
  - `test_refuses_duplicate_key_and_address`
  - `test_refuses_too_many_peers`: 254 peers raises.

  `test_wg.py`:
  - `test_parse_dump`: a fixture with a first line `<priv>\t<pub>\t51820\toff` and two peer lines `<pub>\t(none)\t1.2.3.4:5555\t10.66.66.2/32\t1732790000\t1024\t2048\t25`. It returns the server public key, and never the private key: assert that no returned value equals `<priv>`.
  - `test_plan_changes_adds_removes_and_changes`
  - `test_plan_changes_restores_all_after_reboot`: with `current = {}` and two desired peers, it returns two `allowed-ips` commands.
  - `test_plan_changes_noop_when_equal`, which returns `[]`.

- [ ] **Step 2: Run the tests and check that they fail**

  Run `cd infra/vpn/agent && python -m venv .venv && .venv/Scripts/python -m pip install --require-hashes -r requirements-dev.txt && .venv/Scripts/python -m pytest -q`. Use `.venv/bin/python` on Linux and macOS. Expected: FAIL (ImportError).

- [ ] **Step 3: Implement `peers.py` and `wg.py`**

  - Parse addresses with `ipaddress.IPv4Address` and compare them against `IPv4Network("10.66.66.0/24")`. Also require `str(addr) == raw`, which refuses leading zeros.
  - Check keys with `base64.b64decode(s, validate=True)`, then the length.

- [ ] **Step 4: Run the tests again and check that they pass**

  Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Add the CI step, the Dependabot entries and `.gitignore`**

  - `deploy.yml`, inside the `test` job, after `Run Lambda tests`:
    - add `Install VPN agent test dependencies` (`working-directory: infra/vpn/agent`, `pip install --require-hashes -r requirements-dev.txt`);
    - add `Run VPN agent tests` (`id: vpn_agent_pytest`, using the same `EXIT_CODE` pattern as the `pytest` step);
    - add `steps.vpn_agent_pytest.outputs.exit_code != '0' ||` to the final failure check, next to `steps.pytest.outputs.exit_code != '0'`.
  - `.github/dependabot.yml`:
    - a `pip` entry for `directory: /infra/vpn/agent`, a copy of the `/lambda` entry's settings;
    - `/infra/vpn` added to the Terraform `directories`.
  - `.gitignore`: `infra/vpn/agent/.venv/`.

- [ ] **Step 6: File the issue, branch and commit**

  Issue title "feat(infra): WireGuard VM on Oracle Cloud and its vpn-agent". Make it a sub-issue of #591. Branch `feat/<N>-vpn-vm`. Phase 3 is one PR.

  Commit as `feat(vpn): add vpn-agent peer validation and wg diffing (#N)`.

---

### Task 2: The agent's loop and report

**Files:**
- Create: `infra/vpn/agent/vpn_agent/report.py`
- Create: `infra/vpn/agent/vpn_agent/main.py`
- Test: `infra/vpn/agent/tests/test_report.py`
- Test: `infra/vpn/agent/tests/test_main.py`

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  - `report.server_item(*, server_public_key: str, endpoint: str, applied_version: int, now: int, cert_not_after: int, error: str | None, stats: dict[str, Stats]) -> dict`, in Phase 2's `server` shape with `pk = "server"`.
  - `main.Agent(table, run: Callable[[list[str]], str], clock: Callable[[], int], endpoint: str, cert_not_after: int)`, with:
    - `tick_poll() -> None`: get `desired`, validate, diff against `parse_dump(run(["wg","show","wg0","dump"]))`, run the commands, then write `server`;
    - `tick_report() -> None`;
    - `run_forever() -> None`: poll every 30 seconds, report every 60.
  - `main.cert_not_after(path: str) -> int`, from `openssl x509 -enddate -noout -in <path>`.
  - `main.public_ip() -> str`, a GET to `https://checkip.amazonaws.com` with a 10-second timeout.
  - The entry point is `python -m vpn_agent.main`.

- [ ] **Step 1: Write the failing tests**

  The tests use a fake table: an object with `get_item(Key=...)` and `put_item(Item=...)` that records calls. `run` is a fake returning fixture dumps.
  - `test_report_includes_cert_not_after`
  - `test_report_never_contains_private_key`: the dump's private key is not in `json.dumps(item)`.
  - `test_tick_applies_new_version_then_reports_applied_version`
  - `test_tick_reapplies_after_reboot_even_if_version_unchanged`
  - `test_tick_keeps_peers_when_get_item_fails`: `get_item` raises `botocore.exceptions.EndpointConnectionError`, so no `wg set ... remove` runs and nothing is raised.
  - `test_tick_reports_invalid_desired_and_keeps_last_good`: `server.error` starts with `"invalid desired:"`, and no `wg` command runs.

- [ ] **Step 2: Run the tests and check that they fail**

  Run `.venv/Scripts/python -m pytest -q`. Expected: FAIL.

- [ ] **Step 3: Implement `report.py` and `main.py`**

  - `main()` builds `boto3.resource("dynamodb", region_name="us-east-1").Table("bgm-looper-vpn")`. Credentials come from the `credential_process` profile in `AWS_CONFIG_FILE`, which the systemd unit sets (Task 3).
  - Log with `logging` to stdout, which goes to journald. Never log a key other than public keys.

- [ ] **Step 4: Run the tests again and check that they pass**

  Run `.venv/Scripts/python -m pytest -q`. Expected: PASS.

- [ ] **Step 5: Commit**

  `feat(vpn): add the vpn-agent loop and server report (#N)`

---

### Task 3: Cloud-init

**Files:**
- Create: `infra/vpn/cloud-init.yaml.tftpl`

**Interfaces:**
- Consumes these template variables:
  - `agent_files`, a map from relative path to file content, covering every file under `infra/vpn/agent/vpn_agent/` plus `requirements.txt`;
  - `trust_anchor_arn`, `profile_arn` and `role_arn`;
  - `signing_helper_url` and `signing_helper_sha256`.
- Produces this layout on the VM:
  - `/opt/vpn-agent/` (the code, with a venv at `/opt/vpn-agent/venv`);
  - `/etc/vpn-agent/aws-config`;
  - `/etc/systemd/system/vpn-agent.service`;
  - `/var/lib/vpn-agent/{key.pem,csr.pem}`;
  - `/etc/wireguard/{server.key,wg0.conf}`.

- [ ] **Step 1: Write the template**

  **`write_files`:**
  - The agent files, each `encoding: gz+b64`, rendered from `agent_files` with `base64gzip`.
  - `/etc/wireguard/wg0.conf` with `[Interface]`, `Address = 10.66.66.1/24`, `ListenPort = 51820`, and `PostUp = wg set %i private-key /etc/wireguard/server.key`. No `[Peer]` sections.
  - `/etc/vpn-agent/aws-config`:

    ```
    [default]
    region = us-east-1
    credential_process = /usr/local/bin/aws_signing_helper credential-process \
      --certificate /var/lib/vpn-agent/cert.pem \
      --private-key /var/lib/vpn-agent/key.pem \
      --trust-anchor-arn ${trust_anchor_arn} \
      --profile-arn ${profile_arn} \
      --role-arn ${role_arn}
    ```

    Put the `credential_process` value on one line in the real file.
  - `/etc/sysctl.d/90-wireguard.conf` with `net.ipv4.ip_forward = 1`.
  - `/etc/dnf/automatic.conf` overrides: `upgrade_type = security` and `apply_updates = yes`.
  - `vpn-agent.service`:
    - `User=vpn-agent`, `AmbientCapabilities=CAP_NET_ADMIN`, `CapabilityBoundingSet=CAP_NET_ADMIN`;
    - `Environment=AWS_CONFIG_FILE=/etc/vpn-agent/aws-config`;
    - `ConditionPathExists=/var/lib/vpn-agent/cert.pem`;
    - `After=wg-quick@wg0.service`, `Requires=wg-quick@wg0.service`;
    - `ExecStart=/opt/vpn-agent/venv/bin/python -m vpn_agent.main`, `WorkingDirectory=/opt/vpn-agent`, `Restart=always`, `RestartSec=10`;
    - `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/vpn-agent`.
  - A `needs-restart.timer` and `needs-restart.service` pair: weekly, running `needs-restarting -r || systemctl reboot`.

  **`runcmd`, in order:**
  1. `dnf install -y wireguard-tools python3.12 dnf-automatic openssl`.
  2. Download the signing helper to `/usr/local/bin/aws_signing_helper`, check it with `sha256sum -c`, then `chmod 755`. Stop on a mismatch.
  3. `useradd --system --home /var/lib/vpn-agent --shell /sbin/nologin vpn-agent`.
  4. `umask 077 && wg genkey > /etc/wireguard/server.key`. Never echo it.
  5. `python3.12 -m venv /opt/vpn-agent/venv && /opt/vpn-agent/venv/bin/pip install --require-hashes -r /opt/vpn-agent/requirements.txt`.
  6. As `vpn-agent`:
     - `openssl ecparam -name prime256v1 -genkey -noout -out /var/lib/vpn-agent/key.pem`;
     - `openssl req -new -key /var/lib/vpn-agent/key.pem -subj /CN=vpn-vm -out /var/lib/vpn-agent/csr.pem`.
  7. `sysctl --system`.
  8. firewalld:
     - `firewall-cmd --permanent --zone=public --remove-service=ssh`;
     - `--add-port=51820/udp`, `--add-masquerade`;
     - `--add-rich-rule='rule family=ipv4 source address=10.0.0.0/24 service name=ssh accept'`;
     - `firewall-cmd --permanent --new-zone=wg`, `--zone=wg --add-interface=wg0`, `--zone=wg --add-rich-rule='rule family=ipv4 source address=10.66.66.0/24 service name=ssh accept'`;
     - a policy `wg-out` with `--add-ingress-zone=wg --add-egress-zone=public --set-target=ACCEPT`, then `firewall-cmd --reload`.

     Traffic from `wg` back into `wg` isn't allowed by any policy, so clients can't reach each other.
  9. `systemctl enable --now wg-quick@wg0 dnf-automatic.timer needs-restart.timer`, and `systemctl enable vpn-agent`. It starts once `cert.pem` exists.

- [ ] **Step 2: Pin the signing helper**

  Find the current IAM Roles Anywhere credential helper release for Linux arm64 on AWS's "Get temporary security credentials" docs page. Put its URL and SHA-256 in `infra/vpn/locals.tf` (Task 4) as `local.signing_helper`, and note the version in a comment. If AWS publishes no arm64 build, stop and report; don't build one from source silently.

- [ ] **Step 3: Commit**

  `feat(vpn): add the VM's cloud-init (#N)`

  The size check runs in Task 4, once `templatefile` can render the template.

---

### Task 4: The `infra/vpn/` Terraform stack

**Files:**
- Create: `infra/vpn/versions.tf` (`required_version = ">= 1.10.0"`, `oracle/oci ~> 9.15`, the S3 backend from Global Constraints)
- Create: `infra/vpn/providers.tf` (`provider "oci" { auth = "SecurityToken"; config_file_profile = var.oci_profile; region = var.region }`)
- Create: `infra/vpn/variables.tf`:
  - `compartment_id`, `availability_domain`, `ssh_public_key` and `bastion_client_cidr`, all strings with no default;
  - `region`, defaulting to `"us-sanjose-1"`;
  - `oci_profile`, defaulting to `"personal-oci"`.
- Create: `infra/vpn/state.tf` (`data "terraform_remote_state" "prod_account"`: S3 backend, bucket `bgm-looper-tf-state-223376380711`, key `shared/terraform.tfstate`, region `us-east-1`)
- Create: `infra/vpn/locals.tf` (`signing_helper`; `agent_files`, from `fileset("${path.module}/agent", "{vpn_agent/*.py,requirements.txt}")`; `user_data`)
- Create: `infra/vpn/network.tf`, `infra/vpn/instance.tf`, `infra/vpn/bastion.tf` and `infra/vpn/outputs.tf`. The outputs are `public_ip`, `private_ip`, `instance_id` and `bastion_id`.
- Create: `infra/vpn/terraform.tfvars.example`
- Create: `infra/vpn/.terraform.lock.hcl` (committed; `terraform init` makes it)
- Modify: `.github/workflows/terraform.yml` (add `"!infra/vpn/**"` after `"infra/**"` in both `paths` lists)

**Interfaces:**
- Consumes: `prod_account` outputs `vpn_trust_anchor_arn`, `vpn_profile_arn` and `vpn_role_arn` (Phase 1); `cloud-init.yaml.tftpl` (Task 3).

- [ ] **Step 1: Write the stack**

  Use the values in Global Constraints. The image is `data "oci_core_images" "ol9"`:
  - `compartment_id = var.compartment_id`, `operating_system = "Oracle Linux"`, `operating_system_version = "9"`, `shape = "VM.Standard.A1.Flex"`;
  - `sort_by = "TIMECREATED"`, `sort_order = "DESC"`;
  - the instance takes `.images[0].id`.

  Pass `metadata = { ssh_authorized_keys = var.ssh_public_key, user_data = base64encode(local.user_data) }`.

  Add a `check "user_data_size"` block asserting `length(base64encode(local.user_data)) <= 32000`.

- [ ] **Step 2: Format and lint**

  Run `terraform fmt -check -recursive infra/` and `tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"`. Expected: no output.

- [ ] **Step 3: Owner sign-in, then init and validate**

  This is an owner action; ask first:

  ```bash
  aws sso login --profile personal
  oci session authenticate --region us-sanjose-1 --profile-name personal-oci
  ```

  Then:

  ```bash
  export AWS_PROFILE=personal OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING=True
  cp infra/vpn/terraform.tfvars.example infra/vpn/terraform.tfvars
  # fill in: compartment_id from aws-org (terraform -chdir=oci output -raw vpn_compartment_id)
  # availability_domain from `oci iam availability-domain list ... --query 'data[].name'`
  # a new SSH public key
  # bastion_client_cidr = the owner's current public IP /32
  terraform -chdir=infra/vpn init && terraform -chdir=infra/vpn validate
  ```

  Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Plan**

  Run `terraform -chdir=infra/vpn plan -var-file=terraform.tfvars -out=vpn.tfplan`. Expected:
  - 7 to add: the VCN, subnet, internet gateway, route table, security list, instance and Bastion;
  - 0 to change and 0 to destroy;
  - every `compartment_id` equal to `vpn`'s OCID;
  - the `user_data_size` check passing.

  Paste the plan text into the PR. It holds no secret: `user_data` shows as base64 of public data.

- [ ] **Step 5: Apply**

  This is an owner action; ask first. Run `terraform -chdir=infra/vpn apply vpn.tfplan`.

  If it fails with `Out of host capacity`, retry later. Don't change the shape, since the quota guard allows only A1 and E2.1.Micro, and E2 had no capacity on 2026-11-28.

- [ ] **Step 6: Check that a second plan changes nothing**

  Run `terraform -chdir=infra/vpn plan -var-file=terraform.tfvars`. Expected: `No changes.`

- [ ] **Step 7: Check that only WireGuard is open**

  From outside, on the owner's machine:
  - `nc -vz -w 5 <public_ip> 22` times out or is refused;
  - `nmap -sU -p 51820 <public_ip>` shows `open|filtered`.

- [ ] **Step 8: Commit and open the PR**

  Commit everything except `terraform.tfvars` and `vpn.tfplan`, and check them with `git status --short`. Add `infra/vpn/vpn.tfplan` and `infra/vpn/.terraform/` to `.gitignore` if the root rules don't cover them. `*.tfvars` already is.

  Commit as `feat(vpn): add the Oracle Cloud stack for the WireGuard VM (#N)`.

---

### Task 5: Bootstrap the certificate, and the runbook

**Files:**
- Create: `infra/vpn/scripts/sign-vm-cert.sh`
- Create: `infra/vpn/scripts/test-sign-vm-cert.sh`
- Create: `infra/vpn/scripts/deploy-agent.sh`
- Create: `docs/runbooks/vpn.md`
- Modify: `docs/runbooks/README.md` (add a row)

**Interfaces:**
- Produces:
  - `sign-vm-cert.sh <ca.key> <ca.pem> <csr.pem> <out cert.pem>`. It refuses a CSR whose subject isn't exactly `CN = vpn-vm`, and signs for 365 days with `keyUsage=critical,digitalSignature` and `extendedKeyUsage=clientAuth`.
  - `deploy-agent.sh <ssh-target>`. It copies `infra/vpn/agent/vpn_agent/` and `requirements.txt` to `/opt/vpn-agent/`, reinstalls the venv with `--require-hashes`, and restarts `vpn-agent`.

- [ ] **Step 1: Write the failing test `test-sign-vm-cert.sh`**

  It makes a throwaway CA with `make-ca.sh` in a temporary directory, then:
  - a CSR for `CN=vpn-vm` gives a cert that `openssl verify -CAfile ca.pem` accepts, with about 365 days left and `TLS Web Client Authentication`;
  - a CSR for `CN=evil` makes the script exit 1 and write no output file.

- [ ] **Step 2: Run it and check that it fails**

  Run `bash infra/vpn/scripts/test-sign-vm-cert.sh`. Expected: FAIL.

- [ ] **Step 3: Implement both scripts**

- [ ] **Step 4: Run the test again and check that it passes**

  Run `bash infra/vpn/scripts/test-sign-vm-cert.sh`. Expected: `ok`.

- [ ] **Step 5: Write `docs/runbooks/vpn.md`**

  Write plain steps with exact commands for:
  - signing in to both clouds;
  - opening a Bastion port-forwarding session:

    ```
    oci bastion session create-port-forwarding --bastion-id <bastion_id> \
      --target-private-ip <private_ip> --target-port 22 \
      --ssh-public-key-file <key.pub> --session-ttl 10800 \
      --profile personal-oci --auth security_token
    ```

    then the `ssh -N -L 2222:<private_ip>:22 <session-ocid>@host.bastion.us-sanjose-1.oci.oraclecloud.com` tunnel, and `ssh -p 2222 opc@localhost`;
  - first certificate: `scp` the CSR off, `sign-vm-cert.sh`, `scp` the cert to `/var/lib/vpn-agent/cert.pem` (owner `vpn-agent`, mode 0644), `systemctl start vpn-agent`, and `journalctl -u vpn-agent -n 20`;
  - SSH over the tunnel afterwards (`ssh opc@10.66.66.1`);
  - yearly certificate rotation, from a new CSR made on the VM;
  - updating the agent with `deploy-agent.sh`;
  - a deliberate rebuild (`terraform apply -replace=oci_core_instance.vpn`), and that it means re-issuing every device and re-signing the certificate;
  - revoking: disable the trust anchor in `prod/account`;
  - what to do with a reclamation email.

- [ ] **Step 6: Bootstrap**

  This is an owner action, following the runbook. Done when:
  - `journalctl -u vpn-agent` shows a report written;
  - production's `/tools/vpn` shows the server online, with endpoint `<public_ip>:51820`.

- [ ] **Step 7: Commit**

  `feat(vpn): add the certificate signing and agent deploy scripts and the VPN runbook (#N)`

---

### Task 6: End-to-end check and docs (the spec's Phase 4)

**Files:**
- Modify: `README.md` (one line for the VPN tool, and its environment note: production only has a VM)
- Modify: `ARCHITECTURE.md` (a VPN section, the spec's diagram, and cost table rows: Oracle A1, boot volume, VCN, Bastion $0; DynamoDB provisioned 2/2 per environment, Roles Anywhere $0; total $0 / ₹0)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Connect a phone and a laptop**

  This is an owner action. On production's `/tools/vpn`, add "phone" and scan its QR in the WireGuard app. Add "laptop", download its `.conf` and import it with "Import tunnel(s) from file".

  Expected on both:
  - `https://ifconfig.co/json` shows `"city": "San Jose"` (or the Oracle San Jose ASN);
  - `https://dnsleaktest.com` (extended test) lists only Cloudflare resolvers;
  - the dashboard shows a recent handshake and growing bytes for each.

- [ ] **Step 2: Check split tunnel and re-issue on one device**

  Switch to Split with `10.0.0.0/8`, re-issue "laptop" and re-import it. Then:
  - `ifconfig.co` shows the home ISP;
  - DNS still goes through the tunnel: the leak test shows Cloudflare;
  - the old key's tunnel no longer handshakes.

  Switch back to Full and re-issue again.

- [ ] **Step 3: Check that no secret leaked**

  ```bash
  git grep -nE "PRIVATE KEY|PrivateKey = [A-Za-z0-9+/]{43}=" -- . ':!*.md'
  terraform -chdir=infra/vpn state pull | grep -c "PRIVATE KEY"
  ```

  Expected: no matches, and `0`. GitHub secret scanning shows no new alert.

- [ ] **Step 4: Write the docs, commit and open the PR**

  Commit as `docs(vpn): add the VPN to README and ARCHITECTURE (#N)`. This can share Task 5's PR or be a follow-up docs PR with its own issue.

- [ ] **Step 5: Check the bill after the first full month**

  This is an owner action, around 2027-01-02. The Oracle console's Cost Analysis for December 2026 shows 0.00, no budget alert email arrived, and no reclamation email arrived. Then tick #591's last acceptance box and close the epic.
