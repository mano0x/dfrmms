import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en, message, placeholdersOf, type MessageKey } from "../../lib/messages/en";
import { lt } from "../../lib/messages/lt";
import { STATUS_VALUES } from "../../lib/maintenance";
import { HELP_QUESTIONS, helpFor, inVilnius, roleWord, statusWord, whatHappensNext, type Progress } from "../../lib/plain-words";
import { codeVoidMessage, notificationsForChanges, type ReportChange } from "../../lib/report-notifications";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const report = (over: Partial<Progress> = {}): Progress => ({
  status: "open", createdAt: "2026-11-10T08:00:00.000Z", priority: "high", resolvedAt: null, assignedTo: null, locationType: "room", area: null, ...over,
});
const keys = Object.keys(en) as MessageKey[];

describe("plain words for a status", () => {
  it("FR-UX-23: a resident reads plain words for every status", () => {
    expect(statusWord("open", "student")).toBe("Waiting for a technician");
    expect(statusWord("assigned", "student")).toBe("Technician assigned");
    expect(statusWord("in-progress", "student")).toBe("Being repaired");
    expect(statusWord("resolved", "student")).toBe("Repaired: please confirm");
    expect(statusWord("closed", "student")).toBe("Closed");
  });
  it("FR-UX-23: staff keep the short working words", () => {
    for (const reader of ["technician", "admin"] as const) {
      expect(STATUS_VALUES.map((s) => statusWord(s, reader))).toEqual(["Open", "Assigned", "In progress", "Resolved", "Closed"]);
    }
  });
  it("FR-UX-23: every stored status has a word for both kinds of reader, in both languages", () => {
    for (const status of STATUS_VALUES) {
      for (const reader of ["student", "admin"] as const) {
        for (const messages of [en, lt]) expect(statusWord(status, reader, messages).length, `${status} ${reader}`).toBeGreaterThan(3);
      }
    }
  });
  it("FR-UX-23: only words change: an unknown or missing status is shown as it is, never guessed", () => {
    expect(statusWord("archived", "student")).toBe("archived");
    expect(statusWord(null, "student")).toBe("—");
    expect(statusWord(undefined, "admin")).toBe("—");
  });
  it("FR-UX-23: someone whose role is not known is shown the resident's words, never the staff's", () => {
    expect(statusWord("open", null)).toBe("Waiting for a technician");
    expect(roleWord("admin", undefined)).toBe("Dormitory office");
  });
});

