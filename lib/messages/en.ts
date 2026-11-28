/**
 * Texts the application shows, in English, in one place. Pure.
 *
 * New code takes its texts from here instead of writing them inside a page
 * or a server function, so that a second language is a second file with the
 * same keys (lib/messages/lt.ts) and not a search through the code. Older
 * modules are moved here step by step.
 *
 * A text may contain placeholders in braces, for example {max}.
 *
 * Words for residents: a resident never reads "administrator". The people
 * who run the dormitory are "the dormitory office" to them (module U0).
 * Help texts marked SAMPLE are examples for the owner to replace.
 */
export const en = {
  "error.notSignedIn": "You are not signed in.",
  "error.noPermission": "You do not have permission to do this.",
  "error.otherSite": "Request blocked: it did not come from this site.",
  "error.unexpected": "Something went wrong. Please try again.",
  "error.invalidRequest": "Invalid request.",
  "error.notFound": "{what} not found.",
  "error.noRoom": "You have no room in a dormitory at the moment, so {what}. Contact the dormitory office.",
  "limit.reached": "You can {what} at most {max} times in one {period}. Please try again later.",
  "events.title": "Security events",
  "events.subtitle": "What happened in the system that matters for security. Entries cannot be changed or removed.",
  "events.empty": "An entry appears here when somebody signs in, is refused, or uses special access. No entry matches the filter you chose.",
  "events.more": "Show older events",
  "events.own.title": "Access to your data",
  "events.own.empty": "Nobody has used special access to look at your data.",

  /* ---- Who is who, in the words each reader sees ---- */
  "office.name": "the dormitory office",
  "role.forResident.student": "Resident",
  "role.forResident.technician": "Technician",
  "role.forResident.admin": "Dormitory office",
  "role.forStaff.student": "Resident",
  "role.forStaff.technician": "Technician",
  "role.forStaff.admin": "Administrator",

  /* ---- The status of a report, in plain words for the resident ---- */
  "status.resident.open": "Waiting for a technician",
  "status.resident.assigned": "Technician assigned",
  "status.resident.in-progress": "Being repaired",
  "status.resident.resolved": "Repaired: please confirm",
  "status.resident.closed": "Closed",
  "status.staff.open": "Open",
  "status.staff.assigned": "Assigned",
  "status.staff.in-progress": "In progress",
  "status.staff.resolved": "Resolved",
  "status.staff.closed": "Closed",

  /* ---- What happens next, for the resident ---- */
  "next.open": "The dormitory office will choose a technician.",
  "next.assigned.room": "{technician} will come to your room. When they are at your door, open this report and make a visit code.",
  "next.assigned.shared": "{technician} will go to the shared area. You do not need to be there.",
  "next.in-progress": "The technician marks the report as repaired when the work is done.",
  "next.resolved": "Open the report and say whether the fault is fixed.",
  "next.resolved.deadline": "Open the report and say whether the fault is fixed. Without an answer it closes on {date}.",
  "next.closed": "Nothing more happens here. If the fault comes back, send a new report.",
  "next.target": "Target: fixed by {date}.",
  "next.overdue": "The target of {date} has passed. The dormitory office can see that it is late.",
  "next.technician": "The technician",

  /* ---- Empty lists: what will appear here, and what causes it ---- */
  "empty.reports.mine.title": "You have no reports yet",
  "empty.reports.mine.body": "When something breaks in your room or in a shared area, report it. Your report then appears here with its progress.",
  "empty.reports.filter.title": "No report has this status",
  "empty.reports.filter.body": "A report appears here when its status matches the filter you chose. Choose \"All\" to see every report.",
  "empty.tech.assigned.title": "No reports are assigned to you",
  "empty.tech.assigned.body": "A report appears here when an administrator assigns it to you. You are also told by a notification.",
  "empty.tech.filter.title": "No report has this status",
  "empty.tech.filter.body": "A report appears here when its status matches the filter you chose. Choose \"All statuses\" to see every report.",
  "empty.admin.reports.title": "No reports match",
  "empty.admin.reports.body": "A report appears here when a resident submits one. Clear the search and the filters to see all reports.",
  "empty.notifications.title": "No notifications",
  "empty.notifications.body": "A message appears here when something happens to one of your reports, notices or items, for example when a technician is assigned.",
  "empty.free.board.title": "Nothing on offer right now",
  "empty.free.board.body": "An item appears here when another resident of your dormitory gives something away.",
  "empty.free.mine.title": "You have not offered anything yet",
  "empty.free.mine.body": "An item appears here when you publish one under \"Give something away\".",
  "empty.free.reservations.title": "No reservations",
  "empty.free.reservations.body": "An item appears here when you reserve it, with where and when to collect it.",
  "empty.neighbour.mine.title": "No notices yet",
  "empty.neighbour.mine.body": "A notice appears here when you send one, with what the dormitory office did about it.",
  "empty.neighbour.board.title": "Nothing on the board",
  "empty.neighbour.board.body": "A notice appears here when the dormitory office publishes one for {dormitory}.",
  "empty.admin.free.title": "No items here",
  "empty.admin.free.body": "An item appears here when a resident publishes one.",
  "empty.admin.free.filter": "An item appears here when it matches the filter you chose. Choose \"All\" to see every item.",
  "empty.admin.neighbour.title": "No notices here",
  "empty.admin.neighbour.open": "A notice appears here when a resident sends one. Nothing is waiting for you now.",
  "empty.admin.neighbour.filter": "A notice appears here when it matches the filter you chose.",
  "empty.accommodation.allocations.title": "No allocations",
  "empty.accommodation.allocations.body": "A line appears here when you give a resident a room. Add dormitories and rooms first.",
  "empty.accommodation.rooms.title": "No rooms here",
  "empty.accommodation.rooms.body": "A room appears here when you add it with the form. Add a dormitory first.",
  "empty.accommodation.rooms.filter": "A room appears here when it matches the filter you chose.",
  "empty.accommodation.dormitories.title": "No dormitories yet",
  "empty.accommodation.dormitories.body": "A dormitory appears here when you add it with the form. Everything else starts with it.",
  "empty.accommodation.roomTypes.title": "No room types yet",
  "empty.accommodation.roomTypes.body": "A room type appears here when you add it with the form. Each room needs one.",

  /* ---- Help ---- */
  "help.title": "Help",
  "help.subtitle": "Common questions, and how to reach the dormitory office.",
  "help.sample": "SAMPLE text. The dormitory office replaces it with its own.",
  "help.contact.title": "How to reach the dormitory office",
  "help.contact.body": "SAMPLE: the dormitory office has not entered its contact details yet.",
  "help.emergency": "If you are in danger, leave and call 112.",

  "help.student.q1": "How do I report a fault?",
  "help.student.a1": "SAMPLE: Open \"Fault reports\", choose \"Report a fault\", say where the fault is and describe it. A photo helps.",
  "help.student.q2": "How do I know what is happening with my report?",
  "help.student.a2": "SAMPLE: Open \"My reports\". Each report shows its status in plain words and what happens next. You also get a notification at every step.",
  "help.student.q3": "A technician is at my door. How do I know it is the right person?",
  "help.student.a3": "SAMPLE: Open your report and make a visit code. Tell it to the technician. Only the technician assigned to your report can make it work.",
  "help.student.q4": "The repair is done but the fault is still there. What now?",
  "help.student.a4": "SAMPLE: Open the report and choose \"No, it is not fixed\". Say what is still wrong. The report goes back to the technician.",
  "help.student.q5": "Who can see my report?",
  "help.student.a5": "SAMPLE: You, the technicians and the dormitory office. Other residents cannot see it.",

  "help.technician.q1": "Where do I find my work?",
  "help.technician.a1": "SAMPLE: \"Work queue\" lists the reports assigned to you. You get a notification when a new one is assigned.",
  "help.technician.q2": "How do I start work on a report?",
  "help.technician.a2": "SAMPLE: At the door, ask the resident for the visit code and type it in. For a shared area you start with one button.",
  "help.technician.q3": "The resident is not there. What do I do?",
  "help.technician.a3": "SAMPLE: If the resident allowed entry in their absence, you can enter and it is recorded. Otherwise record \"no access\".",
  "help.technician.q4": "How do I finish a report?",
  "help.technician.a4": "SAMPLE: Write a short note of what you did and mark the report as resolved. The resident then confirms.",
  "help.technician.q5": "The resident says it is not fixed. What happens?",
  "help.technician.a5": "SAMPLE: The report comes back to you as \"Assigned\" with the resident's reason in its history. A new visit needs a new code.",

  "help.admin.q1": "What should I do first every day?",
  "help.admin.a1": "SAMPLE: Look at new reports without a technician and at overdue reports, and assign or follow them up.",
  "help.admin.q2": "How do I add a resident?",
  "help.admin.a2": "SAMPLE: Under \"Fault reports\", open \"Create user\", choose the role and, for a resident, the room.",
  "help.admin.q3": "How do I give a report to a technician?",
  "help.admin.a3": "SAMPLE: Choose the technician in the report's line or in its details. The technician and the resident are told.",
  "help.admin.q4": "A resident is away and the fault cannot wait. What can I do?",
  "help.admin.a4": "SAMPLE: Open the report and authorise emergency entry with a reason. The resident sees the reason and is told.",
  "help.admin.q5": "Where do I see who did what?",
  "help.admin.a5": "SAMPLE: Each report has its history. \"Security events\" lists sign-ins, refusals and special access.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

/** The text for a key, with its placeholders filled in. A placeholder without a value is left as it is. */
export function message(key: MessageKey, values: Record<string, string | number> = {}, messages: Messages = en): string {
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** The placeholders a text contains, for checking that two languages agree. */
export const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
