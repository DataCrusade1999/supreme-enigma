provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "vercel" {
  api_token = var.vercel_api_token
}

data "aws_caller_identity" "current" {}
