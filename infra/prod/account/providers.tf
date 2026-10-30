provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  # The personal AWS organization's per-app budget filters on this tag (#396).
  default_tags {
    tags = { app = "bgm-looper" }
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
}

data "aws_caller_identity" "current" {}
