// A plain <img>, deliberately not next/image: next/image re-encodes what it
// serves, which breaks GIF animation and defeats the point of shipping a GIF.
// `width`/`height` are required so the space is reserved and the file loading
// in costs no layout shift. `priority` drives `loading` directly rather than
// every usage defaulting to lazy — the detail page's demo sits above the fold
// and may be its LCP element, where lazy loading measurably hurts.
export function ProjectDemoGif({
  src,
  alt,
  width,
  height,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next/image re-encodes images and breaks GIF animation
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      className="block h-auto w-full"
    />
  );
}
