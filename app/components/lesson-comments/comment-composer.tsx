import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { COMMENT_MAX_LENGTH } from "~/lib/comments";

export function CommentComposer({
  fetcherKey,
  fields,
  placeholder,
  submitLabel,
  pendingLabel = "Posting…",
  initialValue = "",
  autoFocus,
  onDone,
  onCancel,
}: {
  fetcherKey: string;
  /** Hidden form fields, including `intent`. */
  fields: Record<string, string>;
  placeholder: string;
  submitLabel: string;
  /** Button text while the request is in flight. */
  pendingLabel?: string;
  initialValue?: string;
  autoFocus?: boolean;
  /** Called after a successful submit (e.g. to collapse a reply/edit form). */
  onDone?: () => void;
  /** When set, a Cancel button is shown. */
  onCancel?: () => void;
}) {
  const fetcher = useFetcher({ key: fetcherKey });
  const [value, setValue] = useState(initialValue);
  const textareaId = useId();
  // Keyed fetchers keep their last data around; only show errors from
  // submissions made by this mounted composer.
  const [submitted, setSubmitted] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const submitting = fetcher.state !== "idle";
  const error =
    submitted && !submitting
      ? (fetcher.data?.error as string | undefined)
      : undefined;

  // Detect a submitting/loading -> idle transition of this fetcher.
  const prevState = useRef(fetcher.state);
  useEffect(() => {
    const wasBusy = prevState.current !== "idle";
    prevState.current = fetcher.state;
    if (wasBusy && fetcher.state === "idle" && fetcher.data?.success === true) {
      setValue("");
      setSubmitted(false);
      onDoneRef.current?.();
    }
  }, [fetcher.state, fetcher.data]);

  const trimmed = value.trim();

  return (
    <fetcher.Form
      method="post"
      className="space-y-2"
      onSubmit={() => setSubmitted(true)}
    >
      {Object.entries(fields).map(([name, fieldValue]) => (
        <input key={name} type="hidden" name={name} value={fieldValue} />
      ))}
      <Label className="sr-only" htmlFor={textareaId}>
        {placeholder}
      </Label>
      <Textarea
        id={textareaId}
        name="body"
        value={value}
        autoFocus={autoFocus}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {value.length}/{COMMENT_MAX_LENGTH}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!trimmed || submitting}>
            {submitting ? pendingLabel : submitLabel}
          </Button>
        </div>
      </div>
    </fetcher.Form>
  );
}
