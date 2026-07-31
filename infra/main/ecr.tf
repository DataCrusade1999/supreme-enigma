resource "aws_ecr_repository" "looper" {
  name         = "${var.project_name}-lambda"
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "looper" {
  repository = aws_ecr_repository.looper.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the 5 most recent main images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["main"]
          countType     = "imageCountMoreThan"
          countNumber   = 5
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep only the 5 most recent dev images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["dev"]
          countType     = "imageCountMoreThan"
          countNumber   = 5
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 4
        description  = "Keep only the 5 most recent stage images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["stage"]
          countType     = "imageCountMoreThan"
          countNumber   = 5
        }
        action = { type = "expire" }
      }
    ]
  })
}
