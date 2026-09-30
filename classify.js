// Decides how each listing should be handled before any pricing happens.

const RX = {
  locked: /\b(bios (lock|password)|password protected|mdm|icloud|activation lock|dep enrolled|managed device|locked)\b/i,
  parts: /\b(for parts|parts only|not working|non[- ]?working|broken|no power|won'?t power|cracked screen|damaged)\b/i,
  noDrive: /\b(no (hard )?drives?|no hdd|no ssd|drives? removed|hdd removed|ssd removed|hard drive removed|without (a )?(hard )?drive|no storage)\b/i,
  untested: /\buntested\b/i,
  noCharger: /\bno (charger|power (cord|adapter|supply)|ac adapter)\b/i,
  vagueLot: /\b(misc\.?|miscellaneous|assorted|assortment|mixed|box of|bin of|tote of|contents of|variety|grab ?bag|mystery)\b/i,
  jewelry: /\b(jewelry|jewellery|necklaces?|bracelets?|earrings?|pendants?|brooch|10k|14k|18k|sterling|\.925)\b/i,
  dutch: /dutch/i,
  vehicle: /\b(19|20)\d{2}\s+(ford|chevrolet|chevy|dodge|toyota|honda|nissan|gmc|ram|jeep|freightliner|international|kia|hyundai|mack|peterbilt|kenworth|john deere|kubota)\b/i,
};

// Words that say WHAT KIND of thing it is. "MacBook install DVD" is not a MacBook.
export const KIND_WORDS = new Set(("dvd dvds cd cds disc discs disk vhs blu-ray bluray box boxes empty case cases manual manuals " +
  "charger chargers adapter adapters cable cables cord battery batteries remote remotes controller controllers lens lenses " +
  "cover covers bag bags stand dock cartridge cartridges parts keyboard mouse strap straps band bands replacement " +
  "screen skin skins sticker stickers poster posters book books guide figure figures figurine plush card cards " +
  "game games console consoles bundle accessory accessories insert inserts tag tags ornament ornaments pin pins " +
  "patch patches keychain magnet magnets shirt apron mug cup glass glasses sign").split(" "));

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
  "the and with for a an in on w/ w/o approx approximately various new brand oem free shipping fast").split(" "));

export function tokens(text, keepLot = false) {
  const stop = keepLot ? new Set([...STOP].filter((w) => !["lot", "lots", "of"].includes(w))) : STOP;
  return String(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\s*\w+/g, " ")
    .replace(/\b(asset tag|asset|tag|sn|s\/n|serial)\s*(no\.?|number|#|:)\s*[\w-]+/gi, " ")
    .replace(/\basset\s+\d+/gi, " ")
    .replace(/[^\w\s.-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w && !stop.has(w) && w.length < 25);
}

// Turn a messy auction title into a clean eBay search.
// First 7 meaningful words, plus any "what kind of thing" words found later in the title.
export function compQuery(title, keepLot = false) {
  const words = tokens(title, keepLot);
  const head = words.slice(0, 7);
  const kinds = words.slice(7).filter((w) => KIND_WORDS.has(w) && !head.includes(w)).slice(0, 2);
  const lot = keepLot && !head.some((w) => w === "lot" || w === "lots") && words.some((w) => w === "lot" || w === "lots") ? ["lot"] : [];
  return [...head, ...kinds, ...lot].join(" ").trim();
}

function wordRx(list) {
  const esc = list.map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp(`\\b(${esc.join("|")})\\b`, "i");
}

// Is it bigger than about 2 ft x 2 ft?
export function tooBig(listing, cfg) {
  const title = listing.title || "";
  const small = wordRx(cfg.smallVersionWords || []);
  if (small.test(title)) return null;
  const big = wordRx(cfg.tooBigWords || []);
  const m = title.match(big);
  if (m) return m[1];
  if (RX.vehicle.test(title)) return "vehicle";
  // Sizes written in the title: 4x8, 36" x 48", 3 ft x 5 ft
  const ft = title.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)?/i);
  if (ft && Math.max(+ft[1], +ft[2]) > 2) return `${ft[1]} x ${ft[2]} ft`;
  const inch = title.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b|inch(?:es)?)\s*(?:x|by)\s*(\d+(?:\.\d+)?)/i);
  if (inch && +inch[1] > 24 && +inch[2] > 24) return `${inch[1]} x ${inch[2]} in`;
  if (/\d\s*x\s*(8|10|12)\b/i.test(title) && /(^|[^\d])[34]\s*x\s*(8|10|12)\b/i.test(title)) return "4x8 sheets";
  const tv = title.match(/\b(\d{2,3})\s*(?:"|in\b|inch)[^a-z]*(?:[a-z]+\s+){0,3}(tv|television|monitor|display)\b/i);
  if (tv && +tv[1] >= 32) return `${tv[1]}" screen`;
  return null;
}

export function classify(listing, cfg) {
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
  const titlePieces = pieceCount(listing.title);
  const pieces = titlePieces > 1 ? titlePieces : pieceCount(listing.description);
  if (RX.vagueLot.test(listing.title)) lookReason ??= "Mixed lot, can't comp automatically";

  // Government "QTY 6" listings of identical items are priced per piece.
  // eBay lots are compared against other lots that sold, as a whole.
  const perPiece = pieces > 1 && listing.source !== "ebay";
  let cleanTitle = listing.title.replace(RX.noDrive, " ").replace(RX.untested, " ").replace(RX.noCharger, " ");
  if (perPiece) for (const rx of QTY_RX) cleanTitle = cleanTitle.replace(rx, " ");
  const query = compQuery(cleanTitle, !perPiece);
  const meaningful = query.split(" ").filter((w) => !["lot", "lots", "of"].includes(w));
  if (!lookReason && meaningful.length < 2) lookReason = perPiece ? "Multi-piece lot, too vague to comp" : "Title too vague to comp";

  return {
    ...listing, flags, valueFactor, lookReason,
    pieces: perPiece ? pieces : 1,
    compQuery: query,
    tooBig: tooBig(listing, cfg),
  };
}
