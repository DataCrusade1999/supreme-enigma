output "audio_bucket_name" {
  value = aws_s3_bucket.audio.bucket
}

output "ecr_repository_url" {
  value = aws_ecr_repository.looper.repository_url
}

output "vercel_access_key_id" {
  value     = aws_iam_access_key.vercel.id
  sensitive = true
}

output "ci_deploy_access_key_id" {
  value     = aws_iam_access_key.ci_deploy.id
  sensitive = true
}

output "ci_deploy_secret_access_key" {
  value     = aws_iam_access_key.ci_deploy.secret
  sensitive = true
}
