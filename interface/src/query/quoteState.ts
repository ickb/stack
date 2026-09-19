import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RootConfig } from "../shared/utils.ts";
import { quoteStateOptions, type QuoteState } from "./queries.ts";

export type QuoteStateQuery = UseQueryResult<QuoteState>;

export function useQuoteState(rootConfig: RootConfig | undefined): QuoteStateQuery {
  return useQuery(quoteStateOptions(rootConfig));
}

export function liveQuoteStatus(quoteStateQuery: QuoteStateQuery): string {
  if (quoteStateQuery.isError) {
    return "Unable to load live exchange rate.";
  }

  return "Loading live exchange rate...";
}
