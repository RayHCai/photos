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
  description = "Allowed CORS origins for presigned URL uploads from the frontend"
  type        = list(string)
  default     = ["http://localhost:3000", "https://rays-photos.vercel.app"]
}
