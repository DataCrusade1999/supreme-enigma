# GuardDuty in us-east-1 (#376), foundational sources only: CloudTrail management
# events, VPC flow logs and DNS logs. Like the trail, it watches the whole account.
# Other regions are not covered.

resource "aws_guardduty_detector" "this" {
  enable = true
}

# CreateDetector turns every optional protection plan on unless told otherwise, so
# leaving these out is not enough. Runtime Monitoring is the one plan that starts off.
resource "aws_guardduty_detector_feature" "off" {
  for_each = toset([
    "S3_DATA_EVENTS", "EKS_AUDIT_LOGS", "EBS_MALWARE_PROTECTION",
    "RDS_LOGIN_EVENTS", "LAMBDA_NETWORK_LOGS", "AI_PROTECTION",
  ])

  detector_id = aws_guardduty_detector.this.id
  name        = each.value
  status      = "DISABLED"
}

# Medium and above (severity 4+) to the alerts topic, whose policy admits EventBridge.
resource "aws_cloudwatch_event_rule" "guardduty_findings" {
  name        = "${var.project_name}-guardduty-findings"
  description = "GuardDuty findings of medium severity or higher"
  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail      = { severity = [{ numeric = [">=", 4] }] }
  })
}

resource "aws_cloudwatch_event_target" "guardduty_findings" {
  rule = aws_cloudwatch_event_rule.guardduty_findings.name
  arn  = aws_sns_topic.budget_alerts.arn

  input_transformer {
    input_paths = {
      severity    = "$.detail.severity"
      type        = "$.detail.type"
      title       = "$.detail.title"
      description = "$.detail.description"
      resource    = "$.detail.resource.resourceType"
      region      = "$.detail.region"
      id          = "$.detail.id"
    }
    input_template = <<-EOT
      "GuardDuty finding, severity <severity> of 10"
      "<title>"
      ""
      "Type: <type>"
      "Resource type: <resource>"
      "<description>"
      ""
      "https://<region>.console.aws.amazon.com/guardduty/home?region=<region>#/findings?macros=current&fId=<id>"
    EOT
  }
}
