data "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

# --- Runaway-invoke detection ---
# There is no reserved_concurrent_executions anywhere in this config, and there cannot
# be: this account's Lambda concurrency quota (L-B99A9384) is 10, and AWS only permits
# reserving up to "unreserved account concurrency minus 100". Confirmed against the live
# account on 2026-09-16 — put-function-concurrency 0 succeeds, 2 fails with
# InvalidParameterValueException "...below its minimum value of [10]". So the quota
# itself is the concurrency ceiling (10 x 1024 MB, roughly $0.60/hour absolute worst
# case) and these alarms are the fast signal instead.
#
# Invocations, not ConcurrentExecutions: concurrency is already hard-capped at 10, so
# what is actually unbounded is how many times over that ceiling gets reused. A
# fast-failing invoke loop burns money at a high invocation count and low concurrency,
# which a concurrency alarm would never see.
#
# 50 per five minutes is ~50x any real session — one track processed is one invoke.
# This is a runaway detector, not a usage meter; raise it if normal use ever trips it.
#
# treat_missing_data = "notBreaching" because Lambda emits no Invocations datapoint when
# a function is idle, which is nearly always here. Without it every alarm sits in
# INSUFFICIENT_DATA forever and never reaches OK.
#
# Three alarms, inside CloudWatch's 10-alarm free tier — no cost.
resource "aws_cloudwatch_metric_alarm" "lambda_invocation_rate" {
  alarm_name          = "${local.lambda_function_name}-invocation-rate"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = local.lambda_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.budget_alerts.arn]
  ok_actions          = [data.aws_sns_topic.budget_alerts.arn]

  alarm_description = "More than 50 invocations of ${local.lambda_function_name} in five minutes. Normal use is one invocation per track processed, so this means a runaway loop. See docs/runbooks/incident-tool-down.md#rollback."
}
