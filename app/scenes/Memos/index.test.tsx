import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  useStores: vi.fn(),
  editorProps: [] as Array<{
    extensions?: unknown[];
    readOnly?: boolean;
    value?: unknown;
    defaultValue?: unknown;
  }>,
}));

vi.mock("~/hooks/useStores", () => ({
  default: mocks.useStores,
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

vi.mock("~/components/Button", () => ({
  default: React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button">
  >(function MockButton(props, ref) {
    const { children, value, neutral, borderOnHover, ...rest } = props as {
      children?: React.ReactNode;
      value?: React.ReactNode;
      neutral?: boolean;
      borderOnHover?: boolean;
    } & React.ComponentPropsWithoutRef<"button">;

    return (
      <button {...rest} ref={ref} data-neutral={neutral}>
        {children ?? value}
      </button>
    );
  }),
}));

vi.mock("~/components/NudeButton", () => ({
  default: React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button">
  >(function MockNudeButton(props, ref) {
    return (
      <button {...props} ref={ref}>
        {props.children}
      </button>
    );
  }),
}));

vi.mock("~/components/Time", () => ({
  default: ({ dateTime }: { dateTime: string }) => <time>{dateTime}</time>,
}));

vi.mock("~/editor/extensions/MemoTagMenu", () => ({
  default: {},
}));

vi.mock("~/components/Editor", () => ({
  default: ({
    extensions,
    value,
    defaultValue,
    readOnly,
    onChange,
    placeholder,
  }: {
    extensions?: unknown[];
    value?: { content?: { text?: string }[] };
    defaultValue?: unknown;
    readOnly?: boolean;
    onChange?: (value: (asString?: boolean) => unknown) => void;
    placeholder?: string;
  }) => {
    mocks.editorProps.push({ extensions, readOnly, value, defaultValue });

    return readOnly ? (
      <div data-testid="memo-readonly">
        {JSON.stringify(value ?? defaultValue)}
      </div>
    ) : (
      <textarea
        aria-label={placeholder}
        onChange={(event) =>
          onChange?.((asString?: boolean) => {
            const target = event.target as HTMLTextAreaElement;
            const doc = {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: target.value }],
                },
              ],
            };

            return asString === false ? doc : target.value;
          })
        }
      />
    );
  },
}));

import Memos from ".";

describe("Memos scene", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.useStores.mockReset();
    mocks.editorProps = [];
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function buildMemosStore(overrides = {}) {
    return {
      orderedData: [
        {
          id: "memo-1",
          createdAt: "2026-06-25T09:00:00.000Z",
          updatedAt: "2026-06-25T09:00:00.000Z",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "saved memo" }],
              },
            ],
          },
          tags: ["alpha"],
          archivedAt: null,
        },
      ],
      archivedMemos: [],
      activeMemos: [
        {
          id: "memo-1",
          createdAt: "2026-06-25T09:00:00.000Z",
          updatedAt: "2026-06-25T09:00:00.000Z",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "saved memo" }],
              },
            ],
          },
          tags: ["alpha"],
          archivedAt: null,
        },
      ],
      canLoadMore: false,
      fetchMore: vi.fn().mockResolvedValue(undefined),
      fetchMemos: vi.fn().mockResolvedValue(undefined),
      createMemo: vi.fn().mockResolvedValue(undefined),
      updateMemo: vi.fn().mockResolvedValue(undefined),
      archiveMemo: vi.fn().mockResolvedValue(undefined),
      deleteMemo: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  async function renderScene(memos = buildMemosStore()) {
    mocks.useStores.mockReturnValue({ memos });

    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <Memos />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });

    return memos;
  }

  function isExtensionClass(
    value: unknown
  ): value is new (options?: Record<string, unknown>) => { name: string } {
    return typeof value === "function";
  }

  it("loads memos on mount", async () => {
    const memos = await renderScene();

    expect(memos.fetchMemos).toHaveBeenCalled();
    expect(container.textContent).toContain("saved memo");
  });

  it("uses a single image extension in the memo editor", async () => {
    await renderScene();

    expect(mocks.editorProps.length).toBeGreaterThan(0);

    const imageExtensionCounts = mocks.editorProps.map(({ extensions }) =>
      (extensions ?? [])
        .filter(isExtensionClass)
        .map((Extension) => new Extension({}).name)
        .filter((name) => name === "image").length
    );

    expect(imageExtensionCounts).toEqual(
      expect.arrayContaining(imageExtensionCounts.map(() => 1))
    );
  });

  it("does not pass controlled value props to editable memo editors", async () => {
    await renderScene();

    expect(
      mocks.editorProps
        .filter(({ readOnly }) => !readOnly)
        .map(({ value }) => value)
    ).toEqual(expect.arrayContaining([undefined]));
    expect(
      mocks.editorProps.filter(({ readOnly }) => !readOnly).every(({ value }) => value === undefined)
    ).toBe(true);
  });

  it("creates a memo from the composer", async () => {
    const memos = await renderScene();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Save")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.change(textarea, { target: { value: "hello #memo" } });
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(memos.createMemo).toHaveBeenCalled();
    expect(memos.createMemo).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "doc",
      })
    );
  });

  it("fetches archived memos when switching views", async () => {
    const memos = await renderScene(
      buildMemosStore({
        orderedData: [
          {
            id: "memo-2",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "archived memo" }],
                },
              ],
            },
            tags: ["archive"],
            archivedAt: "2026-06-29T00:00:00.000Z",
          },
        ],
        archivedMemos: [
          {
            id: "memo-2",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "archived memo" }],
                },
              ],
            },
            tags: ["archive"],
            archivedAt: "2026-06-29T00:00:00.000Z",
          },
        ],
        activeMemos: [],
      })
    );

    const archivedButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Archived")
    ) as HTMLButtonElement | undefined;

    expect(archivedButton).toBeTruthy();

    await act(async () => {
      Simulate.click(archivedButton as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(memos.fetchMemos).toHaveBeenLastCalledWith({ archived: true });
  });

  it("filters by tag when clicking a tag chip", async () => {
    const memos = await renderScene();
    const tag = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("#alpha")
    ) as HTMLButtonElement | undefined;

    expect(tag).toBeTruthy();

    await act(async () => {
      Simulate.click(tag as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(memos.fetchMemos).toHaveBeenLastCalledWith({ tag: "alpha" });
  });

  it("updates a memo inline", async () => {
    const memos = await renderScene();
    const editButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.getAttribute("aria-label") === "Edit memo"
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(editButton);
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const updateButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Update")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.change(textarea, { target: { value: "edited memo #alpha" } });
      Simulate.click(updateButton);
      await Promise.resolve();
    });

    expect(memos.updateMemo).toHaveBeenCalledWith(
      "memo-1",
      expect.objectContaining({
        type: "doc",
      })
    );
  });

  it("loads the next page", async () => {
    const memos = await renderScene(
      buildMemosStore({
        canLoadMore: true,
      })
    );
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Load more")
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(memos.fetchMore).toHaveBeenCalled();
  });
});
