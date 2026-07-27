output "audio_bucket_name" {
  value = aws_s3_bucket.audio.bucket
}

output "ecr_repository_url" {
  value = aws_ecr_repository.looper.repository_url
}
