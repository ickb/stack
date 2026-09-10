import { useQuery } from "@tanstack/react-query";
import type { RootConfig } from "../shared/utils.ts";
import { quoteStateOptions, type QuoteState } from "./queries.ts";

export function useQuoteState(rootConfig: RootConfig | undefined): QuoteStateQuery {
  return useQuery<QuoteState>({
    enabled: rootConfig !== undefined,
    ...(rootConfig !== undefined
      ? quoteStateOptions(rootConfig)
      : disabledQuoteStateOptions()),
  });
}

export type QuoteStateQuery = ReturnType<typeof useQuery<QuoteState>>;

export function liveQuoteStatus(quoteStateQuery: QuoteStateQuery): string {
  if (quoteStateQuery.isError) {
    return "Unable to load live exchange rate.";
  }

  return "Loading live exchange rate...";
}

function disabledQuoteStateOptions(): {
  queryKey: readonly ["unsupported", "quoteState"];
  queryFn: () => Promise<QuoteState>;
} {
  return {
    queryKey: ["unsupported", "quoteState"],
    queryFn: async (): Promise<QuoteState> => {
      await Promise.resolve();
      throw new Error("Unsupported network");
    },
  };
}
