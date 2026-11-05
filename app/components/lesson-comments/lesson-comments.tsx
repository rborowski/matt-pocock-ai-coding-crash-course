import { Link } from "react-router";
import { Lock, MessageSquare } from "lucide-react";
import type { CommentThread as CommentThreadData } from "~/services/commentService";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";
import { CommentComposer } from "./comment-composer";
import { CommentThread } from "./comment-thread";

export function LessonComments({
  lessonId,
  threads,
  count,
  currentUserId,
  isModerator,
  now,
  courseSlug,
  className,
}: {
  lessonId: number;
  /** null means the viewer may not read or post comments. */
  threads: CommentThreadData[] | null;
  count: number;
  currentUserId: number | null;
  isModerator: boolean;
  now: number;
  courseSlug: string;
  className?: string;
}) {
  return (
    <section className={cn(className)} aria-labelledby="lesson-discussion">
      <h2
        id="lesson-discussion"
        className="mb-4 flex items-center gap-2 text-lg font-semibold"
      >
        <MessageSquare className="size-5" />
        {threads === null ? "Discussion" : `Discussion (${count})`}
      </h2>

      {threads === null ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Lock className="size-5 text-muted-foreground" />
          <p className="font-medium">Join the discussion</p>
          <p className="text-sm text-muted-foreground">
            Enroll in this course to read and post comments.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link to={`/courses/${courseSlug}`}>View course</Link>
          </Button>
        </div>
      ) : (
        <div>
          <CommentComposer
            fetcherKey={`add-comment-${lessonId}`}
            fields={{ intent: "add-comment" }}
            placeholder="Ask a question or share a thought…"
            submitLabel="Post comment"
            pendingLabel="Posting…"
          />
          {threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <MessageSquare className="size-6" />
              <p className="text-sm">
                No comments yet. Be the first to start the discussion.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              {threads.map((thread) => (
                <div key={thread.comment.id}>
                  <Separator />
                  <div className="py-4">
                    <CommentThread
                      thread={thread}
                      currentUserId={currentUserId}
                      isModerator={isModerator}
                      canReply
                      now={now}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
