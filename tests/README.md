# Contact filter tests

`contact-filter-cases.json` lists tricks people use to share contact info (`hide`, each must come out changed)
and normal sublet chat (`keep`, each must come out exactly as typed).

- The copy in `sublets.js`: `node tests/contact-filter.test.js`
- The database: load `supabase/messaging.sql` into a Postgres with UTF8 encoding, run
  `select public.mask_message(x) from jsonb_array_elements_text('<hide + keep as one JSON array>') x`,
  save the results as a JSON array and pass that file: `node tests/contact-filter.test.js sql-out.json`.
  It then also checks the database and `sublets.js` give the same output for every case.

When you change a rule, change it in both places and add the case that prompted it here.
