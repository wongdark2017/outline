import invariant from "invariant";
import { action, computed, observable, runInAction } from "mobx";
import type { JSONObject, ProsemirrorData } from "@shared/types";
import Memo from "~/models/Memo";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

export interface FetchMemosParams {
  offset?: number;
  limit?: number;
  archived?: boolean;
  tag?: string;
}

export default class MemosStore extends Store<Memo> {
  @observable
  isLoading = false;

  @observable
  showArchived = false;

  @observable
  activeTag: string | null = null;

  @observable
  canLoadMore = false;

  @observable
  nextOffset = 0;

  constructor(rootStore: RootStore) {
    super(rootStore, Memo);
  }

  @action
  async fetchMemos(params?: FetchMemosParams): Promise<Memo[]> {
    this.isLoading = true;

    try {
      const res = await client.post(
        "/memos.list",
        params as JSONObject | undefined
      );
      invariant(res?.data, "Data not available");

      let models: Memo[] = [];
      runInAction(() => {
        if (!params?.offset) {
          this.data.clear();
        }
        models = res.data.map(this.add);
        this.addPolicies(res.policies);
        this.isLoaded = true;
        this.showArchived = params?.archived ?? false;
        this.activeTag = params?.tag ?? null;
        const limit = params?.limit ?? res.pagination?.limit ?? models.length;
        const offset = params?.offset ?? 0;
        this.nextOffset = offset + models.length;
        this.canLoadMore = models.length >= limit;
      });

      return models;
    } finally {
      this.isLoading = false;
    }
  }

  @action
  async createMemo(content: ProsemirrorData, visibility = "private") {
    const res = await client.post("/memos.create", {
      content,
      visibility,
    });

    invariant(res?.data, "Data should be available");

    return runInAction(() => {
      this.addPolicies(res.policies);
      const memo = this.add(res.data);
      this.showArchived = false;
      return memo;
    });
  }

  @action
  async updateMemo(id: string, content: ProsemirrorData) {
    const res = await client.post("/memos.update", {
      id,
      content,
    });

    invariant(res?.data, "Data should be available");

    return runInAction(() => {
      this.addPolicies(res.policies);
      return this.add(res.data);
    });
  }

  @action
  async archiveMemo(id: string) {
    const res = await client.post("/memos.archive", { id });

    invariant(res?.data, "Data should be available");

    return runInAction(() => {
      this.addPolicies(res.policies);
      const memo = this.add(res.data);
      return memo;
    });
  }

  @action
  async deleteMemo(id: string) {
    await client.post("/memos.delete", { id });
    runInAction(() => {
      this.remove(id);
    });
  }

  @action
  async fetchTags(query?: string): Promise<string[]> {
    const res = await client.post("/memos.tags", { query });
    invariant(res?.data, "Data should be available");
    return res.data;
  }

  @action
  async fetchMore(limit = 25) {
    if (!this.canLoadMore || this.isLoading) {
      return [];
    }

    return this.fetchMemos({
      offset: this.nextOffset,
      limit,
      archived: this.showArchived || undefined,
      tag: this.activeTag ?? undefined,
    });
  }

  @computed
  get orderedData(): Memo[] {
    return Array.from(this.data.values())
      .filter((memo) => !memo.deletedAt)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  @computed
  get activeMemos(): Memo[] {
    return this.orderedData.filter((memo) => !memo.archivedAt);
  }

  @computed
  get archivedMemos(): Memo[] {
    return this.orderedData.filter((memo) => !!memo.archivedAt);
  }
}
