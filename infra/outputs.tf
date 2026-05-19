output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.photos.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.photos.arn
}

output "iam_access_key_id" {
  description = "IAM access key ID for the app user (set as AWS_ACCESS_KEY_ID)"
  value       = aws_iam_access_key.app.id
}

output "iam_secret_access_key" {
  description = "IAM secret access key for the app user (set as AWS_SECRET_ACCESS_KEY)"
  value       = aws_iam_access_key.app.secret
  sensitive   = true
}
