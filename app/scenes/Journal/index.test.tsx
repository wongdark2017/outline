import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  historyPush: vi.fn(),
  params: {} as { date?: string },
  toastError: vi.fn(),
  useStores: vi.fn(),
}));

vi.mock("~/hooks/useStores", () => ({
  default: mocks.useStores,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");

  return {
    ...(actual as Record<string, unknown>),
    useHistory: () => ({ push: mocks.historyPush }),
    useParams: () => mocks.params,
  };
});

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

vi.mock("~/components/LoadingIndicator", () => ({
  default: () => <div data-testid="loading" />,
}));

vi.mock("~/components/NudeButton", () => ({
  default: React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
    function MockNudeButton(props, ref) {
      return <button {...props} ref={ref} />;
    }
  ),
}));

vi.mock("./components/RecentEntries", () => ({
  default: ({ entries }: { entries: unknown[] }) => (
    <div data-testid="recent">{entries.length}</div>
  ),
}));

import Journal from ".";

describe("Journal scene", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.params = {};
    mocks.historyPush.mockReset();
    mocks.toastError.mockReset();
    mocks.useStores.mockReset();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function buildJournalEntriesStore(overrides = {}) {
    const store = {
      actionError: null as string | null,
      calendarDots: new Set(["2026-06-04"]),
      clearActionError: vi.fn(),
      currentMonth: { year: 2026, month: 6 },
      fetchCalendar: vi.fn().mockResolvedValue(undefined),
      fetchOrCreateByDate: vi.fn().mockResolvedValue("/doc/journal-entry-abc"),
      fetchRange: vi.fn().mockResolvedValue(undefined),
      isLoading: false,
      recentEntries: [],
      selectedDate: "",
      setCurrentMonth: vi.fn(),
      setSelectedDate: vi.fn(),
      streak: 0,
      streakCapped: false,
      today: "2026-06-05",
      ...overrides,
    };

    return store;
  }

  async function renderJournal(journalEntries = buildJournalEntriesStore()) {
    mocks.useStores.mockReturnValue({ journalEntries });

    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <Journal />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });

    return journalEntries;
  }

  it("loads calendar and recent range on open", async () => {
    const journalEntries = await renderJournal();

    expect(journalEntries.fetchCalendar).toHaveBeenCalledWith(2026, 6);
    expect(journalEntries.fetchRange).toHaveBeenCalledWith(
      "2026-05-23",
      "2026-06-05"
    );
  });

  it("opens the selected date document", async () => {
    const journalEntries = await renderJournal();
    const button = container.querySelector(
      'button[aria-label="2026-06-04, has entry"]'
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(journalEntries.setSelectedDate).toHaveBeenCalledWith("2026-06-04");
    expect(journalEntries.fetchOrCreateByDate).toHaveBeenCalledWith(
      "2026-06-04"
    );
    expect(mocks.historyPush).toHaveBeenCalledWith("/doc/journal-entry-abc");
  });

  it("shows action errors in a toast and clears them", async () => {
    const journalEntries = buildJournalEntriesStore({
      actionError: "Restore the document first",
    });

    await renderJournal(journalEntries);

    expect(mocks.toastError).toHaveBeenCalledWith("Restore the document first");
    expect(journalEntries.clearActionError).toHaveBeenCalled();
  });

  it("shows streak copy and hides zero streak", async () => {
    await renderJournal(
      buildJournalEntriesStore({
        streak: 12,
      })
    );

    expect(container.textContent).toContain("12 day streak");

    ReactDOM.unmountComponentAtNode(container);
    await renderJournal(buildJournalEntriesStore({ streak: 0 }));

    expect(container.textContent).not.toContain("day streak");
  });

  it("shows capped streak copy", async () => {
    await renderJournal(
      buildJournalEntriesStore({
        streak: 366,
        streakCapped: true,
      })
    );

    expect(container.textContent).toContain("366+ day streak");
  });
});
