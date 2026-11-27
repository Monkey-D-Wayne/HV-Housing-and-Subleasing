# Turning on real sublets (about 20 minutes, free)

Until these steps are done, the Sublets page runs in **demo mode**: it shows example listings, and anything posted is saved only in that one browser. After these steps, students can sign in with their psu.edu email, post sublets with photos, and contact each other.

Everything below is free. Supabase's free plan holds 500 MB of listings and 1 GB of photos, which is thousands of sublets.

## 1. Make a Supabase project
1. Go to https://supabase.com and click **Start your project**. Sign up with your Rhedr Google account (boaz@rhedr.com).
2. Click **New project**. If it asks for an organization, make one called "Rhedr" on the **Free** plan.
3. Project name: `rhedr`. Click **Generate a password** and save it somewhere safe (you will rarely need it). Region: **East US (North Virginia)**. Click **Create new project** and wait about 2 minutes.

## 2. Create the database
1. In the left sidebar, click **SQL Editor**, then **+ New query**.
2. Open `supabase/setup.sql` from this repository on GitHub, click the **Copy raw file** button (two squares icon), and paste it into the editor.
3. Click **Run** (bottom right). It should say "Success. No rows returned". If it asks about "destructive operations", click **Run this query**.

## 3. Copy your two keys into config.js
1. In the left sidebar, click the gear (**Project Settings**), then **Data API** (or **API**). Copy the **Project URL** (looks like `https://abcdxyz.supabase.co`).
2. Click **API Keys**. Copy the **Publishable key** (starts with `sb_publishable_`). If you only see "Legacy API keys", copy the **anon public** key instead. **Never** copy the `secret` or `service_role` key: that one must stay private.
3. On GitHub, open `config.js` in this repository, click the pencil (Edit), and paste them between the quotes:
   ```js
   supabaseUrl: "https://abcdxyz.supabase.co",
   supabaseKey: "sb_publishable_xxxxxxxx"
   ```
   Click **Commit changes**, then **Commit changes** again. The site updates in about a minute. The publishable key is meant to be public; the database rules in `setup.sql` are what protect the data.

## 4. Tell Supabase where the site lives
1. Left sidebar: **Authentication**, then **URL Configuration**.
2. **Site URL**: `https://rhedr.com/sublets.html`, then **Save**.
3. Under **Redirect URLs** click **Add URL**: `https://rhedr.com/**`, then **Save URLs**. Add `https://www.rhedr.com/**` the same way.

