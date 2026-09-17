// The twelve column rules the editorial grid is drawn on — the hairlines are
// part of the design, not a dev-only overlay. Mirrors the page margins and
// gutter of the `(site)` layout's container so the rules land exactly on the
// column edges content is placed against.
export function GridBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 px-5 sm:px-10"
    >
      <div className="grid h-full grid-cols-12 gap-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} data-column-rule className="border-l border-line" />
        ))}
      </div>
    </div>
  );
}
