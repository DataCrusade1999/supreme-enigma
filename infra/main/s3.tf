resource "aws_s3_bucket" "audio" {
  bucket = "${var.project_name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-1-day"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

# dev/stage get their own buckets so a branch's uploads never touch production's.
# main keeps the original aws_s3_bucket.audio above, unrenamed, to avoid a bucket replacement.
resource "aws_s3_bucket" "audio_env" {
  for_each = toset(["dev", "stage"])
  bucket   = "${var.project_name}-audio-${each.key}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio_env" {
  for_each                = aws_s3_bucket.audio_env
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  rule {
    id     = "expire-1-day"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}
