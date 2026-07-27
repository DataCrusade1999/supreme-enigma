resource "aws_ecr_repository" "looper" {
  name         = "${var.project_name}-lambda"
  force_delete = true
}
