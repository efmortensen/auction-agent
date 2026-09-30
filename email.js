import { escapeHtml as h, money, fmtEnd } from "./util.js";

const INK = "#1d2433", MUTED = "#5d6576", LINE = "#e3dccb", TAG = "#f5e6b8", TAG_EDGE = "#d9c27a", FLAG = "#b4531b";
const SOURCE = {
  ebay: { name: "eBay", color: "#2f5da8" },
  govdeals: { name: "GovDeals", color: "#2e7d4f" },
  publicsurplus: { name: "Public Surplus", color: "#8a2e3b" },
};
const FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";
const SERIF = "font-family:Georgia,'Times New Roman',serif;";

function img(url) {
  return url
    ? `<img src="${h(url)}" width="84" height="84" alt="" style="display:block;width:84px;height:84px;object-fit:cover;border-radius:6px;border:1px solid ${LINE};">`
    : `<div style="width:84px;height:84px;border-radius:6px;background:#f1ede3;"></div>`;
}

function compLine(d) {
  const c = d.comp;
  const sold = c.soldCountCapped ? `${c.soldCount}+ matching sales` : `${c.soldCount} matching sale${c.soldCount === 1 ? "" : "s"}`;
  const each = d.pieces > 1 ? ` each, ${d.pieces} pieces` : "";
  return `Sells for about <b>${money(d.calc.unitResale)}</b>${each} (${sold} in the last 30 days)`;
}

function dealRow(d, cfg) {
  const s = SOURCE[d.source];
  const flags = d.flags.length ? `<div style="color:${FLAG};font-size:13px;margin-top:4px;">${d.flags.map(h).join(", ")}</div>` : "";
  const ship = d.source === "ebay" && !d.pickup ? (d.shippingIn ? `<br>Shipping to you: ${money(d.shippingIn)}` : "<br>Free shipping") : "";
  return `
  <tr><td style="padding:14px 0;border-top:1px solid ${LINE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="top">${img(d.imageUrl)}</td>
      <td valign="top" style="${FONT}font-size:14px;color:${INK};line-height:1.45;">
        <a href="${h(d.url)}" style="color:${INK};font-weight:600;text-decoration:none;">${h(d.title)}</a>
        <div style="color:${MUTED};font-size:13px;margin-top:2px;">
          <span style="color:${s.color};font-weight:600;">${s.name}</span>, ends ${h(fmtEnd(d.endsAt, cfg.timezone))}<br>
          Current bid ${money(d.currentBid)}${d.bidCount != null ? ` with ${d.bidCount} bid${d.bidCount === 1 ? "" : "s"}` : ""}${ship}
        </div>
        <div style="margin-top:6px;">${compLine(d)}</div>
        <div style="color:${MUTED};font-size:13px;">Profit at your max: about ${money(d.calc.profitAtMax)} (${d.calc.multiple}x rule${d.calc.rates.premium ? `, ${d.calc.rates.premium}% premium` : ""}${d.calc.rates.tax ? `, ${d.calc.rates.tax}% tax` : ""})</div>
        ${flags}
      </td>
      <td width="112" valign="top" align="right">
        <div style="display:inline-block;background:${TAG};border:1px dashed ${TAG_EDGE};border-radius:8px;padding:8px 12px;text-align:center;">
          <div style="${FONT}font-size:11px;color:${MUTED};">${d.calc.capped ? "Max bid (your cap)" : "Max bid"}</div>
          <div style="${SERIF}font-size:26px;font-weight:700;color:${INK};line-height:1.1;">${money(d.calc.maxBid)}</div>
        </div>
      </td>
    </tr></table>
  </td></tr>`;
}

