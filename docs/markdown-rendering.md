# Markdown Rendering

Two renderers exist deliberately, and they are not interchangeable:

- `app/lib/markdown.server.ts` — `renderMarkdown`, for lesson content and sales copy. Instructor-authored, trusted, raw HTML passes through.
- `app/lib/comment-markdown.server.ts` — `renderComment`, for student comments. Escapes raw HTML, restricts link protocols to http/https/mailto with `rel="nofollow"`, and drops images.

Both feed `dangerouslySetInnerHTML`, so changes to the comment renderer are security-sensitive.
