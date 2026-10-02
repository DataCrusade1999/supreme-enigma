permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"free", resource)
when {
  resource in [Site::Tool::"hub", Site::Tool::"bgm-looper", Site::Tool::"money-planner", Site::Tool::"news-desk"]
};
