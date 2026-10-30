# --- S3 ---

# The buckets hold resume data and News Desk snapshots as well as audio, hence
# "data". One for_each over all three branches; main has no suffix.
resource "aws_s3_bucket" "data" {
  bucket = "portfolio-data${local.suffix}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.app_origins[var.env]
    allowed_headers = ["*"]
  }
}

# Prefix-scoped rather than a blanket filter: audio is scratch and expires in a day,
# but resume/current.* must persist indefinitely. Bucket versioning is deliberately NOT
# enabled — with versioning on, these expiration rules would only write delete markers
# and every audio object would linger as a noncurrent version. See the design spec §4.2.
# Only main's bucket holds resume data, but all three get the same rules.
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "expire-audio-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-audio-outputs"
    status = "Enabled"
    filter { prefix = "outputs/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-drafts"
    status = "Enabled"
    filter { prefix = "resume/drafts/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-archive"
    status = "Enabled"
    filter { prefix = "resume/archive/" }
    expiration { days = 365 }
  }

  # There is deliberately NO catch-all rule for keys outside these prefixes,
  # even though the blanket rule this replaced would have expired them. A
  # `filter {}` expiration rule does not yield to the prefix rules — per AWS's
  # own conflict docs, an empty-filter expiration applies to every object in the
  # bucket, including ones a prefix rule already matches. Adding one at any
  # number of days would therefore delete resume/current.* and the News Desk's
  # news-desk/*.json, which are the things this configuration exists to keep.
  # https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-conflicts.html
  #
  # Stray keys are prevented at the IAM layer instead: the app's Vercel role is
  # scoped to these prefixes (aws_iam_role_policy.vercel in vercel.tf, and the resume
  # policy in infra/prod/account/oidc-roles.tf), so it cannot write elsewhere. Verified empty
  # on 2026-09-12 — zero objects outside these prefixes across all three buckets.
  # The remaining writer with bucket-wide access is this environment's Lambda exec
  # role, limited to this bucket; scoping it to uploads/ and outputs/ is the
  # natural follow-up if a stray ever appears.
}
