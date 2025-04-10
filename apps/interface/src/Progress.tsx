import type { JSX } from "react";

export default function Progress({
  children,
  isDone,
}: {
  children?: React.ReactNode;
  isDone?: boolean;
}): JSX.Element {
  if (isDone) {
    return <span className="col-span-full w-full pb-4">{children}</span>;
  }

  return (
    <span className="col-span-full flex w-full flex-col">
      <span className="pb-2">{children}</span>
      <span className="flex h-2 w-full flex-row overflow-hidden rounded">
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-3.00s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.85s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.70s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.55s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.40s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.25s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-2.10s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.95s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.80s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.65s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.50s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.35s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.20s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-1.05s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.90s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.75s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.60s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.45s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.30s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-delay:-0.15s] [animation-duration:6s]"></span>
        <span className="size-full animate-pulse bg-amber-400 [animation-duration:6s]"></span>
      </span>
    </span>
  );
}
