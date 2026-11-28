# The VPN's state: one item "desired" (the peers the dashboard wants) and one
# item "server" (what the VM reports back). Design:
# docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md §1.
#
# Provisioned 2/2 capacity keeps the table inside DynamoDB's always-free
# allowance. Every environment gets a table, but only production's has a VM
# behind it.

resource "aws_dynamodb_table" "vpn" {
  name           = "${var.project_name}-vpn"
  billing_mode   = "PROVISIONED"
  read_capacity  = 2
  write_capacity = 2
  hash_key       = "pk"

  attribute {
    name = "pk"
    type = "S"
  }
}

resource "vercel_project_environment_variable" "vpn_table_name" {
  project_id = data.vercel_project.looper.id
  key        = "VPN_TABLE_NAME"
  value      = aws_dynamodb_table.vpn.name
  target     = var.vercel_target
  git_branch = var.vercel_git_branch
  sensitive  = false
}
