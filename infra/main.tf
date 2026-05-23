terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# -----------------------------------------------------------------------------
# S3 bucket – stores originals and generated thumbnails
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "photos" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "photos" {
  bucket = aws_s3_bucket.photos.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket = aws_s3_bucket.photos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT"]
    allowed_origins = var.cors_origins
    expose_headers  = ["ETag", "Content-Length"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# -----------------------------------------------------------------------------
# CloudFront CDN – serves thumbnails and crops from edge cache
# -----------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "photos-platform-s3-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "thumbnails" {
  name        = "photos-platform-thumbnails"
  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year
  min_ttl     = 3600     # 1 hour

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "thumbnails" {
  enabled             = true
  comment             = "photos-platform thumbnails CDN"
  default_root_object = ""
  price_class         = "PriceClass_100" # US, Canada, Europe only (cheapest)

  origin {
    domain_name              = aws_s3_bucket.photos.bucket_regional_domain_name
    origin_id                = "s3-photos-platform"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
    origin_path              = ""
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-photos-platform"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.thumbnails.id
  }

  # Block access to originals/ via CloudFront
  ordered_cache_behavior {
    path_pattern           = "originals/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-photos-platform"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = aws_cloudfront_cache_policy.thumbnails.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.block_originals.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# CloudFront Function to block access to originals/
resource "aws_cloudfront_function" "block_originals" {
  name    = "photos-platform-block-originals"
  runtime = "cloudfront-js-2.0"
  code    = <<-EOF
    function handler(event) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden',
        body: { encoding: 'text', value: 'Access denied' }
      };
    }
  EOF
}

# S3 bucket policy – grant CloudFront read access to thumbnails/ and crops/ only
resource "aws_s3_bucket_policy" "cloudfront_access" {
  bucket = aws_s3_bucket.photos.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource = [
          "${aws_s3_bucket.photos.arn}/thumbnails/*",
          "${aws_s3_bucket.photos.arn}/crops/*",
          "${aws_s3_bucket.photos.arn}/web/*"
        ]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.thumbnails.arn
          }
        }
      }
    ]
  })
}
