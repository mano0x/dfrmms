import { describe, expect, it } from "vitest";
import {
  canAssign, canCreateReport, canEditReport, canOverridePriority, canSetStatus, canViewReport, canWriteNote,
  type Actor, type ReportAccessFields,
} from "../../lib/access";
import { MAX_UPLOAD_BYTES, detectImageType, photoBelongsTo, photoFileName, validateUpload } from "../../lib/image-rules";

const admin: Actor = { id: "a1", name: "Asta", role: "admin" };
const tomas: Actor = { id: "t1", name: "Tomas", role: "technician" };
const rasa: Actor = { id: "t2", name: "Rasa", role: "technician" };
const jonas: Actor = { id: "s1", name: "Jonas", role: "student" };
const ieva: Actor = { id: "s2", name: "Ieva", role: "student" };

const report = (over: Partial<ReportAccessFields> = {}): ReportAccessFields => ({
  studentId: "s1", status: "open", assignedTo: null, assignedToId: null, priorityOverridden: false, ...over,
});
const assigned = (over: Partial<ReportAccessFields> = {}) => report({ status: "in-progress", assignedTo: "Tomas", assignedToId: "t1", ...over });

describe("viewing reports", () => {
  it("lets staff view any report", () => {
    expect(canViewReport(admin, report())).toBe(true);
    expect(canViewReport(tomas, report())).toBe(true);
  });
  it("lets a resident view only their own reports", () => {
    expect(canViewReport(jonas, report())).toBe(true);
    expect(canViewReport(ieva, report())).toBe(false);
  });
});

describe("creating and editing reports", () => {
  it("lets only residents create reports", () => {
    expect(canCreateReport(jonas)).toBe(true);
    expect(canCreateReport(tomas)).toBe(false);
    expect(canCreateReport(admin)).toBe(false);
  });
  it("lets the owner edit an open, unassigned, untriaged report", () => {
    expect(canEditReport(jonas, report())).toBe(true);
  });
  it("blocks edits by anyone else", () => {
    expect(canEditReport(ieva, report())).toBe(false);
    expect(canEditReport(admin, report())).toBe(false);
    expect(canEditReport(tomas, report())).toBe(false);
  });
  it("blocks edits once the report is assigned, triaged or no longer open", () => {
    expect(canEditReport(jonas, assigned({ status: "open" }))).toBe(false);
    expect(canEditReport(jonas, report({ assignedTo: "Tomas" }))).toBe(false);
    expect(canEditReport(jonas, report({ priorityOverridden: true }))).toBe(false);
    expect(canEditReport(jonas, report({ status: "in-progress" }))).toBe(false);
    expect(canEditReport(jonas, report({ status: "closed" }))).toBe(false);
  });
});

