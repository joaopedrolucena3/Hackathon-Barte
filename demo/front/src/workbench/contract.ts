// Grid ↔ chat contract: the desk state both sides read and the commands both sides send.
// Everything here is serializable, so it can go into the URL and into the chat request.
import type { DataValue } from '../api/agent';

/** Row index in the step's immutable Parquet file. Stable for the life of the run. */
export type Rid = number;

export type FilterOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'filled';

export interface GridFilter { column: string; op: FilterOp; value?: string }
export interface SortSpec { column: string; dir: 'asc' | 'desc' }
export interface CellRef { dataset: string; rid: Rid; column: string; label: string; value: DataValue }

export type HighlightTone = 'info' | 'warning' | 'critical';
/** Rows an answer points at. Non-destructive: it colors rows; `filterTo` narrows the view on request. */
export interface Highlight { id: string; answerId?: string; dataset: string; rids: Rid[]; tone: HighlightTone; label: string }

export interface SelectionStats {
  cells: number;
  /** Numeric cells counted in sum and average. */
  numeric: number;
  sum?: string;
  avg?: string;
  /** Every numeric cell is money: show R$. */
  money: boolean;
}
export interface SelectionContext { dataset: string; columns: string[]; rids: Rid[]; stats: SelectionStats }

export interface AskRequest {
  id: string;
  question: string;
  mode: 'pergunta' | 'por_que';
  cell?: CellRef;
  selection?: SelectionContext;
}

export interface WorkbenchState {
  runId: string;
  stepId: string;
  dataset: string;
  filters: GridFilter[];
  sort: SortSpec | null;
  onlyExceptions: boolean;
  selection: SelectionContext | null;
  focus: { column?: string; cell?: CellRef };
  highlights: Highlight[];
  /** Rows the chat narrowed the view to (shown as a removable chip). */
  chatFilter: Highlight | null;
  /** A question raised from the grid ("Por quê?", selection) waiting for the chat to take it. */
  pendingAsk: AskRequest | null;
  view: { total: number; shown: number };
  /** Rows on screen when the view is narrowed (filters, exceptions, chat filter); null when every row shows. */
  viewRids: Rid[] | null;
}

/** What the chat sends to the backend as context of a question. */
export interface ChatContext {
  run_id: string;
  step_id: string;
  dataset: string;
  filters: GridFilter[];
  sort: SortSpec | null;
  only_exceptions: boolean;
  chat_filter_rids: Rid[] | null;
  view_rids: Rid[] | null;
  selection: SelectionContext | null;
  focus: WorkbenchState['focus'];
  view: WorkbenchState['view'];
}
