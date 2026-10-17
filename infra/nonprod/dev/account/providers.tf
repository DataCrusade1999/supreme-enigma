provider "aws" {
  # Control Tower denies every other region.
  region  = "us-east-1"
  profile = var.aws_profile

  # The dev account only. A run with any other credentials (`personal`, the production
  # account, is the repo's default AWS_PROFILE) fails before reading or changing
  # anything, rather than building dev's resources in the wrong account.
  allowed_account_ids = ["624586968135"]

  # The personal AWS organization's per-app budget filters on this tag (#396).
  default_tags {
    tags = { app = "bgm-looper" }
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
}
