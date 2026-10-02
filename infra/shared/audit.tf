# --- CloudTrail (#375) ---

# The account's one trail. Management events are account-wide, so this records every
# API call in 223376380711, not only bgm-looper's. It lives here until an organization
# trail replaces it; then delete the trail and let the bucket's lifecycle empty it.
# Names are locals in ci.tf, where tf_apply_prod is granted them.

resource "aws_s3_bucket" "audit" {
  bucket = local.audit_bucket_name
  # No force_destroy: a `terraform destroy` of this stack stops here while logs remain.
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Expire rather than transition: CloudTrail writes many small files, and Glacier
# classes bill each object as at least 128 KB.
resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}
    expiration { days = 365 }
  }
}

# aws:SourceArn is built from the trail's name, not aws_cloudtrail.audit.arn: the trail
# depends on this policy, so referencing it would be a cycle.
data "aws_iam_policy_document" "audit_bucket" {
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.audit_trail_name}"]
    }
  }
  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.audit_trail_name}"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit_bucket.json
  # The public access block must exist first, or S3 can reject the policy mid-apply.
  depends_on = [aws_s3_bucket_public_access_block.audit]
}

# Management events only (read and write), every region, global services (IAM, STS)
# included. No CloudWatch Logs delivery yet: #166 adds it when it needs a metric filter.
resource "aws_cloudtrail" "audit" {
  name                          = local.audit_trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true

  # CloudTrail checks the bucket policy when the trail is created.
  depends_on = [aws_s3_bucket_policy.audit]
}
