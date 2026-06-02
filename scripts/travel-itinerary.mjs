import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as chrono from "chrono-node";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , ...cliArgs] = process.argv;

// Parses simple path flags so the same generator can build shared and user-scoped itineraries.
function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

// Resolves CLI paths inside the workspace so itinerary generation cannot write elsewhere.
function workspacePath(value, fallback) {
  const raw = value || fallback;
  const resolved = path.resolve(workspace, raw);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Path must stay inside the Orbiter workspace: ${raw}`);
  }
  return resolved;
}

const options = parseArgs(cliArgs);
const travelEmailDir = workspacePath(options["source-folder"], path.join("inbox", "email", "gmail-travel"));
const outputDir = workspacePath(options["output-dir"], path.join("knowledge", "projects", "travel"));
const outputMarkdownPath = workspacePath(options["output-markdown"], path.join(path.relative(workspace, outputDir), "itinerary.md"));
const outputJsonPath = workspacePath(options["output-json"], path.join(".orbiter", "travel-itinerary.json"));
const travelKeywords = [
  "booking",
  "ticket",
  "itinerary",
  "receipt",
  "hotel",
  "agoda",
  "confirmation",
  "voucher",
  "accommodation",
  "flight",
  "air",
  "train",
  "rail",
  "railway",
  "shinkansen",
  "bus",
  "ferry",
  "transfer",
  "transportation",
  "admission",
  "reservation",
  "check-in",
  "check in",
  "check-out",
  "check out",
  "luggage",
  "guest",
  "property",
  "theater",
  "tokyo",
  "kyoto",
  "osaka"
];
const noisyTravelKeywords = [
  "top price drops",
  "selected for you",
  "pack your bags",
  "new deals",
  "welcome gift",
  "birthday sale",
  "today only",
  "only 1 room remains",
  "claim now",
  "we'd love to hear from you",
  "we d love to hear from you"
];

// Parses Orbiter's simple markdown frontmatter into fields plus body.
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return { fields: {}, body: markdown.trim() };
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
    fields[key] = value;
  }

  return { fields, body: markdown.slice(match[0].length).trim() };
}

// Lists travel Gmail markdown records that can feed the itinerary.
async function readTravelEmails() {
  const entries = await readdir(travelEmailDir, { withFileTypes: true }).catch(() => []);
  const emails = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "readme.md") {
      continue;
    }
    const filePath = path.join(travelEmailDir, entry.name);
    const markdown = await readFile(filePath, "utf8");
    const { fields, body } = parseFrontmatter(markdown);
    emails.push({
      title: fields.title || entry.name.replace(/\.md$/, ""),
      from: fields.from || "",
      received: fields.received || "",
      messageId: fields.message_id || "",
      path: path.relative(workspace, filePath).replace(/\\/g, "/"),
      body
    });
  }

  return emails;
}

// Scores whether an imported email is likely to contain travel itinerary material.
function travelScore(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  return travelKeywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

// Filters promotional travel emails that mention destinations but are not plans.
function isPromotional(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  return noisyTravelKeywords.some((keyword) => text.includes(keyword));
}

// Filters account/setup, cancellation, receipt-only, and provider-message emails out of the itinerary.
function isNonItinerary(email) {
  const title = email.title.toLowerCase();
  return [
    "verify your account",
    "welcome gift",
    "has cancelled your booking",
    "customer receipt from booking",
    "notification from agoda",
    "reply from hotel"
  ].some((phrase) => title.includes(phrase));
}

// Extracts provider booking identifiers so cancellations can suppress old reservations.
function bookingId(email) {
  return `${email.title}\n${email.body}`.match(/booking id(?:\s+is|:)?\s*#?\s*(\d{6,})/i)?.[1] ?? email.title.match(/(\d{7,})/)?.[1] ?? "";
}

// Finds booking IDs that have explicit cancellation emails in the imported source set.
function cancelledBookingIds(emails) {
  return new Set(
    emails
      .filter((email) => /cancelled your booking|cancellation of your booking/i.test(`${email.title}\n${email.body}`))
      .map(bookingId)
      .filter(Boolean)
  );
}

// Identifies lodging confirmations from Agoda, hotels, and reservation providers.
function isLodgingConfirmation(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  const providerSignal = /agoda|booking\.com|expedia|hotels\.com|hotel|resort|accommodation|property/.test(text);
  const confirmationSignal = /booking (id|number|confirmed|confirmation)|reservation (id|number|confirmed|confirmation)|confirmation (id|number)|voucher|check[- ]?in|check[- ]?out/.test(text);
  return providerSignal && confirmationSignal;
}

// Identifies train, rail, bus, ferry, and transfer confirmations as transportation.
function isTransportationConfirmation(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  const transportSignal = /\b(train|rail|railway|shinkansen|jr pass|limited express|bus|ferry|transfer|transportation|boarding point|departure station|arrival station)\b/.test(text);
  const ticketSignal = /\b(ticket|booking|reservation|confirmation|voucher|receipt|e-ticket|boarding|passenger)\b/.test(text);
  return transportSignal && ticketSignal;
}

// Identifies airline confirmations without treating every e-ticket as an event.
function isFlightConfirmation(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  return /\b(korean air|flight|airline|boarding pass)\b/.test(text)
    || /travel reservation on\s+\d{1,2}[a-z]{3}/i.test(text)
    || /\bke\s?\d{2,4}\b/i.test(text);
}

// Classifies the itinerary item type using sender/title/body signals.
function classify(email) {
  const text = `${email.title}\n${email.from}\n${email.body}`.toLowerCase();
  if (isLodgingConfirmation(email) || text.includes("hotel") || text.includes("check-in") || text.includes("luggage") || text.includes("booking id")) {
    return "lodging";
  }
  if (text.includes("teamlab") || text.includes("theater") || text.includes("admission")) {
    return "event";
  }
  if (isFlightConfirmation(email)) {
    return "flight";
  }
  if (isTransportationConfirmation(email)) {
    return "transport";
  }
  if (text.includes("ticket")) {
    return "event";
  }
  return "travel";
}

// Pulls a concise location hint from the email text.
function locationHint(email) {
  const text = `${email.title}\n${email.body}`;
  const locations = [
    "Tokyo",
    "Kyoto",
    "Osaka",
    "Seoul",
    "Incheon",
    "Washington",
    "IAD",
    "ICN",
    "Yokohama",
    "Hiroshima",
    "Nara",
    "Sapporo",
    "Fukuoka",
    "Hakone",
    "Kawaguchiko",
    "teamLab Planets",
    "DRUM TAO THEATER KYOTO"
  ];
  return locations.filter((location) => new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)).slice(0, 3).join(", ");
}

// Keeps email-derived titles and snippets compact enough for the UI.
function cleanLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[-*>\s]+/, "")
    .trim()
    .slice(0, 180);
}

// Pulls a likely hotel/property name out of provider confirmations.
function lodgingTitle(email) {
  const text = email.body;
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const ratingTitle = lines.find((line) => /\[image:\s*[0-9.]+\s*stars rating/i.test(line) && !line.startsWith("[image:"));
  if (ratingTitle) {
    return ratingTitle.replace(/\s+\[image:.*$/i, "").trim();
  }

  const lineTitle = lines.find((line) =>
    /hotel|ryokan|onsen|skypark|forza|poco|apa/i.test(line) &&
    !/^from:|^subject:|^https?:|booking confirmation|customer service/i.test(line) &&
    !/^thank you/i.test(line) &&
    !line.includes("Need a flight") &&
    line.length <= 120
  );
  if (lineTitle) {
    return lineTitle.replace(/\s+\[image:.*$/i, "").trim();
  }

  const compactText = String(text ?? "").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const compactMatch = compactText.match(/Manage my booking Manage my booking\s+(.+?)\s+(?:\d{1,5}[,\s]|3F\s|Ashigarashimo|Directions|Check in)/i);
  if (compactMatch?.[1]) {
    return cleanLine(compactMatch[1])
      .replace(/\s+(ã|í|å|æ|ç).+$/i, "")
      .replace(/\s+\d[\d-]*[,\s].*$/i, "")
      .replace(/\s+Ashigarashimo.*$/i, "")
      .replace(/\s+3F\s+.*$/i, "");
  }

  const patterns = [
    /(?:hotel|property|accommodation)\s*(?:name)?\s*[:\-]\s*(.+)/i,
    /(?:you(?:'|’)re|you are) booked at\s+(.+)/i,
    /your booking at\s+(.+?)\s+(?:is|has|was)/i,
    /reservation at\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1];
    if (value) {
      return cleanLine(value);
    }
  }

  return "";
}

// Extracts the most useful action/title for display.
function displayTitle(email, type) {
  if (type === "flight") {
    const flight = email.body.match(/\b[A-Z]{2}\s?\d{2,4}\b/)?.[0];
    const route = email.body.includes("*ICN*") && email.body.includes("*IAD*") ? "ICN to IAD" : "";
    return [flight, route].filter(Boolean).join(" ") || email.title;
  }
  if (type === "transport") {
    const route = email.body.match(/\b[A-Z][A-Za-z .'-]{2,30}\s+(?:to|->|→)\s+[A-Z][A-Za-z .'-]{2,30}\b/)?.[0];
    const service = email.body.match(/\b(?:Shinkansen|JR Pass|Limited Express|Narita Express|Keisei|Romancecar|train|rail|bus|ferry)\b/i)?.[0];
    return [service, route].filter(Boolean).join(" - ") || email.title.replace(/^fwd:\s*/i, "").replace(/^re:\s*/i, "");
  }
  if (email.title.toLowerCase().includes("teamlab")) {
    return "teamLab Planets TOKYO";
  }
  if (email.title.toLowerCase().includes("drum")) {
    return "DRUM TAO THEATER KYOTO";
  }
  if (/^re:\s*booking id/i.test(email.title) || (/apa hotel/i.test(`${email.title}\n${email.body}`) && !/agoda/i.test(`${email.title}\n${email.from}`))) {
    return "APA Hotel luggage/check-in note";
  }
  if (type === "lodging") {
    const hotel = lodgingTitle(email);
    if (hotel) {
      return hotel;
    }
    if (/agoda/i.test(`${email.title}\n${email.from}`)) {
      return `Agoda lodging - ${email.title.replace(/^fwd:\s*/i, "").replace(/^re:\s*/i, "")}`;
    }
  }
  return email.title.replace(/^fwd:\s*/i, "").replace(/^re:\s*/i, "");
}

// Extracts relevant snippets so the itinerary is inspectable without reopening each email.
function importantLines(email) {
  const patterns = [
    /Booking Reference\s*:\s*[A-Z0-9]+/i,
    /Booking (ID|Number|Confirmation)\s*[:#]?\s*.+/i,
    /Confirmation (ID|Number)\s*[:#]?\s*.+/i,
    /Reservation (ID|Number)\s*[:#]?\s*.+/i,
    /Admission date and time:\s*.+/i,
    /Purchase quantity\/Purchase amount:\s*.+/i,
    /\bCheck[- ]?in\b\s*[:\-]?\s*.+/i,
    /\bCheck[- ]?out\b\s*[:\-]?\s*.+/i,
    /Hotel\s*[:\-]?\s*.+/i,
    /Property\s*[:\-]?\s*.+/i,
    /Accommodation\s*[:\-]?\s*.+/i,
    /Address\s*[:\-]?\s*.+/i,
    /Guest(?:s)?\s*[:\-]?\s*.+/i,
    /Room\s*[:\-]?\s*.+/i,
    /Train\s*[:\-]?\s*.+/i,
    /Rail\s*[:\-]?\s*.+/i,
    /Route\s*[:\-]?\s*.+/i,
    /Departure\s*[:\-]?\s*.+/i,
    /Arrival\s*[:\-]?\s*.+/i,
    /Station\s*[:\-]?\s*.+/i,
    /Passenger(?:s)?\s*[:\-]?\s*.+/i,
    /Seat\s*[:\-]?\s*.+/i,
    /Class\s+Economy/i,
    /Seat Number\s+[A-Z0-9]+/i,
    /Free Baggage\s+.+/i,
    /drop off your bags.+/i,
    /check-in is available from.+/i,
    /Opened at\s+\d{1,2}:\d{2}/i,
    /DRUM TAO THEATER KYOTO/i
  ];
  const lines = email.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const found = [];

  for (const line of lines) {
    const cleaned = cleanLine(line);
    if (!cleaned || /^https?:\/\//i.test(cleaned) || /^\[[^\]]+\]\(/i.test(cleaned) || /tracking\.agoda|cdn0\.agoda|\.tile|font-size|border-radius|padding:/i.test(cleaned)) {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(cleaned)) && !found.includes(cleaned)) {
      found.push(cleaned);
    }
    if (found.length >= 6) {
      break;
    }
  }

  return found;
}

// Extracts compact lodging details from dense provider email bodies.
function structuredLodgingLines(email) {
  if (!isLodgingConfirmation(email)) {
    return [];
  }

  const details = [];
  const compact = `${email.title}\n${email.body}`.replace(/\s+/g, " ");
  const id = bookingId(email);
  const hotel = lodgingTitle(email);
  const checkIn = compact.match(/Check\s*in\s+([A-Z][a-z]+day\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\(after\s+[^)]+\))?)/i)?.[1];
  const checkOut = compact.match(/Check\s*out\s+([A-Z][a-z]+day\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+\(before\s+[^)]+\))?)/i)?.[1];

  if (id) {
    details.push(`Booking ID: ${id}`);
  }
  if (hotel) {
    details.push(`Property: ${hotel}`);
  }
  if (checkIn) {
    details.push(`Check in: ${checkIn}`);
  }
  if (checkOut) {
    details.push(`Check out: ${checkOut}`);
  }

  return details;
}

// Pulls markdown attachment links into itinerary details when confirmations include tickets.
function attachmentLines(email) {
  const attachments = [];
  const attachmentSection = email.body.match(/## Attachments\s+([\s\S]*)/i)?.[1] ?? "";
  const pattern = /- \[([^\]]+)\]\(([^)]+)\)/g;
  let match = pattern.exec(attachmentSection);

  while (match) {
    attachments.push(`Attachment: ${match[1]} (${match[2]})`);
    match = pattern.exec(attachmentSection);
  }

  return attachments;
}

// Parses the best candidate date from the email, using received date as reference.
function parseBestDate(email) {
  const referenceDate = email.received ? new Date(email.received) : new Date();
  const parsed = chrono.parse(`${email.title}\n${email.body}`, referenceDate, { forwardDate: true });
  const useful = parsed
    .filter((item) => item.start?.isCertain("day"))
    .map((item) => ({
      text: item.text,
      date: item.start.date()
    }))
    .filter((item) => Number.isFinite(item.date.getTime()));

  if (!useful.length) {
    return null;
  }

  useful.sort((left, right) => left.date - right.date);
  return useful[0];
}

// Parses Korean Air's machine-readable yyyy.mm.dd route table more reliably than NLP.
function parseKoreanAirDate(email) {
  if (!/korean air|e-ticket|KE\s?\d{2,4}/i.test(`${email.title}\n${email.body}`)) {
    return null;
  }

  const lines = email.body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\s]+/, "").replace(/\*/g, "").trim())
    .filter(Boolean);
  const dateLine = lines.find((line) => /^\d{4}\.\d{2}\.\d{2}.*\d{2}:\d{2}/.test(line));
  const match = dateLine?.match(/(\d{4})\.(\d{2})\.(\d{2}).*?(\d{2}):(\d{2})/);

  if (!match) {
    return null;
  }

  return {
    text: dateLine,
    date: new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00`)
  };
}

