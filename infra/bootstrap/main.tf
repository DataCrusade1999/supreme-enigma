terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.62"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile Terraform authenticates with (local runs only)."
  type        = string
  default     = "personal"
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tf_state" {
  bucket = "bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State holds the Vercel token, the OpenRouter key and the Google client secret in
# plain text. Without this, anything with S3 read in the account could read it: the
# -ro profiles, the AWS DevOps Agent's roles, ReadOnlyAccess generally. Only the
# Terraform roles and the Identity Center admin role (local break-glass) may read
# objects, old versions included (#568). Root can always remove a bucket policy, so
# this can't lock the account out of its state.
#
# The bucket is named, not referenced: this stack has no persisted state, so a
# reference would make `-target=aws_s3_bucket_policy.tf_state` try to recreate the
# bucket. Apply with that -target, once per workspace (default, dev, stage).
resource "aws_s3_bucket_policy" "tf_state" {
  bucket = "bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "OnlyTerraformReadsState"
      Effect    = "Deny"
      Principal = "*"
      Action    = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource  = "arn:aws:s3:::bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}/*"
      Condition = {
        ArnNotLike = {
          "aws:PrincipalArn" = [
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/bgm-looper-tf-plan",
            # Production's apply role is bgm-looper-tf-apply-prod; dev's and stage's are bgm-looper-tf-apply.
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${terraform.workspace == "default" ? "bgm-looper-tf-apply-prod" : "bgm-looper-tf-apply"}",
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_AdministratorAccess_*",
          ]
        }
      }
    }]
  })
}

# Account-wide backstop, so a future bucket cannot be created publicly accessible
# by accident. It lives here rather than in infra/prod/account deliberately: `terraform
# destroy` of every infra/<env>/* stack is the documented kill switch, and an
# account-wide guardrail must outlive it — otherwise tearing the app down would also remove the
# protection for every bucket added afterwards. Per-bucket blocks already cover
# every bucket that exists today, so this is a guard against future mistakes.
resource "aws_s3_account_public_access_block" "account" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket_name" {
  value = aws_s3_bucket.tf_state.bucket
}
