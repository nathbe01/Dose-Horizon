# Set up accounts on Netlify

You need a Netlify account and a Supabase project. These steps connect the supplied code to your own services; there are no shared or preset login credentials.

## 1. Create the database

1. Create a project at https://supabase.com/dashboard and wait for it to finish provisioning.
2. Open the project's SQL Editor, paste all of `database/setup.sql`, and run it.
3. From the project's API settings, copy its Project URL and legacy **service_role** API key. Keep the service_role key private. This code uses the legacy JWT service_role key, not the public anon key or the newer `sb_secret_` key.

Users of your tracker will be stored in the private `dh_private.accounts` table, not the Supabase Authentication user list. You do not need to enable Supabase Auth email signup. Never expose the private schema through the Data API. The only public function is `dh_account`, which is restricted to the service role by the setup script.

## 2. Deploy the complete project

For the easiest repeatable deployment, put all the files from this folder into a private Git repository, then connect that repository to Netlify using Add new project → Import an existing project. Netlify reads `netlify.toml`:

- Build command: `npm run check`
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Node: 22

Use the full project, not just `public/`. A first deployment before setting the variables will display an account-setup message; it will not let anyone bypass login.

If you already deployed the older static version, connect the updated repository to that same Netlify project to retain the address. Export old browser data before upgrading if you want to keep it.

## 3. Set four private environment variables in Netlify

In the Netlify project's environment-variable settings, add these for the **production** context with **Functions** scope (or all scopes if your plan only offers that option):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase Project URL, such as `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The private legacy service_role JWT API key |
| `PIN_PEPPER` | A new random secret, generated below; keep it unchanged and backed up |
| `APP_ORIGIN` | Your exact HTTPS site origin, e.g. `https://your-site.netlify.app`, with no trailing slash |

Generate PIN_PEPPER once with this command on a machine with Node installed:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the output into Netlify, not into JavaScript or a Git repository. Keep a private backup of this secret. Changing or losing it invalidates PIN authentication; users would need their recovery codes to set new PINs. Do not put production secrets into deploy previews or untrusted branches.

Trigger a new production deployment after setting the variables. If you later use a custom domain, set APP_ORIGIN to that exact origin and redeploy. Alternate domains should redirect to this canonical address; login from a different origin is intentionally rejected.

## Alternative: deploy using the Netlify CLI

If you prefer not to use a Git repository, install Node 22+, open a terminal in this folder, and run:

```sh
npm ci
npx netlify-cli login
npx netlify-cli link
npx netlify-cli deploy --build --prod
```

Link to your existing project (or create a project in Netlify first). Configure the four variables in the Netlify dashboard before the final deployment. The CLI deploy must include the functions; a Netlify Drop upload of `public/` alone will not work.

## 4. Check your live site

1. Open your HTTPS site and choose Create account.
2. Choose a username and a nontrivial 4–12 digit PIN; save the recovery code.
3. Add a water entry, log out, and log back in. Confirm it remains.
4. Open a private/incognito window and create a second account. Confirm it starts empty.
5. Log in to the first account on a second device and confirm its records load.
6. Test browser/calendar reminders separately on your actual phone.

No accounts are included in the download. Only create your own account after completing setup.

## Operation and troubleshooting

- “Account setup is not complete”: check all four environment variables and redeploy.
- “Account service is not installed”: verify that `account` appears in your Netlify project's deployed Functions list. Deploy the full project with Git or the CLI.
- “Account service is unavailable”: check that the Supabase project is running, the full SQL script succeeded, and the service_role key matches the project. Do not log request bodies or PINs when diagnosing.
- “Request origin is not allowed”: APP_ORIGIN must exactly match the address in the browser, including HTTPS and no trailing slash.
- Attempts are limited to eight per username per 15 minutes and 30 per IP per 15 minutes; signups are also limited to five per IP per hour. Successful authentication counts toward these limits. They apply across Netlify instances and survive function restarts.
- Keep the database, PIN_PEPPER, and service credentials backed up privately. Exported user backups contain health records.
- No payment plan or subscription has been selected for you. Monitor your Netlify/Supabase usage and limits in their dashboards.

Documentation: https://docs.netlify.com/build/functions/ and https://supabase.com/docs/guides/database/functions
