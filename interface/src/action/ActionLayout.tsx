import { useId, type JSX } from "react";
import { buttonClass } from "../shared/buttonStyles.ts";

export function ActionLayout({
  action,
  disabled,
  isDone,
  onAction,
  message,
  fee,
  maturity,
  destination,
}: Readonly<{
  action: string;
  disabled: boolean;
  isDone: boolean;
  onAction?: () => void;
  message: string;
  fee: string;
  maturity: string;
  /** The editable destination address; absent before a wallet is connected. */
  destination?: DestinationField;
}>): JSX.Element {
  const messageId = useId();
  const hasMessage = message !== "";

  return (
    <span className="grid w-full min-w-0 grid-cols-2 items-center justify-items-center gap-y-1">
      <Progress isDone={isDone}>
        <button
          className={`${buttonClass} col-span-2 px-8`}
          onClick={onAction}
          disabled={disabled}
          aria-describedby={hasMessage ? messageId : undefined}
        >
          {action}
        </button>
      </Progress>
      <span
        id={messageId}
        aria-live="polite"
        className={`col-span-2 flex min-h-12 max-w-full items-center px-3 py-1.5 text-center text-sm leading-tight break-words text-ickb-muted ${hasMessage ? "" : "invisible"}`}
      >
        {hasMessage ? message : "Status"}
      </span>
      <span className="col-span-2 grid w-full grid-cols-1 items-center justify-items-center gap-3 text-center min-[34rem]:grid-cols-2">
        <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="leading-relaxed font-bold tracking-wider">Maturity:</span>{" "}
          <span title={maturity}>{maturity}</span>
        </span>
        <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="leading-relaxed font-bold tracking-wider">Fee:</span>{" "}
          <span title={fee}>{fee}</span>
        </span>
      </span>
      {destination === undefined ? null : (
        <input
          value={destination.text}
          disabled={destination.disabled}
          onChange={(event) => {
            destination.setText(event.target.value);
          }}
          autoComplete="off"
          spellCheck={false}
          type="text"
          aria-invalid={destination.invalid}
          aria-label="Destination address"
          title="Every cell this transaction creates for you belongs to this address"
          className="col-span-2 w-full rounded border-0 bg-transparent px-3 text-center font-mono text-xs text-ickb-muted outline-none focus:text-ickb-action disabled:cursor-default"
        />
      )}
    </span>
  );
}

export interface DestinationField {
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly disabled: boolean;
  readonly invalid: boolean;
}

function Progress({
  children,
  isDone,
}: Readonly<{
  children: React.ReactNode;
  isDone: boolean;
}>): JSX.Element {
  return (
    <span className="col-span-full flex min-h-14 w-full flex-col">
      <span className="pb-1">{children}</span>
      <span
        className={`flex h-1.5 w-full flex-row overflow-hidden rounded-full bg-ickb-action/10 ${isDone ? "invisible" : ""}`}
      >
        {Array.from({ length: 21 }, (_, index) => (
          <span
            className="size-full animate-pulse bg-ickb-action/80 [animation-duration:6s] motion-reduce:animate-none"
            key={index}
            style={{ animationDelay: `${String((index - 20) * 0.15)}s` }}
          />
        ))}
      </span>
    </span>
  );
}