## 5. Let Supabase email sign-in codes to students
Supabase's built-in email only sends to people on your own Supabase team, so students won't get codes until you connect a sender. Rhedr sends codes through Resend (https://resend.com) from `noreply@send.rhedr.com`. Sign in to Resend as boaz@rhedr.com. The `send.rhedr.com` domain is verified there with DNS records in Vercel.

1. In Resend, open **API Keys**, click **Create API Key**, name it `Supabase`, permission **Sending access**, and copy the key (it starts with `re_`).
2. In Supabase: **Authentication**, then **Emails** (or **Email**), then the **SMTP Settings** tab. Turn on **Enable Custom SMTP** and fill in:
   - Sender email: `noreply@send.rhedr.com`
   - Sender name: `Rhedr`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
   Click **Save changes**.
3. Still under **Emails**, open the **Templates** tab, then **Magic Link**. Replace the message body with:
   ```html
   <h2>Your Rhedr code</h2>
   <p>Your sign-in code is <b style="font-size:22px">{{ .Token }}</b></p>
   <p>Type this code on the Rhedr page to sign in. It expires in 1 hour.</p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```
   Subject: `Your Rhedr sign-in code`. Click **Save changes**.
   Leave the sign-in link out on purpose: Penn State's Microsoft security opens every link in incoming mail, which uses up the one-time code before the student can type it. Then open the **Confirm signup** template and paste the same subject and body there too. A student's very first sign-in uses Confirm signup, later ones use Magic Link, so both need the code. Click **Save changes**.
4. While testing, every sent code shows in Resend under **Emails**, with whether it was delivered.
5. Optional but helpful: **Authentication**, **Rate Limits**, set "emails sent per hour" to 100.

## 5b. Only let psu.edu emails sign up
The site already asks for a psu.edu email, but someone could skip the page and ask Supabase directly. This hook makes Supabase itself refuse other emails, so no code is ever sent to them.
1. Make sure you ran the latest `supabase/setup.sql` (step 2). It creates the `hook_psu_only` function.
2. Left sidebar: **Authentication**, then **Auth Hooks** (under Configuration).
3. Click **Add a new hook**, then **Before User Created**.
4. Hook type: **Postgres**. Schema: `public`. Function: `hook_psu_only`. Click **Create hook**.
5. Test it: on the Sublets page nothing changes for psu.edu emails. Other emails now get "Only Penn State (@psu.edu) emails can sign up."

## 6. Try it
Open https://rhedr.com/sublets.html. The yellow "Demo mode" box should be gone. Click **Sign in**, enter your psu.edu email, type the code from the email, then **Post a sublet**.

## 7. Lease checks

Students can add proof they live at the place (a lease page or a bill). An AI reads it, compares it with the listing, and you approve or reject it on the admin page. Approved listings get the **Lease checked** badge, rank first, and show under the **Lease checked** tab. The file is deleted once it's decided.

### 7a. Update the database (2 minutes)
1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/sql/new).
2. Open [supabase/setup.sql on GitHub](https://github.com/Monkey-D-Wayne/hv-housing-and-subleasing/blob/main/supabase/setup.sql), click the **Copy raw file** button (two squares), paste it into the editor and click **Run**. If it asks about "destructive operations", click **Run this query**. Running it again is safe.

### 7b. Admins
`setup.sql` makes **boaz@rhedr.com** the admin. Admin emails don't need to be psu.edu: anyone listed in the **admins** table can sign in at https://rhedr.com/admin with a code sent to that email. To add someone, open the [Table Editor](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/editor), click **admins**, then **Insert**, **Insert row**, type their email in lowercase and click **Save**. Admins can review lease proofs but can't post sublets unless they also use a psu.edu email.

### 7c. Turn on the AI reader (10 minutes, optional, costs a little)
Without this, every proof simply waits for you to open the file and decide. With it, each proof arrives already read and marked green, yellow or red.
1. Go to https://console.anthropic.com and sign in with boaz@rhedr.com. Add a payment method and a small amount of credit (for example $5) under **Billing**. Each lease costs roughly a few cents to read (an estimate; long PDFs cost more).
2. Click **API keys**, then **Create key**, name it `rhedr-lease-checks`, and copy it (it starts with `sk-ant-`). You can't see it again later.
3. In Supabase, open [Edge Functions secrets](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/functions/secrets). Add a secret with name `ANTHROPIC_API_KEY` and the key as the value. Click **Save**.
4. Open [Edge Functions](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/functions), click **Deploy a new function**, then **Via Editor**.
5. Name it exactly `check-lease`. Delete the example code, then paste the whole file [supabase/functions/check-lease/index.ts](https://github.com/Monkey-D-Wayne/hv-housing-and-subleasing/blob/main/supabase/functions/check-lease/index.ts) (use **Copy raw file** again). Click **Deploy function**.
6. Test it: on https://rhedr.com/admin, a waiting proof has a **Read with AI** button. Press it; after a few seconds it shows green, yellow or red.

### The two switches on the admin page
- **Require lease proof to post**: off by default. Off means proof is optional and earns the badge. On means every new post needs a proof and stays hidden until you approve it. You can flip it back any time.
- **Approve green checks automatically**: off by default. On means a proof where the name, address, dates and rent all match gets the badge right away without you. Yellow and red always wait for you. Leave it off until you've seen the AI get a few right.

## 8. Sublet alerts

Students click **Get alerts** on the Sublets page, pick what they want (room or whole place, bedrooms, max price, walk to Old Main, dates, building) and choose **once a day** or **as they're posted**. When a new sublet matches, the `send-alerts` Edge Function emails them through Resend from `noreply@send.rhedr.com`. Alerts are set to **lease-checked sublets only** unless the student unticks it, and lease-checked sublets always come first (cheaper first when two tie). Nobody gets the same sublet twice, and nobody gets alerts about their own post. Every email has links to turn off that alert or all alerts, and Gmail and Outlook show their own one-click unsubscribe too.

### 8a. Update the database
Run the latest `supabase/setup.sql` in the [SQL Editor](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/sql/new), the same way as step 7a. It adds the alert tables and schedules `send-alerts` to run every 15 minutes (it uses the `pg_cron` and `pg_net` extensions, which the file turns on).

### 8b. A Resend key for the function
1. In [Resend API Keys](https://resend.com/api-keys) (signed in as boaz@rhedr.com), click **Create API Key**. Name `rhedr-alerts`, permission **Sending access**, domain `send.rhedr.com`. Copy the key (starts with `re_`).
2. In Supabase [Edge Functions secrets](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/functions/secrets), add a secret named `RESEND_API_KEY` with that key. Click **Save**.

### 8c. Deploy the function
1. [Edge Functions](https://supabase.com/dashboard/project/jszujotoetfhywyshxjq/functions), **Deploy a new function**, **Via Editor**.
2. Name it exactly `send-alerts`. Delete the example code, paste the whole file [supabase/functions/send-alerts/index.ts](https://github.com/Monkey-D-Wayne/hv-housing-and-subleasing/blob/main/supabase/functions/send-alerts/index.ts), click **Deploy function**.
3. Open the function's **Details** (or **Settings**) tab and turn **off** the JWT check (called "Enforce JWT verification" or "Verify JWT"). Save. The scheduled job and email apps' unsubscribe buttons can't sign in, so the function checks its own private key instead.

### 8d. Send yourself a test
1. On https://rhedr.com/sublets, sign in with your psu.edu email, click **Get alerts** and save any alert.
2. In the SQL Editor, run:
   ```sql
   select net.http_post(
     url := 'https://jszujotoetfhywyshxjq.supabase.co/functions/v1/send-alerts',
     headers := jsonb_build_object('Content-Type','application/json','x-rhedr-job',(select secret from public.alert_job)),
     body := '{"test": true}'::jsonb);
   ```
   That emails the newest alert's owner a sample with up to 3 live sublets (or one example sublet when none are live). Nothing is marked as sent.
3. To see what the function answered, run `select status_code, content from net._http_response order by id desc limit 1;`
4. Use `{"dry_run": true}` instead of `{"test": true}` to see who would get what right now without sending anything.

### Running alerts
- How many students have alerts on: `select * from public.alert_stats();` while signed in as an admin, or **Table Editor**, `saved_searches`.
- Every alert email shows in Resend under **Emails**, with whether it was delivered.
- To pause all alert emails: `select cron.unschedule('send-alerts');`. Running `setup.sql` again turns them back on.

## Running it day to day
- **Listings waiting for review** (they mentioned wire transfers, WhatsApp, "I'm out of the country", or got 3 reports): **Table Editor**, `sublets`, click **Filter**, `status` equals `review`. Double-click the status cell and change it to `live` (looks fine) or `removed` (scam).
- **Lease checks**: open https://rhedr.com/admin (see section 7). Each proof shows the listing next to what the AI read, with green, yellow or red. Press **Approve** or pick a reason and press **Reject**. The file is deleted right after.
- **Reports**: **Table Editor**, `sublet_reports`.
- The free plan pauses a project after a week with no visits. If that happens, open the Supabase dashboard and click **Restore**. Once students use the site regularly it stays awake.
