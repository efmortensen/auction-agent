// =====================================================================
//  AUCTION AGENT SETTINGS
//  This is the only file you should need to edit.
//  Anything in quotes is text, numbers are plain numbers.
// =====================================================================

export default {
  // ---------------------------------------------------------------
  //  WHERE YOU ARE
  // ---------------------------------------------------------------
  homeZip: "77002",          // <-- CHANGE to your zip code
  homeState: "TX",           // two-letter state for GovDeals / Public Surplus
  maxPickupMiles: 50,        // straight-line miles; ~50 mi is about a 1-hour drive

  // ---------------------------------------------------------------
  //  YOUR DEAL RULES
  //  Resale price must be at least this many times your all-in cost.
  //  All-in cost = winning bid + buyer's premium + tax + shipping to you.
  // ---------------------------------------------------------------
  multipleTiers: [
    { upToCost: 10,       multiple: 8 },  // under $10  -> 8x
    { upToCost: 50,       multiple: 5 },  // $10 - $50  -> 5x
    { upToCost: Infinity, multiple: 4 },  // over $50   -> 4x (never lower)
  ],
  minProfitPerPickupTrip: 100, // each pickup location must clear this much profit

  // Your selling costs, used for the "profit" number
  sellingFeePercent: 13.6,     // eBay final value fee (approx.)
  sellingFeePerOrder: 0.40,    // eBay per-order fee
  shipOutEstimate: {           // what it costs YOU to ship each item to a buyer
    electronics: 15,
    appliances: 20,
    toys_media: 6,
    jewelry: 5,
    lots: 8,                   // per piece, for lots you split up
    other: 12,
  },

  // ---------------------------------------------------------------
  //  TAX + BUYER'S PREMIUM
  //  Flip each site to true once your resale certificate is on file there.
  //  Until then the agent adds sales tax so your max bids stay safe.
  // ---------------------------------------------------------------
  salesTaxPercent: 8.25,
  resaleCertificateOnFile: {
    ebay: false,
    govdeals: false,
    publicsurplus: false,
  },
  // Premiums vary by seller. These are conservative defaults used when a
  // listing doesn't say. Always glance at the listing's terms.
  buyersPremiumPercent: {
    ebay: 0,
    govdeals: 12.5,
    publicsurplus: 10,
  },

  // ---------------------------------------------------------------
  //  WHEN IT RUNS
  //  eBay is free to search, so it checks every evening.
  //  GovDeals + Public Surplus cost a little per search, so they run
  //  on these days only and look further ahead.
  // ---------------------------------------------------------------
  ebayHoursAhead: 26,                 // eBay auctions ending in the next ~day
  govScanDays: ["Mon", "Thu"],        // days to check GovDeals + Public Surplus
  timezone: "America/Chicago",

  // ---------------------------------------------------------------
  //  WHAT TO SEARCH FOR
  //  category must be one of: electronics, appliances, toys_media,
  //  jewelry, lots, other
  // ---------------------------------------------------------------
  ebaySearches: [
    // Shipped to you (nationwide)
    { term: "macbook pro", category: "electronics" },
    { term: "ipad", category: "electronics" },
    { term: "nintendo switch", category: "electronics" },
    { term: "kitchenaid mixer", category: "appliances" },
    { term: "vitamix", category: "appliances" },
    { term: "lego lot", category: "toys_media" },
    { term: "beanie babies lot", category: "toys_media" },
    { term: "happy meal toys lot", category: "toys_media" },
    { term: "dvd lot", category: "toys_media" },
    { term: "video game lot", category: "toys_media" },
    { term: "sterling silver jewelry lot", category: "jewelry" },
  ],
  ebayLocalSearches: [
    // Local pickup only, within your radius (big/heavy stuff shines here)
    { term: "lot", category: "lots" },
    { term: "laptop", category: "electronics" },
    { term: "small appliance", category: "appliances" },
    { term: "toys", category: "toys_media" },
  ],
  govSearches: [
    // GovDeals + Public Surplus, in your state
    { term: "laptop", category: "electronics" },
    { term: "ipad", category: "electronics" },
    { term: "camera", category: "electronics" },
    { term: "jewelry", category: "jewelry" },
    { term: "watch", category: "jewelry" },
    { term: "toys", category: "toys_media" },
    { term: "appliance", category: "appliances" },
    { term: "lot", category: "lots" },
  ],

  // ---------------------------------------------------------------
  //  COST CONTROLS (Apify charges per result)
  // ---------------------------------------------------------------
  govResultsPerSearch: 20,        // per term, per site, ending soonest first
  soldCompResultsPerSearch: 20,   // sold comps pulled per item type
  maxNewSoldCompSearchesPerRun: 30,
  compCacheDays: 7,               // reuse comps for a week before re-checking
  maxWorthALook: 15,              // cap on the "worth a look" section
  // Used only for the cost estimate at the bottom of the email
  apifyPricePer1000: { govdeals: 7, publicsurplus: 2, soldcomps: 2.5 },

  // Apify tools this agent rents. Only change if one stops working.
  apifyActors: {
    govdeals: "crawlerbros~govdeals-scraper",
    publicsurplus: "jovian_explorer~publicsurplus-auctions",
    soldcomps: "caffein.dev~ebay-sold-listings",
  },
};
