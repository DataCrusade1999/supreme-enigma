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
};

export default nextConfig;
