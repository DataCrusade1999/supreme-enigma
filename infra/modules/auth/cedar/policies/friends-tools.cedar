permit (principal in Site::Group::"${pool}|friends", action in [Site::Action::"view", Site::Action::"newsdesk:pin"], resource)
when {
  resource in [Site::Tool::"bgm-looper", Site::Tool::"money-planner", Site::Tool::"news-desk"] &&
  context has access &&
  context.now < context.access.expiresAt
};
