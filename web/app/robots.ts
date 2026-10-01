import type { MetadataRoute } from "next";

// Crawlers that collect content for AI training or AI answers. robots.txt is
// advisory: this keeps out the ones that honour it, nothing more.
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "meta-externalagent",
  "Meta-ExternalFetcher",
  "FacebookBot",
  "Amazonbot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Timpibot",
  "YouBot",
  "DuckAssistBot",
  "MistralAI-User",
  "AI2Bot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_CRAWLERS, disallow: "/" },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/tools", "/api/", "/keystatic", "/login"],
      },
    ],
  };
}
