import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { MemoryRouter, Route } from "react-router-dom";
import { light } from "@shared/styles/theme";

vi.mock("~/components/ChangeLanguage", () => ({
  default: () => null,
}));

vi.mock("~/components/ButtonLarge", () => ({
  default: React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button">
  >(function MockButtonLarge(props, ref) {
    return <button {...props} ref={ref} />;
  }),
}));

vi.mock("~/components/InputLarge", () => ({
  default: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("~/components/PageTitle", () => ({
  default: () => null,
}));

import ResetPassword from "./ResetPassword";

describe("ResetPassword", () => {
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
            <Route path="/reset-password">
              <ResetPassword />
            </Route>
          </MemoryRouter>
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("shows an invalid-link state when token is missing", async () => {
    await renderAt("/reset-password");

    expect(container.textContent).toContain("invalid");
    expect(container.querySelector('input[name="resetToken"]')).toBeNull();
  });

  it("renders the resetToken hidden input from the query string", async () => {
    await renderAt("/reset-password?token=abc123");

    const input = container.querySelector(
      'input[name="resetToken"]'
    ) as HTMLInputElement;

    expect(input.value).toBe("abc123");
  });

  it("renders activation mode from the query string", async () => {
    await renderAt("/reset-password?activationToken=abc123");

    const activationInput = container.querySelector(
      'input[name="activationToken"]'
    ) as HTMLInputElement;

    expect(container.textContent).toContain("Set password");
    expect(activationInput.value).toBe("abc123");
    expect(container.querySelector('input[name="resetToken"]')).toBeNull();
  });

  it("blocks submit when passwords do not match", async () => {
    await renderAt("/reset-password?token=abc123");

    const form = container.querySelector("form") as HTMLFormElement;
    const passwordInputs = container.querySelectorAll(
      'input[type="password"]'
    ) as NodeListOf<HTMLInputElement>;

    await act(async () => {
      passwordInputs[0].value = "123456789012";
      Simulate.change(passwordInputs[0]);
      passwordInputs[1].value = "123456789013";
      Simulate.change(passwordInputs[1]);
    });

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    const prevented = !form.dispatchEvent(submitEvent);

    expect(prevented).toBe(true);
    expect(container.textContent).toContain("match");
  });
});
