import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Route } from "react-router-dom";
import { light } from "@shared/styles/theme";
import { Notices } from "./Notices";

describe("Login notices", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderAt(path: string) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <MemoryRouter initialEntries={[path]}>
            <Route path="/">
              <Notices />
            </Route>
          </MemoryRouter>
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("renders password notices", async () => {
    await renderAt("/?notice=password-auth-failed");
    expect(container.textContent).toContain("incorrect");

    ReactDOM.unmountComponentAtNode(container);
    await renderAt("/?notice=password-locked");
    expect(container.textContent).toContain("temporarily locked");

    ReactDOM.unmountComponentAtNode(container);
    await renderAt("/?notice=password-updated");
    expect(container.textContent).toContain("updated");
  });
});