describe("what happens next", () => {
  it("FR-UX-23: an open report says who acts next and gives the report's real target time", () => {
    // High priority: 24 hours after 08:00 UTC on 10 November, which is 10:00 in Vilnius on the 11th.
    expect(whatHappensNext(report(), NOW)).toBe("The dormitory office will choose a technician. Target: fixed by 11 Nov, 10:00.");
    expect(whatHappensNext(report({ priority: "critical" }), new Date("2026-11-10T09:00:00.000Z"))).toContain("Target: fixed by 10 Nov, 14:00.");
    expect(whatHappensNext(report({ priority: "low" }), NOW)).toContain("17 Nov, 10:00");
  });
  it("FR-UX-23: once the target has passed, the text says so plainly instead of promising it", () => {
    const late = whatHappensNext(report(), new Date("2026-11-11T08:00:00.001Z"));
    expect(late).toBe("The dormitory office will choose a technician. The target of 11 Nov, 10:00 has passed. The dormitory office can see that it is late.");
    expect(whatHappensNext(report(), new Date("2026-11-11T08:00:00.000Z"))).toContain("Target: fixed by"); // exactly at the target: not late yet
  });
  it("FR-UX-23: an assigned report names the technician and says what the resident has to do", () => {
    const room = whatHappensNext(report({ status: "assigned", assignedTo: "Tomas Tomaitis" }), NOW);
    expect(room).toMatch(/^Tomas Tomaitis will come to your room\. When they are at your door, open this report and make a visit code\. Target: fixed by/);
    const shared = whatHappensNext(report({ status: "assigned", assignedTo: "Tomas Tomaitis", locationType: "shared", area: "kitchen" }), NOW);
    expect(shared).toMatch(/^Tomas Tomaitis will go to the shared area\. You do not need to be there\./);
    expect(shared).not.toContain("visit code");
    expect(whatHappensNext(report({ status: "assigned" }), NOW)).toMatch(/^The technician will come/);
  });
  it("FR-UX-23: work in progress still shows the target", () => {
    expect(whatHappensNext(report({ status: "in-progress" }), NOW)).toBe("The technician marks the report as repaired when the work is done. Target: fixed by 11 Nov, 10:00.");
  });
  it("FR-UX-23: a repaired report asks for the answer and gives the real closing date", () => {
    const text = whatHappensNext(report({ status: "resolved", resolvedAt: "2026-11-12T09:30:00.000Z" }), NOW);
    expect(text).toBe("Open the report and say whether the fault is fixed. Without an answer it closes on 19 Nov, 11:30.");
  });
  it("FR-UX-23: a report repaired before the seven-day rule gives no date, because there is none", () => {
    expect(whatHappensNext(report({ status: "resolved", resolvedAt: null }), NOW)).toBe("Open the report and say whether the fault is fixed.");
  });
  it("FR-UX-23: a closed report shows no target and says what to do if the fault comes back", () => {
    const text = whatHappensNext(report({ status: "closed" }), NOW);
    expect(text).toBe("Nothing more happens here. If the fault comes back, send a new report.");
    expect(text).not.toMatch(/Target|passed/);
  });
  it("FR-UX-23: no text invents a duration: no \"within\", \"about\", \"soon\", hours or days", () => {
    for (const status of STATUS_VALUES) {
      for (const messages of [en]) {
        const text = whatHappensNext(report({ status, assignedTo: "Tomas", resolvedAt: "2026-11-12T09:30:00.000Z" }), NOW, messages);
        expect(text, status).not.toMatch(/\b(within|about|around|soon|shortly|usually|hours?|days?|minutes?)\b/i);
      }
    }
  });
  it("FR-UX-23: an unknown status gives no text rather than a wrong one, and a broken date gives no target", () => {
    expect(whatHappensNext(report({ status: "archived" }), NOW)).toBe("");
    expect(whatHappensNext(report({ createdAt: "not a date" }), NOW)).toBe("The dormitory office will choose a technician.");
  });
  it("NFR-09: the Lithuanian draft says the same things, with the same real date", () => {
    const text = whatHappensNext(report(), NOW, lt, "lt-LT");
    expect(text).toMatch(/^Bendrabučio administracija paskirs meistrą\. Tikslas: sutaisyti iki /);
    expect(text).toContain("10:00");
  });
  it("FR-UX-23: times are given in the dormitory's time zone, also in summer", () => {
    expect(inVilnius(new Date("2026-11-11T08:00:00.000Z"))).toBe("11 Nov, 10:00"); // winter: two hours ahead of UTC
    expect(inVilnius(new Date("2026-07-01T08:00:00.000Z"))).toBe("1 Jul, 11:00"); // summer: three hours ahead
  });
});

describe("who is who", () => {
  it("FR-UX-24: a resident reads \"Dormitory office\" where staff read \"Administrator\"", () => {
    expect(roleWord("admin", "student")).toBe("Dormitory office");
    expect(roleWord("admin", "admin")).toBe("Administrator");
    expect(roleWord("admin", "technician")).toBe("Administrator");
    expect(roleWord("technician", "student")).toBe("Technician");
    expect(roleWord("student", "student")).toBe("Resident");
    expect(roleWord(null, "student")).toBe("");
  });
  it("FR-UX-24: no text written for residents contains the word \"administrator\"", () => {
    const forResidents = keys.filter((k) => /^(status\.resident|next|role\.forResident|help\.student|empty\.reports|empty\.free|empty\.neighbour|empty\.notifications|office|error\.noRoom|help\.contact|help\.sample|help\.subtitle)/.test(k));
    expect(forResidents.length).toBeGreaterThan(35);
    for (const key of forResidents) expect(en[key], key).not.toMatch(/administrator|administration|\badmin\b/i);
  });
  it("FR-UX-24: no message sent to a resident about a report contains the word \"administrator\"", () => {
    const parties = { title: "Lamp", studentId: "s1", dormitory: "Dormitory A", roomNumber: "204", assignedToId: "t1" };
    const types: ReportChange["type"][] = ["status", "assignment", "priority", "note", "confirmed", "not-fixed", "visit-verified", "entered-in-absence", "emergency-entry", "entry-authorised", "no-access"];
    const toResident = types.flatMap((type) => notificationsForChanges([{ type, from: "assigned", to: "in-progress" }], { ...parties, assignedToId: null }, parties, "a1").filter((o) => o.userId === "s1"));
    toResident.push(...notificationsForChanges([{ type: "confirmed", from: "resolved", to: "closed" }], parties, parties, "system").filter((o) => o.userId === "s1"), codeVoidMessage(parties));
    expect(toResident.length).toBeGreaterThan(8);
    for (const out of toResident) expect(`${out.message.title} ${out.message.body}`).not.toMatch(/administrator/i);
  });
  it("FR-UX-24: no page or component a resident uses contains the word \"administrator\" in its text", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".tsx")) files.push(path);
      }
    };
    walk("app/student");
    files.push("components/RepairAnswer.tsx", "components/VisitCode.tsx", "components/LocationChoice.tsx", "components/notices.tsx", "app/help/page.tsx");
    expect(files.length).toBeGreaterThan(6);
    for (const file of files) {
      const text = readFileSync(file, "utf8")
        .split(/\r?\n/)
        // Comments and code that only names the role are not text a resident reads.
        .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) && !/role === "admin"|removedBy === "admin"|"admin"\s*[,\]|)]/.test(line))
        .join("\n");
      expect(text, file).not.toMatch(/administrator|the administration/i);
    }
  });
});

