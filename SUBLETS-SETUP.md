# Turning on real sublets (about 20 minutes, free)

Until these steps are done, the Sublets page runs in **demo mode**: it shows example listings, and anything posted is saved only in that one browser. After these steps, students can sign in with their psu.edu email, post sublets with photos, and contact each other.

Everything below is free. Supabase's free plan holds 500 MB of listings and 1 GB of photos, which is thousands of sublets.

## 1. Make a Supabase project
1. Go to https://supabase.com and click **Start your project**. Sign up with GitHub (easiest) or email.
2. Click **New project**. If it asks for an organization, make one called "Happy Valley Housing" on the **Free** plan.
3. Project name: `happy-valley-housing`. Click **Generate a password** and save it somewhere safe (you will rarely need it). Region: **East US (North Virginia)**. Click **Create new project** and wait about 2 minutes.

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
Supabase's built-in email only sends to people on your own Supabase team, so students won't get codes until you connect a sender. A Gmail account works and is free (up to about 500 emails a day).

1. Make a new Gmail for the site, like `happyvalleyhousing.app@gmail.com` (or use your own).
2. In that Google account, go to https://myaccount.google.com/security and turn on **2-Step Verification**.
3. Go to https://myaccount.google.com/apppasswords. App name: `Supabase`. Click **Create** and copy the 16-letter password it shows.
4. In Supabase: **Authentication**, then **Emails** (or **Email**), then the **SMTP Settings** tab. Turn on **Enable Custom SMTP** and fill in:
   - Sender email: your Gmail address
   - Sender name: `Rhedr`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the 16-letter app password (no spaces)
   Click **Save changes**.
5. Still under **Emails**, open the **Templates** tab, then **Magic Link**. Replace the message body with:
   ```html
   <h2>Your Rhedr code</h2>
   <p>Your sign-in code is <b style="font-size:22px">{{ .Token }}</b></p>
   <p>Type this code on the Rhedr page to sign in. It expires in 1 hour.</p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```
   Subject: `Your Rhedr sign-in code`. Click **Save changes**.
   Leave the sign-in link out on purpose: Penn State's Microsoft security opens every link in incoming mail, which uses up the one-time code before the student can type it. Then open the **Confirm signup** template and paste the same subject and body there too. A student's very first sign-in uses Confirm signup, later ones use Magic Link, so both need the code. Click **Save changes**.
6. Heads-up: Penn State's email (Microsoft) can hold mail from a brand-new Gmail for hours or longer. Every code also appears in the Gmail's **Sent** folder, which helps while testing. Before launch, send from your own domain through a sending service (for example Resend or Brevo) so codes land reliably.
7. Optional but helpful: **Authentication**, **Rate Limits**, set "emails sent per hour" to 100.

## 5b. Only let psu.edu emails sign up
The site already asks for a psu.edu email, but someone could skip the page and ask Supabase directly. This hook makes Supabase itself refuse other emails, so no code is ever sent to them.
1. Make sure you ran the latest `supabase/setup.sql` (step 2). It creates the `hook_psu_only` function.
2. Left sidebar: **Authentication**, then **Auth Hooks** (under Configuration).
3. Click **Add a new hook**, then **Before User Created**.
4. Hook type: **Postgres**. Schema: `public`. Function: `hook_psu_only`. Click **Create hook**.
5. Test it: on the Sublets page nothing changes for psu.edu emails. Other emails now get "Only Penn State (@psu.edu) emails can sign up."

## 6. Try it
Open https://rhedr.com/sublets.html. The yellow "Demo mode" box should be gone. Click **Sign in**, enter your psu.edu email, type the code from the email, then **Post a sublet**.

## Running it day to day
- **Listings waiting for review** (they mentioned wire transfers, WhatsApp, "I'm out of the country", or got 3 reports): **Table Editor**, `sublets`, click **Filter**, `status` equals `review`. Double-click the status cell and change it to `live` (looks fine) or `removed` (scam).
- **Lease checks**: **Storage**, `lease-proofs`. Each folder is one student; open the file. If the name and address match the listing, go to **Table Editor**, `sublets`, find the row (`has_lease_doc` is true, same `user_id` as the folder name) and set `lease_verified` to `true`. The listing gets the Lease checked badge and moves up.
- **Reports**: **Table Editor**, `sublet_reports`.
- The free plan pauses a project after a week with no visits. If that happens, open the Supabase dashboard and click **Restore**. Once students use the site regularly it stays awake.
