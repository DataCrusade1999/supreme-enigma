permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"free", resource)
when {
  resource == Site::Tool::"hub" && action == Site::Action::"view"
};