describe("help", () => {
  it("FR-UX-25: each role has five common questions, every answer marked SAMPLE", () => {
    expect(HELP_QUESTIONS).toBe(5);
    for (const role of ["student", "technician", "admin"] as const) {
      for (const messages of [en, lt]) {
        const items = helpFor(role, messages);
        expect(items).toHaveLength(5);
        for (const item of items) {
          expect(item.question.length, role).toBeGreaterThan(10);
          expect(item.answer, role).toMatch(/^SAMPLE: /);
        }
      }
    }
  });
  it("FR-UX-25: a role's help holds that role's questions only", () => {
    expect(helpFor("student")[0].question).toBe("How do I report a fault?");
    expect(JSON.stringify(helpFor("student"))).not.toMatch(/administrator|Security events|Create user/);
    expect(JSON.stringify(helpFor("technician"))).not.toMatch(/Security events|Create user/);
  });
  it("FR-UX-25: the contact text invents no phone number or address; the one fixed line is about 112", () => {
    expect(en["help.contact.body"]).toMatch(/^SAMPLE: /);
    expect(en["help.contact.body"]).not.toMatch(/\d/);
    expect(en["help.emergency"]).toBe("If you are in danger, leave and call 112.");
    const helpTexts = keys.filter((k) => k.startsWith("help.")).map((k) => en[k]).join(" ");
    expect(helpTexts.replace(/112/g, "")).not.toMatch(/\d{3,}/); // no other number anywhere in the help texts
  });
});

describe("the texts in both languages", () => {
  it("NFR-09: the Lithuanian file has every key of the English one and no other", () => {
    expect(Object.keys(lt).sort()).toEqual(Object.keys(en).sort());
  });
  it("NFR-09: both languages use the same placeholders in every text", () => {
    for (const key of keys) expect(placeholdersOf(lt[key]), key).toEqual(placeholdersOf(en[key]));
  });
  it("NFR-09: no Lithuanian text is empty or left in English", () => {
    for (const key of keys) {
      expect(lt[key].trim().length, key).toBeGreaterThan(0);
      if (en[key].length > 20) expect(lt[key], key).not.toBe(en[key]);
    }
  });
  it("FR-UX-20: every empty list has a title and a text that says what appears there and when", () => {
    const bodies = keys.filter((k) => k.startsWith("empty.") && !k.endsWith(".title"));
    expect(bodies.length).toBeGreaterThanOrEqual(18);
    for (const key of bodies) expect(en[key], key).toMatch(/appears here when|report it/);
    for (const key of keys.filter((k) => k.startsWith("empty.") && k.endsWith(".title"))) {
      const stem = key.replace(/\.title$/, "");
      expect(keys.some((k) => k !== key && k.startsWith(`${stem}.`)), key).toBe(true);
    }
    expect(message("empty.neighbour.board.body", { dormitory: "Dormitory A" })).toContain("for Dormitory A.");
  });
});
