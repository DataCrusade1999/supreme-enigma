output "data_bucket_name" {
  value = aws_s3_bucket.data.bucket
}

output "lambda_function_name" {
  value = aws_lambda_function.this.function_name
}

output "vpn_table_arn" {
  value = aws_dynamodb_table.vpn.arn
}
