// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello() {
  return <p>hello from jsdom</p>;
}

describe("component-testing infrastructure", () => {
  it("renders a React component in jsdom via Testing Library", () => {
    render(<Hello />);
    expect(screen.getByText("hello from jsdom")).toBeInTheDocument();
  });
});
