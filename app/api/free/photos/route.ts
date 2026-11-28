import { FREE_PHOTO_BUCKET_ID } from "@/lib/appwrite/config";
import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { acceptUpload } from "@/lib/server/uploads";

/**
 * Upload a photo of a free item. Residents only, at most 20 in 24 hours.
 * The same steps as for fault photos (lib/server/uploads.ts): the type is
 * decided from the content, the size is limited, the picture is written
 * anew without hidden data, and the file is stored in a private bucket
 * under a name that records its uploader, so it can only be attached to
 * that resident's own listing.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student"]);
    if (guard.response) return guard.response;
    return ok({ photoFileId: await acceptUpload(request, guard.caller, FREE_PHOTO_BUCKET_ID, "free-photo") }, 201);
  });
}
