import { describe, expect, it } from "vitest";
import { renderEmail } from "./access-mail-layout";

const base = {
  heading: "Welcome",
  rows: [
    {
      tool: "News Desk",
      detail: "News Desk ask · 20 uses · until 20 Nov 2026, 6:43 pm IST",
      button: { label: "Open News Desk", href: "https://ashutosh-pandey.com/tools/news-desk" },
    },
  ],
  footer: ["Questions? Reply to this email."],
};

describe("renderEmail", () => {
  it("escapes data in the html", () => {
    const { html } = renderEmail({ ...base, heading: "A & <b>" });
    expect(html).toContain("A &amp; &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("escapes a quote in a button URL", () => {
    const { html } = renderEmail({ ...base, rows: [{ ...base.rows[0], button: { label: "x", href: 'https://a/"onclick="x' } }] });
    expect(html).not.toContain('"onclick="x');
  });

  it("is a 600px table with inline styles only", () => {
    const { html } = renderEmail(base);
    expect(html).toContain("<table");
    expect(html).toContain('width="600"');
    expect(html).not.toContain("<style");
  });

  it("puts the button URL and every row's detail in the text", () => {
    const { text } = renderEmail(base);
    expect(text).toContain("https://ashutosh-pandey.com/tools/news-desk");
    expect(text).toContain(base.rows[0].detail);
    expect(text).toContain("Questions? Reply to this email.");
  });

  it("renders without rows", () => {
    const { html, text } = renderEmail({ heading: "Ended", rows: [], footer: ["f"] });
    expect(html).toContain("Ended");
    expect(text).toContain("Ended");
  });
});
