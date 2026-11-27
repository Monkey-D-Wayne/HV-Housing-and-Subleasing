// Checks the chat contact filter against tests/contact-filter-cases.json.
//   node tests/contact-filter.test.js                 the copy in sublets.js
//   node tests/contact-filter.test.js sql-out.json    also: the database gives the very same output (see tests/README.md)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "sublets.js"), "utf8");
const a = src.indexOf("/* contact-info masking for chats"), b = src.indexOf("/* ---------- data layer");
const { maskMessage } = new Function(src.slice(a, b) + "\nreturn { maskMessage };")();
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "contact-filter-cases.json"), "utf8"));
const all = [...cases.hide, ...cases.keep];
const sql = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : null;
let bad = 0;
all.forEach((t, i) => {
  const out = maskMessage(t);
  if (i < cases.hide.length && out === t) { bad++; console.log("NOT HIDDEN  ", JSON.stringify(t)); }
  if (i >= cases.hide.length && out !== t) { bad++; console.log("WRONGLY HID ", JSON.stringify(t), "->", JSON.stringify(out)); }
  if (sql && sql[i] !== out) { bad++; console.log("SQL DIFFERS ", JSON.stringify(t), "js:", JSON.stringify(out), "sql:", JSON.stringify(sql[i])); }
});
console.log(`${all.length - bad} of ${all.length} passed (${cases.hide.length} tricks, ${cases.keep.length} normal messages${sql ? ", same as SQL" : ""})`);
process.exit(bad ? 1 : 0);
