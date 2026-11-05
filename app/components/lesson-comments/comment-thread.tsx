import { useState } from "react";
import { Reply } from "lucide-react";
import type { CommentThread as CommentThreadData } from "~/services/commentService";
import { Button } from "~/components/ui/button";
import { CommentComposer } from "./comment-composer";
import { CommentItem } from "./comment-item";

export function CommentThread({
  thread,
  currentUserId,
  isModerator,
  canReply,
  now,
}: {
  thread: CommentThreadData;
  currentUserId: number | null;
  isModerator: boolean;
  canReply: boolean;
  now: number;
}) {
  const { comment, replies } = thread;
  const [replying, setReplying] = useState(false);
  const showReplyButton = canReply && !comment.deleted && !replying;

  return (
    <div className="space-y-3">
      <CommentItem
        comment={comment}
        currentUserId={currentUserId}
        isModerator={isModerator}
        now={now}
      />
      {(replies.length > 0 || replying) && (
        <div className="ml-11 space-y-3 border-l-2 pl-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              isModerator={isModerator}
              now={now}
              isReply
            />
          ))}
          {replying && !comment.deleted && (
            <CommentComposer
              fetcherKey={`reply-comment-${comment.id}`}
              fields={{ intent: "add-comment", parentId: String(comment.id) }}
              placeholder={`Reply to ${comment.author.name}…`}
              submitLabel="Reply"
              pendingLabel="Posting…"
              autoFocus
              onDone={() => setReplying(false)}
              onCancel={() => setReplying(false)}
            />
          )}
        </div>
      )}
      {showReplyButton && (
        <div className="ml-11">
          <Button variant="outline" size="xs" onClick={() => setReplying(true)}>
            <Reply /> Reply
            {replies.length > 0 &&
              ` · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </Button>
        </div>
      )}
    </div>
  );
}
