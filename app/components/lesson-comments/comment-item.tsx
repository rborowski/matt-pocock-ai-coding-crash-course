import { useState } from "react";
import { Pencil } from "lucide-react";
import type { CommentItem as CommentItemData } from "~/services/commentService";
import { Button } from "~/components/ui/button";
import { formatRelativeTime } from "~/lib/relative-time";
import { CommentAvatar } from "./comment-avatar";
import { CommentComposer } from "./comment-composer";
import { CommentRoleBadge } from "./comment-role-badge";
import { DeleteCommentDialog } from "./delete-comment-dialog";

export function CommentItem({
  comment,
  currentUserId,
  isModerator,
  now,
  isReply,
}: {
  comment: CommentItemData;
  currentUserId: number | null;
  isModerator: boolean;
  /** Server timestamp so SSR and hydration render identical relative times. */
  now: number;
  isReply?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (comment.deleted) {
    return (
      <p className="py-1 text-sm italic text-muted-foreground">
        [comment deleted]
      </p>
    );
  }

  const isAuthor = currentUserId !== null && comment.author.id === currentUserId;
  const canEdit = isAuthor;
  const canDelete = isAuthor || isModerator;

  return (
    <div className="flex gap-3">
      <CommentAvatar
        name={comment.author.name}
        avatarUrl={comment.author.avatarUrl}
        small={isReply}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{comment.author.name}</span>
          <CommentRoleBadge badge={comment.author.badge} />
          <span className="text-xs text-muted-foreground">
            <time
              dateTime={comment.createdAt}
              title={new Date(comment.createdAt).toUTCString()}
            >
              {formatRelativeTime(comment.createdAt, now)}
            </time>
            {comment.edited && " · edited"}
          </span>
        </div>
        {editing ? (
          <div className="mt-2">
            <CommentComposer
              fetcherKey={`edit-comment-${comment.id}`}
              fields={{ intent: "edit-comment", commentId: String(comment.id) }}
              placeholder="Edit your comment"
              submitLabel="Save"
              pendingLabel="Saving…"
              initialValue={comment.body}
              autoFocus
              onDone={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-line break-words text-sm">
            {comment.body}
          </p>
        )}
        {!editing && (canEdit || canDelete) && (
          <div className="mt-1 flex gap-1">
            {canEdit && (
              <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {canDelete && <DeleteCommentDialog commentId={comment.id} />}
          </div>
        )}
      </div>
    </div>
  );
}
