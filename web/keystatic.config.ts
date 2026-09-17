import { config, fields, collection } from "@keystatic/core";

export default config({
  storage: {
    kind: "github",
    repo: "DataCrusade1999/supreme-enigma",
  },
  collections: {
    blog: collection({
      label: "Blog",
      slugField: "title",
      path: "content/blog/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        date: fields.date({ label: "Date" }),
        summary: fields.text({ label: "Summary" }),
        tags: fields.array(fields.text({ label: "Tag" }), { label: "Tags" }),
        content: fields.mdx({ label: "Content" }),
      },
    }),
    newsletter: collection({
      label: "Newsletter",
      slugField: "title",
      path: "content/newsletter/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        date: fields.date({ label: "Date" }),
        summary: fields.text({ label: "Summary" }),
        content: fields.mdx({
          label: "Content",
          description:
            "Plain Markdown only — no custom JSX components. This body is also sent as an email via Buttondown, which cannot render JSX.",
        }),
      },
    }),
  },
});
