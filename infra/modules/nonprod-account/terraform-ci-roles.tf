# --- Terraform in CI (.github/workflows/terraform.yml), assumed through the role
#     .github/scripts/tf-stacks.sh names for this account's stacks. ---

data "aws_iam_policy_document" "tf_trust" {
  for_each = {
    # PRs and the weekly drift run, which runs from dev for every stack — so dev's ref,
    # not this environment's, in stage too.
    plan = ["${var.github_sub_prefix}:pull_request", "${var.github_sub_prefix}:ref:refs/heads/dev"]
    # Only this environment's branch applies its stacks.
    apply = ["${var.github_sub_prefix}:ref:refs/heads/${var.env}"]
  }

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = each.value
    }
  }
}

# PR plans and the weekly drift plan. Plans run with -lock=false, so read-only is
# enough. ReadOnlyAccess includes the state files, which hold secrets in plain text —
# the same people can read the repository secrets, so this adds no exposure. Fork PRs
# get no OIDC token while the repo's "send secrets to fork PRs" setting stays off.
resource "aws_iam_role" "tf_plan" {
  name               = "${var.project_name}-tf-plan"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["plan"].json
}

resource "aws_iam_role_policy_attachment" "tf_plan_readonly" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess has no verifiedpermissions:ListTagsForResource, which the provider
# calls on every refresh of the policy store (#359).
data "aws_iam_policy_document" "tf_plan" {
  statement {
    sid       = "VerifiedPermissionsReads"
    actions   = ["verifiedpermissions:Get*", "verifiedpermissions:List*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "tf_plan" {
  name   = "${var.project_name}-tf-plan"
  role   = aws_iam_role.tf_plan.id
  policy = data.aws_iam_policy_document.tf_plan.json
}

# This environment's stacks on pushes to its branch. AdministratorAccess, unlike prod's
# name-scoped apply roles: the account is the blast radius (spec §3). It holds only this
# environment, trusts nothing outside itself, and the organization's deny-IAM-users SCP
# still applies. The workflow's destroy guard (confirm `apply-destroys`) still stops a
# plan that deletes or replaces anything. A narrower policy would only be a list to keep
# in step with every new resource, guarding nothing the account boundary doesn't.
resource "aws_iam_role" "tf_apply" {
  name               = "${var.project_name}-tf-apply"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["apply"].json
}

resource "aws_iam_role_policy_attachment" "tf_apply_admin" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