describe("changing status", () => {
  // Changed on purpose in module B3 (decision D6): work starts only through a verified visit, never through a status change.
  it("FR-14: lets the assigned technician follow the technician workflow", () => {
    expect(canSetStatus(tomas, assigned(), "resolved")).toBe(true);
    expect(canSetStatus(tomas, assigned({ status: "resolved" }), "assigned")).toBe(true);
  });
  it("FR-V: the assigned technician cannot declare that work has started", () => {
    expect(canSetStatus(tomas, assigned({ status: "assigned" }), "in-progress")).toBe(false);
    expect(canSetStatus(tomas, assigned({ status: "resolved" }), "in-progress")).toBe(false);
    expect(canSetStatus(tomas, assigned({ status: "open" }), "in-progress")).toBe(false);
    expect(canSetStatus(admin, assigned({ status: "assigned" }), "in-progress")).toBe(false);
  });
  it("FR-14: blocks a technician from closing, skipping a step, or touching other reports", () => {
    expect(canSetStatus(tomas, assigned(), "closed")).toBe(false);
    expect(canSetStatus(tomas, assigned({ status: "assigned" }), "resolved")).toBe(false);
    expect(canSetStatus(rasa, assigned(), "resolved")).toBe(false);
    expect(canSetStatus(tomas, report(), "assigned")).toBe(false); // unassigned
  });
  it("FR-14: recognises older reports assigned by name only", () => {
    const legacy = report({ status: "in-progress", assignedTo: "Tomas", assignedToId: null });
    expect(canSetStatus(tomas, legacy, "resolved")).toBe(true);
    expect(canSetStatus(rasa, legacy, "resolved")).toBe(false);
  });
  it("FR-20: lets an administrator follow the administrator workflow on any report", () => {
    expect(canSetStatus(admin, report(), "closed")).toBe(true);
    expect(canSetStatus(admin, report({ status: "closed" }), "open")).toBe(true);
    expect(canSetStatus(admin, assigned({ status: "closed" }), "assigned")).toBe(true); // reopened: waits with its technician
    expect(canSetStatus(admin, assigned({ status: "closed" }), "open")).toBe(false);
    expect(canSetStatus(admin, report(), "resolved")).toBe(false); // not a valid step
    expect(canSetStatus(admin, report(), "archived")).toBe(false);
  });
  it("never lets a resident change the status", () => {
    expect(canSetStatus(jonas, report(), "closed")).toBe(false);
    expect(canSetStatus(jonas, report(), "in-progress")).toBe(false);
  });
});

describe("assignment, triage and notes", () => {
  it("lets only administrators assign, and not on closed reports", () => {
    expect(canAssign(admin, report())).toBe(true);
    expect(canAssign(admin, report({ status: "closed" }))).toBe(false);
    expect(canAssign(tomas, report())).toBe(false);
    expect(canAssign(jonas, report())).toBe(false);
  });
  it("lets only administrators change the priority", () => {
    expect(canOverridePriority(admin)).toBe(true);
    expect(canOverridePriority(tomas)).toBe(false);
    expect(canOverridePriority(jonas)).toBe(false);
  });
  it("lets the assigned technician or an administrator write the resolution note", () => {
    expect(canWriteNote(tomas, assigned())).toBe(true);
    expect(canWriteNote(admin, assigned())).toBe(true);
    expect(canWriteNote(rasa, assigned())).toBe(false);
    expect(canWriteNote(jonas, assigned())).toBe(false);
    expect(canWriteNote(tomas, assigned({ status: "closed" }))).toBe(false);
  });
});

describe("photo upload checks", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const text = (s: string) => new TextEncoder().encode(s);

  it("recognises JPEG, PNG and WebP by their content", () => {
    expect(detectImageType(jpeg)?.mime).toBe("image/jpeg");
    expect(detectImageType(png)?.mime).toBe("image/png");
    expect(detectImageType(webp)?.mime).toBe("image/webp");
  });
  it("rejects content that is not one of those image types, whatever it is called", () => {
    expect(detectImageType(text("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(detectImageType(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImageType(text("%PDF-1.7"))).toBeNull();
    expect(detectImageType(text("GIF89a"))).toBeNull();
    expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // RIFF but WAVE
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // too short
  });
  it("rejects empty and oversized uploads", () => {
    expect(validateUpload(new Uint8Array(0))).toMatch(/empty/);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(validateUpload(big)).toMatch(/too large/);
    expect(validateUpload(jpeg)).toBeNull();
    expect(validateUpload(text("not an image"))).toMatch(/JPG, PNG or WebP/);
  });
  it("ties a stored photo to its uploader through the file name", () => {
    const name = photoFileName("s1", "jpg", 1700000000000);
    expect(name).toBe("s1__1700000000000.jpg");
    expect(photoBelongsTo(name, "s1")).toBe(true);
    expect(photoBelongsTo(name, "s2")).toBe(false);
    expect(photoBelongsTo(name, "s")).toBe(false); // a prefix of another ID does not match
  });
});
