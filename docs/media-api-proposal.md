# SDK approval needed: uploaded-file deletion

AvocadoEdition removes uploaded attachments when deleting posts
(`bbs/delete.php:84`) and character portraits when deleting characters
(`mypage/character/character_delete.php:14–18`). The port currently removes
documents but keeps uploaded media, consuming the site's file/storage quota.

SDK 1.1.0 exposes media upload only. Its upload result drops the file ID that
the server already returns. The media service supports deletion through the
control panel, but deliberately rejects deletion by **all website bearer
tokens**, including owner tokens (`media.ts:140–147`). Site functions cannot access
the network or object storage. No SDK or server behavior has been changed for
this proposal.

## Proposed addition, pending the user's approval

- Include `id: string` in both member and owner `media.upload()` results.
- Add `media.delete(id, { signal? })` on member and owner handles. It resolves
  without a value on success, is idempotent for an absent file, and never
  automatically retries a write.
- A member may delete only a file whose stored `member_id` is their own,
  within this site and the token's allowed origin. Cross-member deletion must
  return `ACCESS_DENIED`. Owner website tokens need an explicit deletion
  capability granted at sign-in; existing upload-only owner grants must not
  silently gain the ability to empty the site's media library. The consent
  page must state the new capability. Control-panel owner authority remains.
- Preserve existing 1.0.0 SDK bytes and existing upload response fields. Add
  the API to mutable 1.1.0, regenerate its built assets/reference, and test
  ownership, absent files, unauthorized origins, storage failure and aborts.
- The application stores the returned ID with the media URL. It requests
  cleanup only after removing the document or replacing its image. External
  image URLs and legacy uploads without stored IDs are not guessed or deleted.
- Document any remaining orphan-cleanup/retry requirements. Adding deletion
  alone does not prove safe reconciliation after a browser closes or loses
  its connection.

Other port work can continue while this decision is pending.