// Extracts teamLab's explicit admission window from the purchase confirmation.
function parseTeamLabDate(email) {
  if (!/teamlab/i.test(`${email.title}\n${email.body}`)) {
    return null;
  }

  const line = email.body.match(/Admission date and time:\s*(.+)/i)?.[1]?.trim();
  if (!line) {
    return null;
  }

  const parsed = chrono.parseDate(line, email.received ? new Date(email.received) : new Date(), { forwardDate: true });
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return null;
  }

  return { text: line, date: parsed };
}

// Extracts the APA luggage drop-off time, using the quoted stay date for year certainty.
function parseApaDate(email) {
  if (!/apa hotel/i.test(`${email.title}\n${email.body}`) || !/drop off your bags|luggage/i.test(email.body)) {
    return null;
  }

  const year = email.body.match(/\bJune\s+12,\s*(\d{4})\b/i)?.[1] ?? "2026";
  const dropOff = email.body.match(/(\d{1,2}:\d{2}\s*[AP]M)\s+on\s+June\s+12/i)?.[1] ?? "8:00 AM";
  const parsed = chrono.parseDate(`June 12, ${year} ${dropOff}`, new Date(`${year}-01-01T00:00:00`), { forwardDate: true });

  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return null;
  }

  return { text: `June 12, ${year} ${dropOff} luggage drop-off`, date: parsed };
}

