import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("~/utils/ApiClient", () => ({
  client: {
    post: mocks.post,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("~/components/Scene", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));

vi.mock("~/components/Heading", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock("~/components/Text", () => ({
  default: ({
    children,
    as: Component = "span",
    selectable: _selectable,
    type: _type,
    size: _size,
    weight: _weight,
    italic: _italic,
    ellipsis: _ellipsis,
    monospace: _monospace,
    ...props
  }: React.HTMLAttributes<HTMLElement> & {
    as?: React.ElementType;
    selectable?: boolean;
    type?: string;
    size?: string;
    weight?: string;
    italic?: boolean;
    ellipsis?: boolean;
    monospace?: boolean;
  }) => <Component {...props}>{children}</Component>,
}));

vi.mock("~/components/LoadingIndicator", () => ({
  default: () => <span>Loading</span>,
}));

import SystemInfo from "./SystemInfo";

describe("SystemInfo", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.post.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderScene() {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <SystemInfo />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("renders effective settings with source labels and masked values", async () => {
    mocks.post.mockResolvedValue({
      data: {
        settings: [
          {
            key: "URL",
            value: "https://docs.example.com",
            source: "database",
            isSensitive: false,
          },
          {
            key: "AWS_SECRET_ACCESS_KEY",
            value: "********",
            source: "env",
            isSensitive: true,
          },
          {
            key: "AWS_REGION",
            value: "",
            source: "default",
            isSensitive: false,
          },
        ],
      },
    });

    await renderScene();

    expect(mocks.post).toHaveBeenCalledWith("/installation.systemInfo");
    expect(container.textContent).toContain("URL");
    expect(container.textContent).toContain("https://docs.example.com");
    expect(container.textContent).toContain("Database");
    expect(container.textContent).toContain("AWS_SECRET_ACCESS_KEY");
    expect(container.textContent).toContain("********");
    expect(container.textContent).toContain("Environment");
    expect(container.textContent).toContain("AWS_REGION");
    expect(container.textContent).toContain("Default");
    expect(container.textContent).toContain("Empty");
  });

  it("shows an error when system info cannot be loaded", async () => {
    mocks.post.mockRejectedValue(new Error("System admin access required"));

    await renderScene();

    expect(container.textContent).toContain("System admin access required");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "System admin access required"
    );
  });
});
