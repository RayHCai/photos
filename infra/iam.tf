# -----------------------------------------------------------------------------
# IAM user for the Express API and Python worker to access S3
# -----------------------------------------------------------------------------
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
        Sid    = "ObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.photos.arn}/*"
      },
      {
        Sid    = "BucketList"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
        ]
        Resource = aws_s3_bucket.photos.arn
      },
    ]
  })
}
