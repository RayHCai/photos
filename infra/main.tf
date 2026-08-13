terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state, encrypted and locked.
  #
  # There was no backend block, so state lived in a local terraform.tfstate: the IAM
  # secret key sat in plaintext on one machine, with no encryption, no locking (two
  # concurrent applies could corrupt it) and no version history to recover from.
  #
  # Configure with `terraform init -backend-config=backend.hcl` so the bucket name is
  # not committed. See infra/backend.hcl.example.
  backend "s3" {
    key          = "photos-platform/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.tags
  }
}

# -----------------------------------------------------------------------------
# S3 bucket – stores originals and generated thumbnails
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "photos" {
  bucket = var.bucket_name

  # This bucket holds the only copy of the user's photos. A rename, a region change,
  # or an accidental `terraform destroy` would otherwise delete all of them.
  lifecycle {
    prevent_destroy = true
  }
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
    # Content-Length powers download progress; Content-Disposition lets the
    # browser recover the original filename when downloading via fetch+blob.
    expose_headers  = ["ETag", "Content-Length", "Content-Disposition"]
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

  # Versioning is enabled, and the only rule used to be the one above — so a
  # "deleted" photo was retained forever: still billed, and still restorable by
  # anyone with bucket access. A user deleting 20 GB for privacy or to reclaim space
  # saw neither happen. The window is long enough to recover from an accidental
  # delete and short enough that deletion eventually means deletion.
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
  }

  rule {
    id     = "expire-delete-markers"
    status = "Enabled"
    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

# -----------------------------------------------------------------------------
# Access logging
# -----------------------------------------------------------------------------
# The CDN serves derived image variants with no signed URLs, so a leaked URL is
# indefinitely reusable. Without logs there was zero audit trail for who had ever
# fetched a photo.
resource "aws_s3_bucket" "logs" {
  bucket = "${var.bucket_name}-logs"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudFront's standard logging writes via ACL, which requires ownership to permit it.
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}

    expiration {
      days = var.log_retention_days
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

# Inject long-lived immutable caching on every CDN response. Object keys are
# content-addressed UUIDs, so the bytes behind a key never change. override=true
# so it applies even to objects uploaded without a Cache-Control header.
resource "aws_cloudfront_response_headers_policy" "immutable_images" {
  name = "photos-platform-immutable-images"

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = true
    }
  }

  # The grid requests thumbnails with crossorigin="anonymous" so the service worker can
  # read the response status. Without CORS headers here that request fails the CORS check
  # and the image does not render at all -- this block and the img attribute ship together.
  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      items = var.cors_origins
    }

    access_control_max_age_sec = 3600
    origin_override            = true
  }
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
    # Origin is part of the cache key so the CORS-headed response is not served to a
    # request that sent no Origin, and vice versa. The allowlist is small, so the
    # resulting fan-out is a couple of variants per object.
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Origin"]
      }
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
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-photos-platform"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.thumbnails.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.immutable_images.id

    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.no_store_errors.arn
    }
  }

  # A thumbnail requested before the worker (or a backfill) has written it 404s, and S3
  # behind OAC answers a missing key with 403. Cache that for the default TTL and the
  # object appearing moments later goes unnoticed. Keep the negative window to seconds.
  custom_error_response {
    error_code            = 403
    error_caching_min_ttl = 5
  }

  custom_error_response {
    error_code            = 404
    error_caching_min_ttl = 5
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

  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

# The immutable_images policy sets Cache-Control with override=true, which applies to
# *every* response CloudFront returns -- including the 403/404 for an object that has not
# been generated yet. That stamped a one-year immutable lifetime on "this thumbnail does
# not exist", which browsers honoured long after the backfill created it.
#
# custom_error_response above bounds CloudFront's own caching; this bounds the viewer's.
# Viewer-response functions run after the response headers policy, so this wins.
resource "aws_cloudfront_function" "no_store_errors" {
  name    = "photos-platform-no-store-errors"
  runtime = "cloudfront-js-2.0"
  comment = "Keep error responses out of viewer caches"
  code    = <<-EOF
    function handler(event) {
      var response = event.response;
      if (Number(response.statusCode) >= 400) {
        response.headers['cache-control'] = { value: 'no-store' };
      }
      return response;
    }
  EOF
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
