terraform {
  required_version = ">= 1.10.0"

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
