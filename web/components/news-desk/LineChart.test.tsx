import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineChart } from "./LineChart";

describe("LineChart", () => {
  it("draws one vertex per point and names the latest value", () => {
    const { container } = render(
      <LineChart
        title="IIP growth"
        unit="%"
        points={[
          { period: "May 2026", value: 5 },
          { period: "Jun 2026", value: 8.8 },
          { period: "Jul 2026", value: 6.7 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "IIP growth: 3 points, latest 6.7% in Jul 2026" })).toBeInTheDocument();
    const vertices = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    expect(vertices).toHaveLength(3);
    expect(vertices.join(" ")).not.toContain("NaN");
  });

  it("draws a single point without dividing by zero", () => {
    const { container } = render(<LineChart title="GDP" unit="%" points={[{ period: "Q1 2026-27", value: 7.8 }]} />);
    expect(container.querySelector("polyline")!.getAttribute("points")).not.toContain("NaN");
  });
});
