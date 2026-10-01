terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "bgm-looper-tf-state-223376380711"
    key          = "envs/dev/terraform.tfstate"
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
  }
}
