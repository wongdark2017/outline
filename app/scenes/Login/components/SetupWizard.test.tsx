import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("~/utils/ApiClient", () => ({
  client: {
    post: mocks.post,
  },
}));

vi.mock("~/utils/language", () => ({
  detectLanguage: () => "en_US",
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

vi.mock("@radix-ui/react-visually-hidden", () => ({
  Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/ChangeLanguage", () => ({
  default: () => null,
}));

vi.mock("~/components/ButtonLarge", () => ({
  default: React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button"> & {
      fullwidth?: boolean;
      neutral?: boolean;
    }
  >(function MockButtonLarge({ fullwidth, neutral, ...props }, ref) {
    return <button {...props} ref={ref} />;
  }),
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
    ...props
  }: React.ComponentPropsWithoutRef<"span"> & {
    as?: React.ElementType;
  }) => <Component {...props}>{children}</Component>,
}));

vi.mock("~/components/Input", () => ({
  default: ({
    label,
    error,
    flex,
    labelHidden,
    ...props
  }: React.ComponentPropsWithoutRef<"input"> & {
    label?: string;
    error?: string;
    flex?: boolean;
    labelHidden?: boolean;
  }) => (
    <label>
      {labelHidden ? null : label}
      <input {...props} />
      {error ? <span>{error}</span> : null}
    </label>
  ),
}));

vi.mock("~/components/InputSelect", () => ({
  InputSelect: ({
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: Array<{ type: string; label?: string; value?: string }>;
    value?: string | null;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {options
          .filter((option) => option.type === "item")
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </label>
  ),
}));

vi.mock("~/components/Switch", () => ({
  default: ({
    label,
    checked,
    onChange,
    name,
  }: {
    label?: string;
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    name?: string;
  }) => (
    <label>
      {label}
      <input
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    </label>
  ),
}));

vi.mock("~/components/primitives/Form", () => ({
  Form: (props: React.ComponentPropsWithoutRef<"form">) => <form {...props} />,
}));

import SetupWizard from "./SetupWizard";

describe("SetupWizard", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({
      data: {
        success: true,
      },
    });
    mocks.toastSuccess.mockReset();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderComponent(
    props: Partial<React.ComponentProps<typeof SetupWizard>> = {}
  ) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <SetupWizard isPasswordAuthEnabled {...props} />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  function getInput(name: string): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(
      `input[name="${name}"]`
    );

    if (!input) {
      throw new Error(`Missing input ${name}`);
    }

    return input;
  }

  function getSelect(label: string): HTMLSelectElement {
    const select = container.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`
    );

    if (!select) {
      throw new Error(`Missing select ${label}`);
    }

    return select;
  }

  function getButton(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes(label)
    );

    if (!button) {
      throw new Error(`Missing button ${label}`);
    }

    return button;
  }

  function getProgressItem(label: string): HTMLElement {
    const item = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="setup-step"]')
    ).find((element) => element.textContent?.includes(label));

    if (!item) {
      throw new Error(`Missing progress item ${label}`);
    }

    return item;
  }

  async function changeInput(name: string, value: string) {
    const input = getInput(name);

    await act(async () => {
      input.value = value;
      Simulate.change(input);
    });
  }

  async function continueToSystemStep() {
    await changeInput("teamName", "Acme");
    await changeInput("userName", "Ada Lovelace");
    await changeInput("userEmail", "ada@example.com");
    await changeInput("password", "correct horse battery staple");
    await changeInput("passwordConfirmation", "correct horse battery staple");

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });
  }

  async function continueToReviewStep() {
    await continueToSystemStep();

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });
  }

  it("uses three visible steps for local storage and submits a complete review payload", async () => {
    await renderComponent();

    expect(getProgressItem("Account")).toBeTruthy();
    expect(getProgressItem("System")).toBeTruthy();
    expect(getProgressItem("Storage")).toBeTruthy();
    expect(getProgressItem("Review")).toBeTruthy();

    await continueToReviewStep();

    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).not.toContain("Bucket");
    expect(getProgressItem("Storage").textContent).toContain("Not required");
    expect(container.textContent).toContain("English (US)");
    expect(container.textContent).toContain("Local");

    const form = container.querySelector("form");

    if (!form) {
      throw new Error("Missing setup form");
    }

    const data = new FormData(form);

    expect(data.get("teamName")).toBe("Acme");
    expect(data.get("userName")).toBe("Ada Lovelace");
    expect(data.get("userEmail")).toBe("ada@example.com");
    expect(data.get("password")).toBe("correct horse battery staple");
    expect(data.get("passwordConfirmation")).toBe(
      "correct horse battery staple"
    );
    expect(data.get("url")).toBe("http://localhost");
    expect(data.get("defaultLanguage")).toBe("en_US");
    expect(data.get("fileStorage")).toBe("local");
    expect(data.get("s3BucketName")).toBeNull();
  });

  it("shows field-level validation errors on the related inputs", async () => {
    await renderComponent();

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });

    expect(getInput("teamName").parentElement?.textContent).toContain(
      "Workspace name is required."
    );
    expect(getInput("userName").parentElement?.textContent).toContain(
      "Admin name is required."
    );
    expect(getInput("userEmail").parentElement?.textContent).toContain(
      "Email is required."
    );
    expect(getInput("password").parentElement?.textContent).toContain(
      "At least 12 characters."
    );
  });

  it("returns to the edited review section step", async () => {
    await renderComponent();
    await continueToReviewStep();

    await act(async () => {
      Simulate.click(getButton("Edit system"));
    });

    expect(container.textContent).toContain("System settings");
    expect(container.textContent).toContain("Site URL");
  });

  it("requires a successful S3 test before showing the review step", async () => {
    await renderComponent();
    await continueToSystemStep();

    const storageSelect = getSelect("File storage");

    await act(async () => {
      storageSelect.value = "s3";
      Simulate.change(storageSelect);
    });

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });

    expect(container.textContent).toContain("Bucket name");

    await changeInput("s3BucketName", "uploads");
    await changeInput("s3AccessKeyId", "access-key");
    await changeInput("s3SecretAccessKey", "secret-key");

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });

    expect(getInput("s3BucketName").parentElement?.textContent).not.toContain(
      "Test the storage connection before continuing."
    );
    expect(container.textContent).toContain(
      "Test the storage connection before continuing."
    );

    await act(async () => {
      Simulate.click(getButton("Test connection"));
      await Promise.resolve();
    });

    expect(mocks.post).toHaveBeenCalledWith("/installation.testStorage", {
      s3BucketName: "uploads",
      s3Region: undefined,
      s3AccessKeyId: "access-key",
      s3SecretAccessKey: "secret-key",
      s3Endpoint: undefined,
      s3ForcePathStyle: true,
    });

    await act(async () => {
      Simulate.click(getButton("Continue"));
    });

    expect(container.textContent).toContain("Bucket");
    expect(container.textContent).toContain("S3-compatible");
    expect(container.textContent).toContain("Edit storage");
    expect(getInput("s3BucketName").value).toBe("uploads");
    expect(getInput("s3AccessKeyId").value).toBe("access-key");
    expect(getInput("s3SecretAccessKey").value).toBe("secret-key");

    await act(async () => {
      Simulate.click(getButton("Edit storage"));
    });

    expect(container.textContent).toContain("S3 storage configuration");
    expect(container.textContent).toContain("Advanced options");
  });
});
