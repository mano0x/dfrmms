import { PHOTO_BUCKET_ID } from "@/lib/appwrite/config";
import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { acceptUpload } from "@/lib/server/uploads";

/**
 * Upload a fault photo. Residents only, at most 20 in 24 hours. The file is
 * checked by its content (not its name), decoded and written anew without
 * hidden data such as a GPS position, stored in the private bucket with no
 * browser access, and named after its uploader so it can only be attached
 * to that resident's own report (lib/server/uploads.ts). Returns the file
 * ID to send with the report.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student"]);
    if (guard.response) return guard.response;
    return ok({ photoFileId: await acceptUpload(request, guard.caller, PHOTO_BUCKET_ID, "fault-photo") }, 201);
  });
}
