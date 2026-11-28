/**
 * Re-encoding of uploaded photos. Server only.
 *
 * A photo from a phone carries hidden data: where it was taken (GPS), when,
 * with which device, sometimes a small preview of the uncropped picture.
 * The pages remove this in the browser before uploading, but a request does
 * not have to come from our pages. So the server decodes every upload and
 * writes a new image from the pixels alone. What is stored never contains
 * anything the uploader's file carried besides the picture.
 *
 * Decoding is done by the `sharp` library (libvips). No image format is
 * parsed by code of this project.
 */
import sharp from "sharp";
import { detectImageType, type ImageType } from "../image-rules";

/** A picture with more pixels than this is refused before it is decoded in full (a small file can claim an enormous picture). */
export const MAX_INPUT_PIXELS = 40_000_000;
/** The stored picture is at most this many pixels wide and high; larger ones are scaled down. */
export const MAX_EDGE = 2000;
const QUALITY = 85;

/** The upload is not a picture this server can read. The message is safe to show. */
export class ImageError extends Error {
  constructor(message = "The photo could not be read. Please choose another one.") {
    super(message);
    this.name = "ImageError";
  }
}

/**
 * Decode the upload and encode it again in the same format. The result has
 * the picture turned the right way up (as its orientation tag said) and no
 * metadata at all: no EXIF, GPS, colour profile, comment or preview.
 */
export async function reencode(bytes: Uint8Array): Promise<{ bytes: Buffer; type: ImageType }> {
  const type = detectImageType(bytes);
  if (!type) throw new ImageError("The photo must be a JPG, PNG or WebP image.");
  try {
    const picture = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false })
      .rotate() // apply the orientation tag, which is then dropped with the rest
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    const encoded =
      type.extension === "png" ? picture.png()
      : type.extension === "webp" ? picture.webp({ quality: QUALITY })
      : picture.jpeg({ quality: QUALITY });
    // No withMetadata / keepExif call: sharp writes none of the input's metadata.
    return { bytes: await encoded.toBuffer(), type };
  } catch {
    // The library's message may describe the file's insides; the sender gets a general one.
    throw new ImageError();
  }
}
