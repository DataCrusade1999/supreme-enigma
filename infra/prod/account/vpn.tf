# AWS credentials for the VPN VM on Oracle Cloud, through IAM Roles Anywhere
# (docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md §1).
#
# vpn-ca.pem is the public CA certificate; the CA key stays offline (infra/vpn/scripts/make-ca.sh).
# The table ARN below is a literal because prod/account applies before prod/app (#524).

resource "aws_rolesanywhere_trust_anchor" "vpn" {
  name    = "${var.project_name}-vpn"
  enabled = true

  source {
    source_type = "CERTIFICATE_BUNDLE"
    source_data {
      x509_certificate_data = file("${path.module}/vpn-ca.pem")
    }
  }
}

data "aws_iam_policy_document" "vpn_agent_trust" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"]

    principals {
      type        = "Service"
      identifiers = ["rolesanywhere.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_rolesanywhere_trust_anchor.vpn.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/x509Subject/CN"
      values   = ["vpn-vm"]
    }
  }
}

resource "aws_iam_role" "vpn_agent" {
  name               = "${var.project_name}-vpn-agent"
  assume_role_policy = data.aws_iam_policy_document.vpn_agent_trust.json
}

data "aws_iam_policy_document" "vpn_agent" {
  statement {
    sid       = "ReadDesiredState"
    actions   = ["dynamodb:GetItem"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-vpn"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["desired"]
    }
  }

  statement {
    sid       = "WriteServerState"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-vpn"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["server"]
    }
  }
}

resource "aws_iam_role_policy" "vpn_agent" {
  name   = "${var.project_name}-vpn-agent"
  role   = aws_iam_role.vpn_agent.id
  policy = data.aws_iam_policy_document.vpn_agent.json
}

resource "aws_rolesanywhere_profile" "vpn" {
  name             = "${var.project_name}-vpn"
  role_arns        = [aws_iam_role.vpn_agent.arn]
  duration_seconds = 3600
  enabled          = true
}
