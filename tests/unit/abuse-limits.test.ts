import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EMERGENCY_REPORT_LIMIT, LIMIT_WINDOW_MS, PHOTO_UPLOAD_LIMIT, REPORT_LIMIT, UNATTACHED_KEEP_MS,
  countInWindow, mayRemoveUpload, photoLimitProblem, reportLimitProblem, unattachedBefore, windowStart,
} from "../../lib/abuse-limits";
import { detectImageType } from "../../lib/image-rules";
import { ImageError, MAX_EDGE, reencode } from "../../lib/server/image";

const NOW = new Date("2026-11-28T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("limits on fault reports", () => {
  it("FR-12: a resident can submit ten reports in any 24 hours", () => {
    expect(REPORT_LIMIT).toBe(10);
    for (let n = 0; n < 10; n++) expect(reportLimitProblem(n, "normal"), String(n)).toBeNull();
    expect(reportLimitProblem(10, "normal")).toMatch(/at most 10 fault reports in 24 hours/);
    expect(reportLimitProblem(10, "urgent")).toMatch(/at most 10/);
    expect(reportLimitProblem(25, "normal")).toMatch(/at most 10/);
  });
  it("FR-12: an emergency is still accepted beyond the limit, up to twice the limit", () => {
    expect(EMERGENCY_REPORT_LIMIT).toBe(20);
    for (const n of [10, 15, 19]) expect(reportLimitProblem(n, "emergency"), String(n)).toBeNull();
    expect(reportLimitProblem(20, "emergency")).toMatch(/limit also for emergencies/);
    expect(reportLimitProblem(30, "emergency")).toMatch(/limit also for emergencies/);
  });
  it("FR-12: the refusal of a routine report says that an emergency can still be reported", () => {
    expect(reportLimitProblem(10, "normal")).toMatch(/emergency can still be reported/);
  });
  it("FR-12: an unknown classification is treated like a routine one", () => {
    expect(reportLimitProblem(10, "whatever")).toMatch(/at most 10/);
    expect(reportLimitProblem(10, "")).toMatch(/at most 10/);
  });
  it("FR-12: the 24 hours are counted back from now, to the millisecond", () => {
    expect(LIMIT_WINDOW_MS).toBe(24 * 3600_000);
    expect(windowStart(NOW)).toBe("2026-11-27T12:00:00.000Z");
    expect(countInWindow([hoursAgo(1), hoursAgo(23.99), hoursAgo(24), hoursAgo(30)], NOW)).toBe(2);
    expect(countInWindow([], NOW)).toBe(0);
  });
});

describe("limits on photo uploads", () => {
  it("FR-12: a resident can upload twenty photos of one kind in any 24 hours", () => {
    expect(PHOTO_UPLOAD_LIMIT).toBe(20);
    expect(photoLimitProblem(0)).toBeNull();
    expect(photoLimitProblem(19)).toBeNull();
    expect(photoLimitProblem(20)).toMatch(/at most 20 photos in 24 hours/);
    expect(photoLimitProblem(21)).toMatch(/at most 20/);
  });
});

describe("uploads that were never attached", () => {
  it("SEC-08: an upload is removed only when it is a day old and the database says nothing refers to it", () => {
    expect(UNATTACHED_KEEP_MS).toBe(24 * 3600_000);
    expect(mayRemoveUpload(hoursAgo(25), false, NOW)).toBe(true);
    expect(mayRemoveUpload(hoursAgo(24), false, NOW)).toBe(true);
    expect(mayRemoveUpload(hoursAgo(23.9), false, NOW)).toBe(false); // somebody may still be filling in the form
    expect(mayRemoveUpload(hoursAgo(1000), true, NOW)).toBe(false); // attached: never
  });
  it("SEC-08: when the database could not answer, the file is kept", () => {
    expect(mayRemoveUpload(hoursAgo(1000), null, NOW)).toBe(false);
  });
  it("SEC-08: the clean-up looks only at files uploaded more than a day ago", () => {
    expect(unattachedBefore(NOW)).toBe("2026-11-27T12:00:00.000Z");
  });
});

