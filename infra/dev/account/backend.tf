terraform {
  required_version = ">= 1.10.0"

  # The dev account's own state bucket, created by infra/bootstrap applied as
  # personal-dev. Nothing in this stack reads production's state.
  backend "s3" {
    bucket       = "bgm-looper-tf-state-624586968135"
    key          = "account/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.62"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.15"
    }
    # Used by modules/auth (the owner user's random_password).
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}
