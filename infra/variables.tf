variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Name of the S3 bucket for photo/video storage"
  type        = string
  default     = "photos-platform"
}

variable "cors_origins" {
  description = <<-EOT
    Allowed CORS origins for direct browser uploads to S3. Required, with no default:
    the previous default hard-coded a real production hostname into the repository, and
    a wrong value here either breaks uploads or widens who may PUT to the bucket.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.cors_origins) > 0
    error_message = "At least one CORS origin must be specified."
  }

  validation {
    condition     = !contains(var.cors_origins, "*")
    error_message = "A wildcard CORS origin would let any site upload to the bucket."
  }
}

variable "noncurrent_version_retention_days" {
  description = <<-EOT
    How long a superseded or deleted object version is retained before permanent
    deletion. Versioning is on, so without this a deleted photo was kept forever —
    still billed, and still restorable by anyone with bucket access.
  EOT
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "How long CloudFront access logs are kept."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags applied to every resource, for cost attribution and ownership."
  type        = map(string)
  default = {
    Project   = "photos-platform"
    ManagedBy = "terraform"
  }
}
