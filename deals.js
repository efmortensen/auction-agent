// Your rules, turned into math.

// Highest all-in cost per piece that still meets your multiple.
export function maxCostPerPiece(unitResale, tiers) {
  let best = 0, bestMultiple = null;
  let floor = 0;
  for (const t of tiers) {
    const cost = unitResale / t.multiple;
    if (cost > floor && cost <= t.upToCost && cost > best) { best = cost; bestMultiple = t.multiple; }
    floor = t.upToCost;
  }
  return { cost: best, multiple: bestMultiple };
}

export function costRates(listing, cfg) {
  const premium = listing.premiumPct ?? cfg.buyersPremiumPercent[listing.source] ?? 0;
  const tax = cfg.resaleCertificateOnFile[listing.source] ? 0 : cfg.salesTaxPercent;
  return { premium, tax, factor: (1 + premium / 100) * (1 + tax / 100) };
}

export function price(listing, comp, cfg) {
  const pieces = listing.pieces || 1;
  const unitResale = comp.resale * listing.valueFactor;
  const resaleTotal = unitResale * pieces;
  const { cost: unitMax, multiple } = maxCostPerPiece(unitResale, cfg.multipleTiers);
  const allInMax = unitMax * pieces;
  const rates = costRates(listing, cfg);
  const shipIn = listing.shippingIn ?? 0;

  let maxBid = (allInMax - shipIn) / rates.factor;
  maxBid = maxBid >= 20 ? Math.floor(maxBid) : Math.floor(maxBid * 2) / 2; // whole dollars, or 50¢ steps when small

  const allInAtMax = maxBid * rates.factor + shipIn;
  const shipOut = (cfg.shipOutEstimate[listing.category] ?? cfg.shipOutEstimate.other) * pieces;
  const fees = resaleTotal * (cfg.sellingFeePercent / 100) + cfg.sellingFeePerOrder * pieces;
  const profitAtMax = resaleTotal - fees - shipOut - allInAtMax;

  const mustBeat = listing.minNextBid ?? (listing.bidCount ? listing.currentBid + 0.5 : listing.currentBid);
  const biddable = maxBid >= 1 && maxBid >= mustBeat && listing.shippingIn !== null;

  return { unitResale, resaleTotal, multiple, maxBid, allInAtMax, profitAtMax, rates, biddable };
}

// Pickup items grouped by where you'd drive; a group has to clear the trip minimum.
export function groupTrips(pickupDeals, cfg) {
  const groups = new Map();
  for (const d of pickupDeals) {
    const key = `${d.pickupZip || d.pickupText}|${d.seller}`.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, seller: d.seller, where: d.pickupText, miles: d.miles, deals: [] });
    groups.get(key).deals.push(d);
  }
  const trips = [...groups.values()].map((g) => ({
    ...g,
    profit: g.deals.reduce((s, d) => s + d.calc.profitAtMax, 0),
    firstEnd: g.deals.map((d) => d.endsAt).sort()[0],
  }));
  return {
    keep: trips.filter((t) => t.profit >= cfg.minProfitPerPickupTrip).sort((a, b) => b.profit - a.profit),
    dropped: trips.filter((t) => t.profit < cfg.minProfitPerPickupTrip),
  };
}
