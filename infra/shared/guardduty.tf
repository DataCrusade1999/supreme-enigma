# GuardDuty in us-east-1 (#376) is now run by the personal AWS organization: the audit
# account is the delegated administrator and sets protection plans for every member
# (DataCrusade1999/aws-org). These blocks drop the detector from this state without
# deleting it. Findings reach the owner through the organization's alerts, so this
# stack has no findings rule (#395).
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
