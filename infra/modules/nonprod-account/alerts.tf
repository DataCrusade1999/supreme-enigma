# --- Alerts: the topic the app stack's invocation alarm publishes to. No project
#     budget here: the aws-org repo's $2 account budget covers this account. ---

resource "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

resource "aws_sns_topic_subscription" "budget_alerts_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_policy" "budget_alerts" {
  arn = aws_sns_topic.budget_alerts.arn

  # This policy REPLACES the default SNS topic policy rather than adding to it, so every
  # publisher has to be named here. The cloudwatch statement is what lets
  # aws_cloudwatch_metric_alarm.lambda_invocation_rate deliver — without it the alarm
  # still transitions to ALARM and simply notifies nobody, which is the same silent
  # failure mode as an unconfirmed email subscription. The only publisher in this
  # account: no budget and no EventBridge rule publishes here.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.budget_alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = local.account_id }
        }
      }
    ]
  })
}
