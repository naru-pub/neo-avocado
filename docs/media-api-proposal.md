# Managed media lifecycle

The SDK media ID/deletion addition is approved and implemented in Naru SDK 1.1.0.
It preserves SDK 1.0.0, requires explicit owner deletion consent, validates member
ownership, and retries server storage cleanup durably. See Naru's
[media deletion contract](https://github.com/naru-pub/naru/blob/main/docs/media-deletion.md).

neo-avocado now keeps `imageId` with uploaded log images, character portraits,
outfits and personal-item images. External URLs and legacy URL-only images remain
unmanaged: no ID is extracted from a URL and no legacy data is rewritten.

## Ledger and cleanup

Create `neo_avocado_media_assets` with **admin read and admin write**. Each managed
upload has its uploader's site member ID, URL, document-reference keys and state.
Site functions attach/release references in the same transaction as document
changes. Removing one of several tracked references does not delete the file.
Replacing a managed image with an external URL releases its old reference.

Newly registered uploads have a ten-minute grace period so a concurrent tab's
cleanup cannot remove an image while the post-save request is being submitted.
A released last reference becomes eligible immediately. Claiming cleanup marks
an asset `deleting`, and normal write functions refuse to attach it again.

The browser deletes a claimed file using the SDK, then completes the ledger task.
Failure or closing the tab leaves a durable task that can be retried on the next
approved visit or through **파일 정리 다시 시도**. Work is bounded to five assets
per attempt so recovery stays within function budgets. Pending upload registration
is also kept in local storage by member ID and retried on return.

There remains a cross-service window: storage upload can succeed before ledger
registration reaches the server. Local storage helps recover it; if local storage
is blocked and the tab closes in that window, the owner must reconcile the file
through Naru's media library. Browser recovery is not an unattended background job.

## Owner recovery

The admin **미디어 정리** section recovers unreferenced tasks, including those
left by a banned member or a moderator's post deletion. Owner sign-in requests
`mediaDelete: true`, and Naru's consent page explains that permission. Existing
owner sessions must sign in again with the new collection scope and deletion grant.

Owner recovery passes `uploadedBy` to Naru, which compares it with the actual
stored uploader before deleting. Incorrect or forged app ownership data cannot
remove another uploader's file through this recovery path. Missing uploader
records, active references, an in-progress upload, absent grants and storage
failures retain the task for review/retry. The owner can still manage legacy files
separately through Naru's media library.

Owner cascade recovery releases ledger references in the same revision-guarded
batch as child/parent deletion. Normal member cascades remain resumable server
functions; child batches are reduced to ten to fit ledger changes within the
25-write function budget. Wallets, history, purchases and retained inventory are
preserved. Native post/comment reads and economy operations keep their existing
paths.

## Rollout

Deploy Naru's migrated control plane/background worker and SDK first, including
the `uploadedBy` guard. Create the admin-only ledger collection, then publish the
frontend, `media-cleanup.js`, admin helpers and site functions together. Reapprove
the owner's callback scopes and media deletion grant. No live membership states,
media, permissions or documents have been migrated by this work.

Verify image replacement, shared tracked references, outfit deletion, interrupted
character/log cascades, retry after storage failure, and owner recovery using a
test site. URLs copied without IDs are outside ledger reference tracking; review
such manual references before using a separate media-library delete.
