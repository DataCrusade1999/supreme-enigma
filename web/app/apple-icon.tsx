import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Safari and iOS ignore SVG favicons, so this renders icon.svg to a PNG at
// build time rather than keeping a second copy of the mark. The ink background
// fills the corners icon.svg leaves transparent; iOS applies its own mask.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "base64");

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#111110" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders <img>, not next/image */}
        <img src={`data:image/svg+xml;base64,${svg}`} width={180} height={180} alt="" />
      </div>
    ),
    size,
  );
}
