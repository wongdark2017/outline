import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  useStores: vi.fn(),
}));

vi.mock("~/hooks/useStores", () => ({
  default: mocks.useStores,
}));

vi.mock("./SuggestionsMenu", () => ({
  default: ({ items }: { items: Array<{ title: string }> }) => (
    <div data-testid="suggestions-menu">
      {items.map((item) => item.title).join(",")}
    </div>
  ),
}));

vi.mock("./SuggestionsMenuItem", () => ({
  default: () => null,
}));

import MemoTagMenu from "./MemoTagMenu";

describe("MemoTagMenu", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.useStores.mockReset();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it("treats an undefined search query as empty when the trigger is typed alone", async () => {
    const fetchTags = vi.fn().mockResolvedValue(["alpha"]);
    mocks.useStores.mockReturnValue({
      memos: {
        fetchTags,
      },
    });

    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <MemoTagMenu
            rtl={false}
            isActive
            search={undefined as unknown as string}
            trigger="#"
            onClose={vi.fn()}
          />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchTags).toHaveBeenCalledWith("");
    expect(container.textContent).toContain("#alpha");
  });

  it("offers creating a new tag when there is no existing match", async () => {
    const fetchTags = vi.fn().mockResolvedValue([]);
    mocks.useStores.mockReturnValue({
      memos: {
        fetchTags,
      },
    });

    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <MemoTagMenu
            rtl={false}
            isActive
            search={"brandnew/subtag"}
            trigger="#"
            onClose={vi.fn()}
          />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchTags).toHaveBeenCalledWith("brandnew/subtag");
    expect(container.textContent).toContain("#brandnew/subtag");
  });
});
