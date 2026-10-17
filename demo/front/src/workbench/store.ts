// Shared desk state for the grid and the chat (same external-store pattern as lib/actor.ts).
// The grid publishes selection and view; the chat sends highlight/filter commands and reads the context.
import { useSyncExternalStore } from 'react';
import type { AskRequest, ChatContext, GridFilter, Highlight, Rid, SelectionContext, SortSpec, WorkbenchState } from './contract';

const empty = (runId = '', stepId = '', dataset = ''): WorkbenchState => ({
  runId, stepId, dataset, filters: [], sort: null, onlyExceptions: false, selection: null, focus: {},
  highlights: [], chatFilter: null, pendingAsk: null, view: { total: 0, shown: 0 }, viewRids: null,
});

let state = empty();
const listeners = new Set<() => void>();
let sequence = 0;

function set(patch: Partial<WorkbenchState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

export const workbench = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

  /** Opening another table resets what belongs to the table; highlights stay with their own dataset. */
  open(runId: string, stepId: string, dataset: string) {
    if (state.runId === runId && state.stepId === stepId && state.dataset === dataset) return;
    const keep = state.runId === runId ? state.highlights : [];
    set({ ...empty(runId, stepId, dataset), highlights: keep, pendingAsk: state.runId === runId ? state.pendingAsk : null });
  },
  setFilters: (filters: GridFilter[]) => set({ filters }),
  addFilter: (filter: GridFilter) => set({ filters: [...state.filters.filter(item => !(item.column === filter.column && item.op === filter.op)), filter] }),
  removeFilter: (index: number) => set({ filters: state.filters.filter((_, i) => i !== index) }),
  setSort: (sort: SortSpec | null) => set({ sort }),
  setOnlyExceptions: (onlyExceptions: boolean) => set({ onlyExceptions }),
  setSelection: (selection: SelectionContext | null) => set({ selection }),
  focusColumn: (column?: string) => set({ focus: { ...state.focus, column } }),
  /** `rids`: the narrowed view in screen order (null when every row shows or rows are synthetic). */
  setView: (total: number, shown: number, rids: Rid[] | null = null) => {
    if (state.view.total !== total || state.view.shown !== shown || state.viewRids !== rids) set({ view: { total, shown }, viewRids: rids });
  },

  highlight(highlight: Highlight) {
    set({ highlights: [...state.highlights.filter(item => item.id !== highlight.id), highlight] });
  },
  clearHighlight: (id: string) => set({ highlights: state.highlights.filter(item => item.id !== id), chatFilter: state.chatFilter?.id === id ? null : state.chatFilter }),
  /** Narrow the view to the rows of a highlight (the chip "Linhas do chat" undoes it). */
  filterTo(highlight: Highlight) {
    workbench.highlight(highlight);
    set({ chatFilter: highlight });
  },
  clearChatFilter: () => set({ chatFilter: null }),

  /** Raise a question from the grid ("Por quê?", selection); the chat takes it with `takeAsk`. */
  ask(request: Omit<AskRequest, 'id'>) {
    set({ pendingAsk: { ...request, id: `ask-${++sequence}` } });
  },
  takeAsk(): AskRequest | null {
    const ask = state.pendingAsk;
    if (ask) set({ pendingAsk: null });
    return ask;
  },

  chatContext(): ChatContext {
    return {
      run_id: state.runId, step_id: state.stepId, dataset: state.dataset, filters: state.filters, sort: state.sort,
      only_exceptions: state.onlyExceptions, chat_filter_rids: state.chatFilter?.rids ?? null, view_rids: state.viewRids,
      selection: state.selection, focus: state.focus, view: state.view,
    };
  },
};

export function useWorkbench(): WorkbenchState {
  return useSyncExternalStore(workbench.subscribe, workbench.get);
}
