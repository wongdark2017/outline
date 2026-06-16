import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

vi.mock("@radix-ui/react-visually-hidden", () => ({
  Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

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

vi.mock("~/components/Heading", () => ({
  default: (props: React.ComponentProps<"h1">) => <h1 {...props} />,
}));

vi.mock("~/components/Text", () => ({
  default: (props: React.ComponentProps<"p">) => <p {...props} />,
}));

import WorkspaceSetup from "./WorkspaceSetup";

describe("WorkspaceSetup", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderComponent(
    props: Partial<React.ComponentProps<typeof WorkspaceSetup>> = {}
  ) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <WorkspaceSetup {...props} />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("renders password fields when password auth is enabled", async () => {
    await renderComponent({ isPasswordAuthEnabled: true });

    expect(
      container.querySelector('input[name="password"]')
    ).toBeTruthy();
    expect(
      container.querySelector('input[name="passwordConfirmation"]')
    ).toBeTruthy();
  });

  it("blocks submit when password is too short", async () => {
    await renderComponent({ isPasswordAuthEnabled: true });

    const form = container.querySelector("form") as HTMLFormElement;
    const password = container.querySelector(
      'input[name="password"]'
    ) as HTMLInputElement;
    const confirmation = container.querySelector(
      'input[name="passwordConfirmation"]'
    ) as HTMLInputElement;

    await act(async () => {
      password.value = "short";
      Simulate.change(password);
      confirmation.value = "short";
      Simulate.change(confirmation);
    });

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    const prevented = !form.dispatchEvent(submitEvent);

    expect(prevented).toBe(true);
    expect(container.textContent).toContain("at least 12 characters");
  });

  it("blocks submit when passwords do not match", async () => {
    await renderComponent({ isPasswordAuthEnabled: true });

    const form = container.querySelector("form") as HTMLFormElement;
    const password = container.querySelector(
      'input[name="password"]'
    ) as HTMLInputElement;
    const confirmation = container.querySelector(
      'input[name="passwordConfirmation"]'
    ) as HTMLInputElement;

    await act(async () => {
      password.value = "correct horse battery staple";
      Simulate.change(password);
      confirmation.value = "different horse battery staple";
      Simulate.change(confirmation);
    });

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    const prevented = !form.dispatchEvent(submitEvent);

    expect(prevented).toBe(true);
    expect(container.textContent).toContain("Passwords do not match.");
  });

  it("does not render password fields when password auth is disabled", async () => {
    await renderComponent({ isPasswordAuthEnabled: false });

    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(
      container.querySelector('input[name="passwordConfirmation"]')
    ).toBeNull();
  });
});
