import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

vi.mock("~/components/NudeButton", () => ({
  default: React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
    function MockNudeButton(props, ref) {
      return <button {...props} ref={ref} />;
    }
  ),
}));

import CalendarGrid from "./CalendarGrid";

describe("CalendarGrid", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function renderGrid(props = {}) {
    const onSelectDate = vi.fn();
    const onChangeMonth = vi.fn();

    act(() => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <CalendarGrid
            year={2026}
            month={6}
            dots={new Set(["2026-06-05"])}
            selectedDate="2026-06-03"
            today="2026-06-05"
            onSelectDate={onSelectDate}
            onChangeMonth={onChangeMonth}
            {...props}
          />
        </ThemeProvider>,
        container
      );
    });

    return { onSelectDate, onChangeMonth };
  }

  it("marks today, selected date, future dates, and entry dots", () => {
    renderGrid();

    const today = container.querySelector(
      'button[aria-label="2026-06-05, has entry"]'
    ) as HTMLButtonElement;
    const selected = container.querySelector(
      'button[aria-label="2026-06-03"]'
    ) as HTMLButtonElement;
    const future = container.querySelector(
      'button[aria-label="2026-06-06"]'
    ) as HTMLButtonElement;

    expect(today.getAttribute("aria-current")).toEqual("date");
    expect(today.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(selected.getAttribute("aria-pressed")).toEqual("true");
    expect(future.disabled).toEqual(true);
  });

  it("selects non-future dates and ignores future dates", () => {
    const { onSelectDate } = renderGrid();
    const selectable = container.querySelector(
      'button[aria-label="2026-06-04"]'
    ) as HTMLButtonElement;
    const future = container.querySelector(
      'button[aria-label="2026-06-06"]'
    ) as HTMLButtonElement;

    act(() => {
      Simulate.click(selectable);
      Simulate.click(future);
    });

    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith("2026-06-04");
  });
});
