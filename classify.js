// Decides how each listing should be handled before any pricing happens.

const RX = {
  locked: /\b(bios (lock|password)|password protected|mdm|icloud|activation lock|dep enrolled|managed device|locked)\b/i,
  parts: /\b(for parts|parts only|not working|non[- ]?working|broken|no power|won'?t power|cracked screen|damaged)\b/i,
  noDrive: /\b(no (hard )?drives?|no hdd|no ssd|drives? removed|hdd removed|ssd removed|without (a )?(hard )?drive|no storage)\b/i,
  untested: /\buntested\b/i,
  noCharger: /\bno (charger|power (cord|adapter|supply)|ac adapter)\b/i,
  vagueLot: /\b(misc\.?|miscellaneous|assorted|assortment|mixed|pallet|box of|bin of|tote of|contents of|variety|grab ?bag|mystery)\b/i,
  jewelry: /\b(jewelry|jewellery|necklaces?|bracelets?|earrings?|pendants?|brooch|10k|14k|18k|sterling|\.925)\b/i,
  dutch: /dutch/i,
};

const QTY_RX = [
  /\bqty[:.\s]*(\d{1,4})\b/i,
  /\bquantity[:.\s]*(\d{1,4})\b/i,
  /\blot of (\d{1,4})\b/i,
  /\((\d{1,4})\)/,
  /\b(\d{1,4})\s*(?:pcs|pieces|units|ea|each|count|ct)\b/i,
  /^(\d{1,3})\s*[x-]?\s+[a-z]/i,
];

export function pieceCount(text) {
  for (const rx of QTY_RX) {
    const m = String(text).match(rx);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 500) return n;
    }
  }
  return 1;
}

const STOP = new Set(("surplus asset tag sn s/n serial qty quantity lot lots of ea each misc used item items inventory property " +
  "county city isd district school police seized unclaimed state government auction sale pickup local only " +
  "the and with for a an in on w/ w/o approx approximately various").split(" "));

// Turn a messy auction title into a clean eBay search.
export function compQuery(title, keepLot = false) {
  const stop = keepLot ? new Set([...STOP].filter((w) => !["lot", "lots", "of"].includes(w))) : STOP;
  const words = String(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\s*\w+/g, " ")
    .replace(/\b(asset tag|asset|tag|sn|s\/n|serial)\s*(no\.?|number|#|:)\s*[\w-]+/gi, " ")
    .replace(/\basset\s+\d+/gi, " ")
    .replace(/[^\w\s.-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !stop.has(w) && w.length < 25);
  return words.slice(0, 7).join(" ").trim();
}

export function classify(listing) {
  const text = `${listing.title} ${listing.description} ${listing.condition}`;
  const flags = [];
  let valueFactor = 1;
  let lookReason = null;

  if (RX.locked.test(text)) { flags.push("Possible lock (BIOS/MDM/iCloud)"); lookReason ??= "Might be locked, check listing"; }
  if (RX.parts.test(text)) { flags.push("For parts / not working"); lookReason ??= "Parts or not working"; }
  if (RX.noDrive.test(text)) { flags.push("No hard drive"); valueFactor *= 0.8; }
  if (RX.untested.test(text)) { flags.push("Untested"); valueFactor *= 0.75; }
  if (RX.noCharger.test(text)) { flags.push("No charger"); valueFactor *= 0.9; }
  if (listing.auctionType && RX.dutch.test(listing.auctionType)) { flags.push("Dutch auction (multiple winners)"); }

  if (listing.category === "jewelry" || RX.jewelry.test(listing.title)) {
    lookReason ??= "Jewelry needs your eyes (real gold/silver?)";
  }
  const pieces = pieceCount(listing.title) > 1 ? pieceCount(listing.title) : pieceCount(listing.description);
  if (RX.vagueLot.test(listing.title) || (listing.category === "lots" && pieces === 1)) {
    lookReason ??= "Mixed lot, can't comp automatically";
  }

  // Several identical pieces (e.g. "Dell Latitude 5420 (QTY 6)") are priced per piece.
  // A single listing, including an eBay lot, is priced against similar sales as a whole.
  const perPiece = pieces > 1;
  let cleanTitle = listing.title.replace(RX.noDrive, " ").replace(RX.untested, " ").replace(RX.noCharger, " ");
  if (perPiece) for (const rx of QTY_RX) cleanTitle = cleanTitle.replace(rx, " ");
  const query = compQuery(cleanTitle, !perPiece);
  const meaningful = query.split(" ").filter((w) => !["lot", "lots", "of"].includes(w));
  if (!lookReason && meaningful.length < 2) lookReason = perPiece ? "Multi-piece lot, too vague to comp" : "Title too vague to comp";

  return { ...listing, flags, valueFactor, lookReason, pieces: perPiece ? pieces : 1, compQuery: query };
}
