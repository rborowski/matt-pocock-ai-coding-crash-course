import { useState } from "react";
import { useFetcher } from "react-router";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

export function DeleteCommentDialog({ commentId }: { commentId: number }) {
  const fetcher = useFetcher({ key: `delete-comment-${commentId}` });
  const [open, setOpen] = useState(false);
  // Only show errors from a submission made during the current opening.
  const [submittedThisOpen, setSubmittedThisOpen] = useState(false);
  const error =
    submittedThisOpen && fetcher.state === "idle"
      ? (fetcher.data?.error as string | undefined)
      : undefined;
  const deleting = fetcher.state !== "idle";

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
        if (next) setSubmittedThisOpen(false);
        setOpen(next);
      }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-destructive">
          <Trash2 /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete comment?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. If the comment has replies, it will stay in
            the thread as &quot;[comment deleted]&quot;.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(e) => {
              // Keep the dialog open until the request finishes.
              e.preventDefault();
              setSubmittedThisOpen(true);
              fetcher.submit(
                { intent: "delete-comment", commentId: String(commentId) },
                { method: "post" }
              );
            }}
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
