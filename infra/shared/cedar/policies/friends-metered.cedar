permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"metered", resource)
when {
  context has grant &&
  context.grant.remaining > 0 &&
  context.now < context.grant.expiresAt
};
