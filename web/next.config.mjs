/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // The login page used to live under the looper's own route. Links to it
      // are already out in the world, so point them at the tool itself — the
      // proxy then sends anyone unauthenticated on to /login with ?next set,
      // and they land on the tool rather than a 404 after signing in.
      {
        source: "/tools/bgm-looper/login",
        destination: "/tools/bgm-looper",
        permanent: true,
      },
    ];
  },
  async headers() {
    // dev.ashutosh-pandey.com and stage.ashutosh-pandey.com are public copies
    // of the site. A header rather than a robots.txt disallow: a crawler that
    // is blocked from fetching a page never sees a noindex on it, and can
    // still index the bare URL from links.
    if (process.env.VERCEL_ENV === "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default nextConfig;
