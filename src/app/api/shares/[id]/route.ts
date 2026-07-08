import { insertAccessLog } from "@/lib/server/db/access";
import { addRecipientViews, addShareViews, updateShareExpiry } from "@/lib/server/db/shares";
import {
  ApiError,
  clientIp,
  enforceRateLimit,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/http";
import { EXPIRY_OPTIONS, parseUpdateShare } from "@/lib/server/policy";
import {
  getManageableParent,
  getRecipientByLink,
  getShare,
  isExhausted,
  isExpired,
  isFullyExhausted,
  requireManagementAccess,
} from "@/lib/server/shares";
import { hashIp } from "@/lib/server/tokens";
import { toManagedShare } from "@/lib/server/views";
import type { ShareStatusDto } from "@/lib/shared/api";

export const runtime = "nodejs";

/**
 * Pre-access status for the viewer's interstitial: whether the share still
 * exists, and which gates (password, identity) stand in front of it.
 * Deliberately minimal — nothing is consumed or logged here.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await enforceRateLimit(req, "status", 120, 10 * 60 * 1000);
    const { id } = await params;
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    let exhausted = isExhausted(share);
    let hasViewLimit = share.viewsRemaining !== null;
    if (share.policy.requireIdentity) {
      const recipient = await getRecipientByLink(id);
      if (!recipient || recipient.revoked) {
        return jsonResponse({ error: "Not found", kind: "gone" }, 404);
      }
      exhausted = recipient.viewsRemaining !== null && recipient.viewsRemaining <= 0;
      hasViewLimit = recipient.viewsRemaining !== null;
    }

    const status: ShareStatusDto = {
      requiresPassword: share.wrappedCek !== null,
      requiresIdentity: share.policy.requireIdentity,
      expired: isExpired(share),
      exhausted,
      hasViewLimit,
    };
    return jsonResponse(status);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Post-create edits (SPEC §8), management-gated: extend the expiry window
 * and/or top up view counters — the two most common "I set the policy too
 * tight" fixes, neither of which should force re-encrypting and re-sending.
 * The configured policy JSON stays immutable; only the live-state columns
 * (expires_at, views_remaining) move.
 *
 * Guards (review findings): "Extend" must never move expiry EARLIER (the
 * sweeper would delete the share ahead of schedule); an edit that leaves the
 * share dead anyway — views on an expired share, or an expiry bump on a
 * fully-exhausted one — is rejected with instructions rather than reported
 * as a success that revives nothing.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    await enforceRateLimit(req, "edit", 30, 60 * 1000);

    const share = await getManageableParent(id);
    await requireManagementAccess(req, share);
    const update = parseUpdateShare(await readJsonBody(req));

    const newExpiresAt =
      update.extendExpiry !== null
        ? new Date(Date.now() + EXPIRY_OPTIONS[update.extendExpiry] * 1000).toISOString()
        : null;
    if (newExpiresAt !== null && share.expiresAt !== null && newExpiresAt <= share.expiresAt) {
      throw new ApiError(
        400,
        "That window would shorten this share — it already expires later. Pick a longer window.",
      );
    }

    if (update.addViews !== null && isExpired(share) && newExpiresAt === null) {
      throw new ApiError(
        400,
        "This share has expired — extend its expiry in the same request to revive it.",
      );
    }

    if (update.addViews === null && newExpiresAt !== null && (await isFullyExhausted(share))) {
      // Extending alone leaves the share sweepable (exhaustion still matches);
      // it would be deleted minutes later despite the "successful" edit.
      throw new ApiError(
        400,
        "No views remain, so a new expiry alone won't keep this share — add views as well.",
      );
    }

    if (update.addViews !== null) {
      if (update.linkId !== null) {
        if (!share.policy.requireIdentity) {
          throw new ApiError(400, "This share has no recipient links");
        }
        const added = await addRecipientViews(id, update.linkId, update.addViews);
        if (added === null) {
          throw new ApiError(404, "No eligible recipient link (unknown, revoked, or unlimited)", "gone");
        }
      } else {
        if (share.policy.requireIdentity) {
          throw new ApiError(400, "Views are per recipient on this share — pass linkId");
        }
        const added = await addShareViews(id, update.addViews);
        if (added === null) throw new ApiError(400, "This share already has unlimited views");
      }
    }

    if (newExpiresAt !== null) {
      await updateShareExpiry(id, newExpiresAt);
    }

    await insertAccessLog({
      shareId: id,
      recipientId: null,
      ipHash: hashIp(clientIp(req)),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 256),
      action: "edit",
      result: "allowed",
    });

    return jsonResponse(toManagedShare(await getManageableParent(id)));
  } catch (error) {
    return errorResponse(error);
  }
}