describe("re-encoding an upload", () => {
  /** A small picture with EXIF data, among it a GPS position, as a phone would write it. */
  const withHiddenData = (format: "jpeg" | "webp" | "png", size = { width: 64, height: 48 }) =>
    sharp({ create: { ...size, channels: 3, background: { r: 200, g: 60, b: 20 } } })
      .withExif({
        IFD0: { Make: "TestPhoneMaker", Model: "Secret Model 9", Copyright: "Jonas Jonaitis" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "54/1 53/1 5000/100", GPSLongitudeRef: "E", GPSLongitude: "23/1 53/1 1000/100" },
      })
      [format]()
      .toBuffer();

  it("SEC-08: the test picture really carries the hidden data before re-encoding", async () => {
    const original = await withHiddenData("jpeg");
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(original.toString("latin1")).toContain("TestPhoneMaker");
  });
  it("SEC-08: a re-encoded JPEG, WebP or PNG has no EXIF data, so no GPS position, device or name", async () => {
    for (const format of ["jpeg", "webp", "png"] as const) {
      const out = await reencode(await withHiddenData(format));
      const meta = await sharp(out.bytes).metadata();
      expect(meta.exif, format).toBeUndefined();
      expect(meta.icc, format).toBeUndefined();
      expect(meta.xmp, format).toBeUndefined();
      const text = out.bytes.toString("latin1");
      for (const hidden of ["TestPhoneMaker", "Secret Model 9", "Jonas Jonaitis", "GPS"]) expect(text, `${format} ${hidden}`).not.toContain(hidden);
    }
  });
  it("SEC-08: the format is kept and the result is what its first bytes say", async () => {
    for (const [format, mime] of [["jpeg", "image/jpeg"], ["webp", "image/webp"], ["png", "image/png"]] as const) {
      const out = await reencode(await withHiddenData(format));
      expect(out.type.mime).toBe(mime);
      expect(detectImageType(out.bytes)?.mime).toBe(mime);
      expect((await sharp(out.bytes).metadata()).width).toBe(64);
    }
  });
  it("SEC-08: a picture lying on its side is turned upright, and the orientation tag is gone", async () => {
    const sideways = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#888" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const meta = await sharp((await reencode(sideways)).bytes).metadata();
    expect([meta.width, meta.height]).toEqual([40, 80]);
    expect(meta.orientation).toBeUndefined();
  });
  it("SEC-08: a very large picture is scaled down; a small one is not enlarged", async () => {
    const large = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#444" } }).jpeg().toBuffer();
    const meta = await sharp((await reencode(large)).bytes).metadata();
    expect([meta.width, meta.height]).toEqual([MAX_EDGE, MAX_EDGE / 2]);
    expect((await sharp((await reencode(await withHiddenData("png"))).bytes).metadata()).height).toBe(48);
  });
  it("SEC-08: a file that only starts like a picture is refused with a general message", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("<script>alert(1)</script> not a picture at all")]);
    await expect(reencode(fake)).rejects.toBeInstanceOf(ImageError);
    await expect(reencode(fake)).rejects.toThrow("The photo could not be read. Please choose another one.");
  });
  it("SEC-08: a file that is no picture is refused before decoding", async () => {
    await expect(reencode(new Uint8Array(Buffer.from("%PDF-1.7 hello")))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(reencode(new Uint8Array())).rejects.toBeInstanceOf(ImageError);
  });
  it("SEC-08: a truncated picture is refused", async () => {
    const whole = await withHiddenData("jpeg", { width: 400, height: 300 });
    await expect(reencode(whole.subarray(0, Math.floor(whole.length / 2)))).rejects.toBeInstanceOf(ImageError);
  });
});
