# Auction Agent setup

About 30 minutes, one time. You'll set it up the same way as your repricer: code on GitHub, running on a schedule, nothing to keep open.

## What you need

- Your GitHub account
- Your eBay developer keys (the same Production keys the pricing extension uses)
- A free Apify account (apify.com)
- A Gmail account for sending the email

## Step 1: Put the code on GitHub

1. On GitHub, click **New repository**. Name it `auction-agent`, choose **Private**, and create it.
2. Click **uploading an existing file**. Drag in everything from the unzipped folder: `config.js`, `package.json`, `SETUP.md`, and the `src` and `demo` folders. Click **Commit changes**.
3. The schedule file lives in a hidden folder, so add it by hand: click **Add file > Create new file**, type the name `.github/workflows/auction-agent.yml` (the slashes create the folders), paste in the contents of that file from the zip, and commit.

## Step 2: Set your zip code

Open `config.js` on GitHub, click the pencil icon, change `homeZip` to your zip code, and commit. Everything else in that file is already set to the rules we agreed on, and each setting has a note explaining it.

## Step 3: Get your Apify token

1. Sign up at apify.com.
2. Go to **Settings > API & Integrations** and copy your **Personal API token**.

## Step 4: Get a Gmail app password

The agent sends email through your Gmail. Google requires a special password for this.

1. Your Google account needs 2-Step Verification turned on.
2. Go to myaccount.google.com/apppasswords, create one named "Auction agent", and copy the 16-letter password.

## Step 5: Add your keys to GitHub

In your `auction-agent` repo, go to **Settings > Secrets and variables > Actions > New repository secret**. Add each of these:

| Name | What to paste |
|---|---|
| `EBAY_CLIENT_ID` | eBay Production App ID (Client ID) |
| `EBAY_CLIENT_SECRET` | eBay Production Cert ID (Client Secret) |
| `APIFY_TOKEN` | Apify token from Step 3 |
| `GMAIL_ADDRESS` | The Gmail address that sends the email |
| `GMAIL_APP_PASSWORD` | The 16-letter app password from Step 4 |
| `DIGEST_TO` | Optional. Where to send it, if not the same Gmail |

## Step 6: Test it

1. Go to the **Actions** tab and click **Auction agent**, then **Run workflow**.
2. Set `force_gov` to `1` and `dry_run` to `1`, then run it. This checks all three sites but doesn't send email.
3. When it finishes (5 to 15 minutes), open the run and download **preview** at the bottom. That's your email.
4. If it looks right, run it again with `dry_run` set to `0` to get a real email.

After that, it runs by itself every evening around 6:30 PM (5:30 PM once daylight saving ends). GitHub sometimes starts it a little late.

## If something looks wrong

Open the run in the Actions tab and copy the log. The line starting with "GovDeals sample record" is the one to share first: the GovDeals scraper doesn't publish its exact output format, so we may need to adjust a field name after the first real run.

## Costs

- eBay: free.
- Apify: pay per result. The email footer shows each run's estimated cost. GovDeals and Public Surplus only run on Mondays and Thursdays to keep it down. Check your Apify billing page after the first week. If it's higher than you like, lower `govResultsPerSearch` or remove search terms in `config.js`.

## When your resale certificate is on file

In `config.js`, change `false` to `true` for each site under `resaleCertificateOnFile`. Until then, max bids include 8.25% sales tax so you never overpay.