// Parses Agoda/hotel date strings from confirmation bodies or date ranges in subjects.
function parseAgodaLodgingDate(email) {
  if (!isLodgingConfirmation(email)) {
    return null;
  }

  const compact = `${email.title}\n${email.body}`.replace(/\s+/g, " ");
  const englishCheckIn = compact.match(/Check\s*in\s+([A-Z][a-z]+day\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})(?:\s+\(after\s+([^)]+)\))?/i);
  if (englishCheckIn) {
    const time = englishCheckIn[2]?.trim() || "3:00 PM";
    const parsed = chrono.parseDate(`${englishCheckIn[1]} ${time}`, email.received ? new Date(email.received) : new Date(), { forwardDate: true });
    if (parsed && Number.isFinite(parsed.getTime())) {
      return { text: `Check in ${englishCheckIn[1]} ${time}`, date: parsed };
    }
  }

  const mojibakeMonth = compact.match(/th\S*ng\s+(\d{1,2})\s+(\d{1,2}),\s*(\d{4})(?:\s+\([^)]*?(\d{1,2}:\d{2})\))?/i);
  if (mojibakeMonth) {
    const [, month, day, year, time = "15:00"] = mojibakeMonth;
    const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}:00`);
    if (Number.isFinite(parsed.getTime())) {
      return { text: `Check in ${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${time}`, date: parsed };
    }
  }

  const subjectRange = email.title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s*[-–]\s*\d{1,2},\s*(\d{4})/i);
  if (subjectRange) {
    const parsed = chrono.parseDate(`${subjectRange[1]} ${subjectRange[2]}, ${subjectRange[3]} 3:00 PM`, email.received ? new Date(email.received) : new Date(), { forwardDate: true });
    if (parsed && Number.isFinite(parsed.getTime())) {
      return { text: `Subject range ${subjectRange[1]} ${subjectRange[2]}, ${subjectRange[3]} 3:00 PM`, date: parsed };
    }
  }

  return null;
}

// Parses airline reservation subjects such as "Travel Reservation on 12JUN".
function parseTravelReservationDate(email) {
  const match = `${email.title}\n${email.body}`.match(/Travel Reservation on\s+(\d{1,2})([A-Z]{3})/i);
  if (!match) {
    return null;
  }

  const year = email.received ? new Date(email.received).getFullYear() : new Date().getFullYear();
  const parsed = chrono.parseDate(`${match[1]} ${match[2]} ${year}`, new Date(`${year}-01-01T00:00:00`), { forwardDate: true });
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return null;
  }

  return { text: `Travel reservation ${match[1]} ${match[2]} ${year}`, date: parsed };
}

// Extracts a generic hotel check-in date from Agoda and similar lodging confirmations.
function parseGenericLodgingDate(email) {
  if (!isLodgingConfirmation(email)) {
    return null;
  }

  const patterns = [
    /Check[- ]?in(?: date| time)?\s*[:\-]\s*([^\n]+)/i,
    /Arrival(?: date| time)?\s*[:\-]\s*([^\n]+)/i,
    /Stay(?: dates)?\s*[:\-]\s*([^\n]+)/i,
    /(?:from|check[- ]?in)\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/i
  ];

  for (const pattern of patterns) {
    const candidate = cleanLine(email.body.match(pattern)?.[1]);
    if (!candidate) {
      continue;
    }

    const hasTime = /\d{1,2}:\d{2}|\b(am|pm)\b/i.test(candidate);
    const parseText = hasTime ? candidate : `${candidate} 15:00`;
    const parsed = chrono.parseDate(parseText, email.received ? new Date(email.received) : new Date(), { forwardDate: true });

    if (parsed && Number.isFinite(parsed.getTime())) {
      return {
        text: hasTime ? candidate : `${candidate} 15:00 assumed check-in`,
        date: parsed
      };
    }
  }

  return null;
}

// Avoids mistaking DRUM TAO reminder email metadata for the actual show date.
function parseDrumTaoDate(email) {
  if (!/drum tao/i.test(`${email.title}\n${email.body}`)) {
    return null;
  }

  const dateSection = email.body.match(/\*Event\/Venue\/Date\(JST\)([\s\S]{0,260})/i)?.[1] ?? email.body;
  const explicit = dateSection.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}:\d{2})?/);
  if (explicit) {
    const [, year, month, day, time] = explicit;
    const when = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time ?? "19:00"}:00`;
    const date = new Date(when);
    if (Number.isFinite(date.getTime())) {
      return { text: explicit[0].trim(), date };
    }
  }

  const japanese = email.body.match(/(\d{1,2})月(\d{1,2})日(?:[^\d\n]*)(\d{1,2}:\d{2})?/);
  if (japanese) {
    const [, month, day, time] = japanese;
    const year = new Date(email.received || new Date()).getFullYear();
    const when = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time ?? "19:00"}:00`;
    const date = new Date(when);
    if (Number.isFinite(date.getTime())) {
      return { text: japanese[0].trim(), date };
    }
  }

  return null;
}

// Gives known confirmation formats priority before falling back to general NLP.
function parseStructuredDate(email) {
  if (/drum tao/i.test(`${email.title}\n${email.body}`)) {
    return parseDrumTaoDate(email);
  }

  if (isLodgingConfirmation(email)) {
    return parseApaDate(email) ?? parseAgodaLodgingDate(email) ?? parseGenericLodgingDate(email);
  }

  return parseKoreanAirDate(email) ?? parseTeamLabDate(email) ?? parseTravelReservationDate(email) ?? parseBestDate(email);
}

// Converts travel emails into itinerary items with conservative confidence scoring.
function buildItems(emails) {
  const cancelledIds = cancelledBookingIds(emails);
  const items = emails
    .filter((email) => {
      const id = bookingId(email);
      return (travelScore(email) >= 2 || isLodgingConfirmation(email)) && !isPromotional(email) && !isNonItinerary(email) && !(id && cancelledIds.has(id));
    })
    .map((email) => {
      const type = classify(email);
      const parsedDate = parseStructuredDate(email);
      const snippets = [...structuredLodgingLines(email), ...importantLines(email), ...attachmentLines(email)].slice(0, 8);
      return {
        id: email.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(),
        type,
        title: displayTitle(email, type),
        date: parsedDate?.date?.toISOString?.() ?? "",
        dateText: parsedDate?.text ?? "",
        location: locationHint(email),
        confidence: (parsedDate ? 2 : 0) + snippets.length + travelScore(email),
        source: email.path,
        received: email.received,
        snippets
      };
    });

  const eventDateMap = items.reduce((map, item) => {
    if (item.type === "event" && item.date && item.location) {
      const existing = map[item.location] || [];
      existing.push(item);
      map[item.location] = existing;
    }
    return map;
  }, {});

  for (const item of items) {
    if (item.type === "event" && !item.date && item.location) {
      const candidates = eventDateMap[item.location] ?? [];
      if (candidates.length === 1) {
        const related = candidates[0];
        item.date = related.date;
        item.dateText = item.dateText || `Inferred from related event: ${related.title}`;
        item.snippets.push(`Inferred date from related event: ${related.title}`);
        item.confidence += 2;
      }
    }
  }

  return items.sort((left, right) => {
    if (left.date && right.date) {
      return left.date.localeCompare(right.date);
    }
    if (left.date) {
      return -1;
    }
    if (right.date) {
      return 1;
    }
    return right.confidence - left.confidence || left.title.localeCompare(right.title);
  });
}

// Formats the generated itinerary as a readable markdown artifact.
function itineraryMarkdown(items) {
  const generatedAt = new Date().toISOString();
  const lines = [
    "---",
    "title: Travel Itinerary",
    "type: itinerary",
    "tags: travel, email, itinerary",
    `created: ${generatedAt}`,
    "---",
    "",
    "# Travel Itinerary",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Timeline",
    ""
  ];

  if (!items.length) {
    lines.push("No travel itinerary items found yet.");
  }

  for (const item of items) {
    const date = item.date ? new Date(item.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Date unknown";
    lines.push(`### ${date} - ${item.title}`);
    lines.push("");
    lines.push(`- Type: ${item.type}`);
    if (item.location) {
      lines.push(`- Location: ${item.location}`);
    }
    if (item.dateText) {
      lines.push(`- Matched date text: ${item.dateText}`);
    }
    lines.push(`- Source: ${item.source}`);
    if (item.snippets.length) {
      lines.push("- Details:");
      for (const snippet of item.snippets) {
        lines.push(`  - ${snippet}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const emails = await readTravelEmails();
const items = buildItems(emails);
const payload = {
  generatedAt: new Date().toISOString(),
  sourceFolder: path.relative(workspace, travelEmailDir).replace(/\\/g, "/"),
  itemCount: items.length,
  items
};

await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(outputMarkdownPath), { recursive: true });
await mkdir(path.dirname(outputJsonPath), { recursive: true });
await writeFile(outputMarkdownPath, itineraryMarkdown(items), "utf8");
await writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Generated ${items.length} itinerary item${items.length === 1 ? "" : "s"}.`);
console.log(path.relative(workspace, outputMarkdownPath).replace(/\\/g, "/"));
console.log(path.relative(workspace, outputJsonPath).replace(/\\/g, "/"));
