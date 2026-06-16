import { action, computed, observable, runInAction } from "mobx";
import JournalEntry from "~/models/JournalEntry";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

interface JournalCalendarResponse {
  data: {
    dates: string[];
    streak: number;
    streakCapped: boolean;
  };
}

interface JournalEntryDocumentResponse {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

interface JournalEntryDataResponse {
  id: string;
  date: string;
  mood: string | null;
  tags: string[];
  documentId: string;
  document: JournalEntryDocumentResponse | null;
  createdAt: string;
  updatedAt: string;
}

interface JournalEntryResponse {
  data: JournalEntryDataResponse;
}

interface JournalEntriesResponse {
  data: JournalEntryDataResponse[];
}

export default class JournalEntriesStore extends Store<JournalEntry> {
  apiEndpoint = "journal";

  @observable
  selectedDate = "";

  @observable
  currentMonth: { year: number; month: number };

  @observable
  calendarDots: Set<string> = new Set();

  @observable
  streak = 0;

  @observable
  streakCapped = false;

  @observable
  isLoading = false;

  @observable
  error: string | null = null;

  @observable
  actionError: string | null = null;

  constructor(rootStore: RootStore) {
    super(rootStore, JournalEntry);

    const [year, month] = this.today.split("-").map(Number);
    this.selectedDate = this.today;
    this.currentMonth = { year, month };
  }

  @computed
  get userTimezone(): string {
    return (
      this.rootStore.auth?.user?.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC"
    );
  }

  @computed
  get today(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.userTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  @action
  async fetchCalendar(year: number, month: number) {
    try {
      const res = await client.post<JournalCalendarResponse>(
        "/journal.calendar",
        {
          year,
          month,
          timezone: this.userTimezone,
        }
      );

      runInAction(() => {
        this.calendarDots = new Set(res.data.dates);
        this.streak = res.data.streak;
        this.streakCapped = res.data.streakCapped;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
    }
  }

  @action
  async fetchOrCreateByDate(date: string): Promise<string | null> {
    this.isLoading = true;
    this.actionError = null;

    try {
      const res = await client.post<JournalEntryResponse>("/journal.upsert", {
        date,
        timezone: this.userTimezone,
      });

      runInAction(() => {
        this.add(res.data);
        this.calendarDots.add(date);
        this.isLoading = false;
      });

      return res.data.document?.url ?? null;
    } catch (error) {
      runInAction(() => {
        this.actionError =
          error instanceof Error ? error.message : String(error);
        this.isLoading = false;
      });
      return null;
    }
  }

  @action
  async fetchRange(startDate: string, endDate: string) {
    try {
      const res = await client.post<JournalEntriesResponse>(
        "/journal.entries",
        {
          startDate,
          endDate,
        }
      );

      runInAction(() => {
        const activeDates = new Set<string>();

        for (const item of res.data) {
          this.add(item);
          activeDates.add(item.date);
        }

        for (const entry of this.data.values()) {
          if (
            entry.date >= startDate &&
            entry.date <= endDate &&
            !activeDates.has(entry.date)
          ) {
            this.remove(entry.id);
          }
        }
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
    }
  }

  @action
  clearActionError() {
    this.actionError = null;
  }

  @action
  setSelectedDate(date: string) {
    this.selectedDate = date;
  }

  @action
  setCurrentMonth(year: number, month: number) {
    this.currentMonth = { year, month };
  }

  @computed
  get recentEntries(): JournalEntry[] {
    return Array.from(this.data.values())
      .filter((entry) => entry.document)
      .sort((a, b) => (a.date > b.date ? -1 : 1));
  }
}
