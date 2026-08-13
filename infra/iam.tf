# -----------------------------------------------------------------------------
# IAM user for the Express API and Python worker to access S3
# -----------------------------------------------------------------------------
# NOTE: a long-lived static access key is a deliberate compromise for a self-hosted
# deployment that may not run on AWS compute. Where the services *do* run on EC2/ECS,
# attach these policies to an instance or task role instead and delete this user: the
# key below cannot be rotated without a redeploy, and it lands in Terraform state in
# plaintext regardless of `sensitive = true` (which only hides it from CLI output).
resource "aws_iam_user" "app" {
  name = "photos-platform-app"
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}

resource "aws_iam_user_policy" "app_s3" {
  name = "photos-platform-s3-access"
  user = aws_iam_user.app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Scoped to the prefixes the application actually uses, rather than
        # `bucket/*`. A leaked key then cannot touch anything else sharing the bucket,
        # and cannot write outside the known object layout.
        Sid    = "ObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = [
          "${aws_s3_bucket.photos.arn}/originals/*",
          "${aws_s3_bucket.photos.arn}/thumbnails/*",
          "${aws_s3_bucket.photos.arn}/web/*",
          "${aws_s3_bucket.photos.arn}/streaming/*",
          "${aws_s3_bucket.photos.arn}/crops/*",
        ]
      },
      {
        # Multipart uploads need the parts APIs, which are object-level actions.
        Sid    = "MultipartUpload"
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = ["${aws_s3_bucket.photos.arn}/originals/*"]
      },
      {
        # Required for the HeadObject existence checks; constrained to the same
        # prefixes.
        Sid      = "BucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
        Resource = aws_s3_bucket.photos.arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "originals/*",
              "thumbnails/*",
              "web/*",
              "streaming/*",
              "crops/*",
            ]
          }
        }
      },
      {
        # Deleting a photo must also purge the CDN, or the edge keeps serving bytes the
        # user believes are gone.
        Sid      = "CdnInvalidation"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.thumbnails.arn
      },
    ]
  })
}
