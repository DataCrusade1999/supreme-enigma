# Used by the `terraform` workflow and locally: tflint --chdir=infra --recursive
# --config="$PWD/infra/.tflint.hcl". The aws plugin catches values `validate` cannot
# (an invalid Lambda runtime or instance type, a malformed ARN).
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
