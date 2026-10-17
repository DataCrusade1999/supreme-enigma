forbid (principal, action in Site::Action::"ownerOnly", resource)
unless { principal in Site::Group::"${pool}|owner" };
