import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";
import { ServiceUnavailableError } from "~/utils/errors";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getCookie: vi.fn(() => "csrf-token"),
}));

vi.mock("~/utils/ApiClient", () => ({
  client: {
    post: mocks.post,
  },
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

vi.mock("~/components/PluginIcon", () => ({
  default: () => null,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/utils/urls", () => ({
  getRedirectUrl: (url: string) => url,
}));

vi.mock("tiny-cookie", () => ({
  getCookie: mocks.getCookie,
}));

import AuthenticationProvider from "./AuthenticationProvider";
import env from "~/env";

describe("Login AuthenticationProvider", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.post.mockReset();
    mocks.getCookie.mockReturnValue("csrf-token");
    env.URL = "https://app.outline.dev";
    env.ENVIRONMENT = "test";
    env.EMAIL_ENABLED = true;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderProvider(
    props: Partial<React.ComponentProps<typeof AuthenticationProvider>> = {}
  ) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <AuthenticationProvider
            id="password"
            name="Password"
            authUrl="/auth/password"
            isCreate={false}
            onEmailSuccess={vi.fn()}
            preferOTP={false}
            {...props}
          />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("renders the password native form with csrf and client fields", async () => {
    await renderProvider();

    const initialButton = container.querySelector(
      "button"
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(initialButton);
    });

    const form = container.querySelector("form") as HTMLFormElement;
    const csrf = container.querySelector(
      'input[name="_csrf"]'
    ) as HTMLInputElement;
    const client = container.querySelector(
      'input[name="client"]'
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]'
    ) as HTMLInputElement;

    expect(form.action).toContain("/auth/password");
    expect(csrf.value).toBe("csrf-token");
    expect(client.value).toBeTruthy();
    expect(password).toBeTruthy();
  });

  it("posts forgot-password requests to the auth baseUrl", async () => {
    mocks.post.mockResolvedValue({});
    await renderProvider();

    const initialButton = container.querySelector(
      "button"
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(initialButton);
    });

    const forgotButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Forgot password?")
    ) as HTMLButtonElement | undefined;

    expect(forgotButton).toBeTruthy();

    await act(async () => {
      Simulate.click(forgotButton as HTMLButtonElement);
    });

    const emailInput = container.querySelector(
      'input[name="email"]'
    ) as HTMLInputElement;

    await act(async () => {
      emailInput.value = "user@example.com";
      Simulate.change(emailInput);
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Send reset link")
    ) as HTMLButtonElement | undefined;

    expect(sendButton).toBeTruthy();

    await act(async () => {
      Simulate.click(sendButton as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(mocks.post).toHaveBeenCalledWith(
      "/password/reset",
      {
        email: "user@example.com",
      },
      {
        baseUrl: "/auth",
      }
    );
  });

  it("shows a service-unavailable message when reset email is unavailable", async () => {
    mocks.post.mockRejectedValue(new ServiceUnavailableError());
    await renderProvider();

    const initialButton = container.querySelector(
      "button"
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(initialButton);
    });

    const forgotButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Forgot password?")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(forgotButton);
    });

    const emailInput = container.querySelector(
      'input[name="email"]'
    ) as HTMLInputElement;

    await act(async () => {
      emailInput.value = "user@example.com";
      Simulate.change(emailInput);
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Send reset link")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(sendButton);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Email service is unavailable.");
  });

  it("does not render password authentication on /create", async () => {
    await renderProvider({
      isCreate: true,
    });

    expect(container.textContent).toBe("");
    expect(container.querySelector("form")).toBeNull();
  });
});
