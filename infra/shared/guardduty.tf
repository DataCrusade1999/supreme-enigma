# GuardDuty in us-east-1 (#376) is now run by the personal AWS organization: the audit
# account is the delegated administrator and sets protection plans for every member
# (DataCrusade1999/aws-org). These blocks drop the detector from this state without
# deleting it.
removed {
  from = aws_guardduty_detector.this
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_guardduty_detector_feature.off
  lifecycle {
    destroy = false
  }
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
