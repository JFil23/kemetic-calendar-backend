import { DECAN_CONTEXT } from "./decan_context.generated.ts";

export type DecanDayCard = {
  day: number;
  theme: string;
  action: string;
  reflection: string;
};

export type DecanContext = {
  contextKey: string;
  month: number;
  decan: number;
  monthKey: string;
  monthShort: string;
  shortName: string;
  displayName: string;
  defaultLabel: string;
  detailDescription: string;
  dayCards: DecanDayCard[];
};

const CONTEXT_MAP = DECAN_CONTEXT as unknown as Record<string, DecanContext>;

export function getDecanContext(contextKey?: string | null): DecanContext | null {
  if (!contextKey) return null;
  return CONTEXT_MAP[contextKey] ?? null;
}

export function buildDecanContextKey(month: number, decan: number) {
  return `${month}-${decan}`;
}

export function fallbackDecanLabel(contextKey?: string | null) {
  return getDecanContext(contextKey)?.defaultLabel ?? null;
}
