terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "bgm-looper-tf-state-223376380711"
    key          = "main/terraform.tfstate"
    region       = "us-east-1"
    profile      = "personal"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}
