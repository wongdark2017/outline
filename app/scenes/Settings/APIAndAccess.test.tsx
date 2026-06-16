import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  apiKeys: {
    fetchPage: vi.fn(),
    personalApiKeys: [],
  },
  oauthAuthentications: {
    fetchPage: vi.fn(),
    orderedData: [],
  },
  currentTeam: { id: "team-id" },
  currentUser: {
    id: "user-id",
    hasPassword: true,
  },
  policy: {
    createApiKey: false,
  },
}));

vi.mock("~/utils/ApiClient", () => ({
  client: {
    post: mocks.post,
  },
}));

vi.mock("~/components/Button", () => ({
  default: React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button">
  >(function MockButton(props, ref) {
    return (
      <button {...props} ref={ref}>
        {props.children ?? props.value}
      </button>
    );
  }),
}));

vi.mock("~/components/Input", () => ({
  default: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("~/components/Actions", () => ({
  Action: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/Heading", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("~/components/Text", () => ({
  default: ({
    children,
    as: Component = "span",
    ...props
  }: React.ComponentPropsWithoutRef<"span"> & {
    as?: React.ElementType;
  }) => <Component {...props}>{children}</Component>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("~/hooks/useCurrentTeam", () => ({
  default: () => mocks.currentTeam,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
  default: () => mocks.currentUser,
}));

vi.mock("~/hooks/usePolicy", () => ({
  default: () => mocks.policy,
}));

vi.mock("~/components/Scene", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));

vi.mock("~/components/PaginatedList", () => ({
  default: ({ heading }: { heading?: React.ReactNode }) => <div>{heading}</div>,
}));

vi.mock("~/actions/definitions/apiKeys", () => ({
  createApiKey: {},
}));

vi.mock("~/hooks/useStores", () => ({
  default: () => ({
    apiKeys: mocks.apiKeys,
    oauthAuthentications: mocks.oauthAuthentications,
  }),
}));

vi.mock("./components/ApiKeyListItem", () => ({
  default: () => null,
}));

vi.mock("./components/OAuthAuthenticationListItem", () => ({
  default: () => null,
}));

import APIAndAccess from "./APIAndAccess";

describe("APIAndAccess", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.post.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.currentTeam = { id: "team-id" };
    mocks.currentUser = {
      id: "user-id",
      hasPassword: true,
    };
    mocks.policy = {
      createApiKey: false,
    };
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderScene() {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <APIAndAccess />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("shows the password card only when the current user has a password", async () => {
    await renderScene();

    expect(container.textContent).toContain("Password");

    mocks.currentUser = {
      id: "user-id",
      hasPassword: false,
    };

    ReactDOM.unmountComponentAtNode(container);
    await renderScene();

    expect(container.textContent).not.toContain("Update the password");
  });

  it("posts logged-in password updates to the auth baseUrl", async () => {
    mocks.post.mockResolvedValue({
      success: true,
    });
    await renderScene();

    const inputs = container.querySelectorAll(
      'input[type="password"]'
    ) as NodeListOf<HTMLInputElement>;

    await act(async () => {
      inputs[0].value = "old password value";
      Simulate.change(inputs[0]);
      inputs[1].value = "new password value";
      Simulate.change(inputs[1]);
      inputs[2].value = "new password value";
      Simulate.change(inputs[2]);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Update password")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(mocks.post).toHaveBeenCalledWith(
      "/password/update",
      {
        currentPassword: "old password value",
        password: "new password value",
      },
      {
        baseUrl: "/auth",
      }
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("renders the returned error when password update fails", async () => {
    mocks.post.mockRejectedValue(new Error("Current password is incorrect"));
    await renderScene();

    const inputs = container.querySelectorAll(
      'input[type="password"]'
    ) as NodeListOf<HTMLInputElement>;

    await act(async () => {
      inputs[0].value = "old password value";
      Simulate.change(inputs[0]);
      inputs[1].value = "new password value";
      Simulate.change(inputs[1]);
      inputs[2].value = "new password value";
      Simulate.change(inputs[2]);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Update password")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Current password is incorrect");
  });
});