function lookRow(d, cfg) {
  const s = SOURCE[d.source];
  const hint = d.comp?.resale ? `<br>If it's what the title says, similar items sell around ${money(d.comp.resale)}${d.pieces > 1 ? " each" : ""}.` : "";
  return `
  <tr><td style="padding:10px 0;border-top:1px solid ${LINE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="top">${img(d.imageUrl)}</td>
      <td valign="top" style="${FONT}font-size:14px;color:${INK};line-height:1.45;">
        <a href="${h(d.url)}" style="color:${INK};font-weight:600;text-decoration:none;">${h(d.title)}</a>
        <div style="color:${MUTED};font-size:13px;margin-top:2px;">
          <span style="color:${s.color};font-weight:600;">${s.name}</span>, ends ${h(fmtEnd(d.endsAt, cfg.timezone))}, current bid ${money(d.currentBid)}${d.miles != null ? `, about ${Math.max(1, Math.round(d.miles))} mi away` : ""}
        </div>
        <div style="color:${FLAG};font-size:13px;margin-top:4px;">${h(d.lookReason)}${hint}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function section(title, sub, body) {
  return `
  <tr><td style="padding:28px 0 6px;">
    <div style="${SERIF}font-size:21px;color:${INK};font-weight:700;">${h(title)}</div>
    ${sub ? `<div style="${FONT}font-size:13px;color:${MUTED};margin-top:2px;">${sub}</div>` : ""}
  </td></tr>${body}`;
}

export function buildEmail({ trips, shipped, looks, notes, cfg, dateLabel }) {
  const bidCount = trips.reduce((n, t) => n + t.deals.length, 0) + shipped.length;
  const subject = bidCount
    ? `${bidCount} auction${bidCount === 1 ? "" : "s"} to bid on tonight${looks.length ? `, ${looks.length} worth a look` : ""}`
    : `No bids tonight${looks.length ? `, ${looks.length} worth a look` : ""}`;

  let body = "";
  for (const t of trips) {
    const place = [t.seller, t.where].filter(Boolean).map(h).join("<br>");
    body += section(
      `Pickup: about ${money(t.profit)} profit`,
      `${place}${t.miles != null ? `<br>About ${Math.max(1, Math.round(t.miles))} miles from home. Check the pickup window before bidding.` : ""}`,
      t.deals.map((d) => dealRow(d, cfg)).join("")
    );
  }
  if (shipped.length) {
    body += section("Shipped to you", "eBay auctions, no driving.", shipped.map((d) => dealRow(d, cfg)).join(""));
  }
  if (!trips.length && !shipped.length) {
    body += `<tr><td style="${FONT}font-size:15px;color:${INK};padding:24px 0;">Nothing cleared your rules tonight. That's the filter working.</td></tr>`;
  }
  if (looks.length) {
    body += section("Worth a look", "Can't be priced automatically. Open these only if you have a minute.", looks.map((d) => lookRow(d, cfg)).join(""));
  }

  const html = `<!doctype html><html><body style="margin:0;background:#faf7f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f0;"><tr><td align="center" style="padding:20px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;padding:8px 22px 22px;">
    <tr><td style="padding:18px 0 4px;">
      <div style="${SERIF}font-size:28px;font-weight:700;color:${INK};">Auction picks</div>
      <div style="${FONT}font-size:14px;color:${MUTED};">${h(dateLabel)}. Enter the max bid as your proxy bid and move on.</div>
    </td></tr>
    ${body}
    <tr><td style="padding-top:28px;${FONT}font-size:12px;color:${MUTED};line-height:1.5;border-top:1px solid ${LINE};">
      ${notes.map((n) => `<div style="margin-top:4px;">${h(n)}</div>`).join("")}
    </td></tr>
  </table></td></tr></table></body></html>`;

  return { subject, html };
}

export async function sendEmail({ subject, html }) {
  const user = process.env.GMAIL_ADDRESS, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_ADDRESS / GMAIL_APP_PASSWORD are not set");
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transport.sendMail({ from: `Auction Agent <${user}>`, to: process.env.DIGEST_TO || user, subject, html });
}
