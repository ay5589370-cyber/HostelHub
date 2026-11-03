import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCsv } from "../src/lib/csvExport.js";

test("CSV report escaping handles quotes, commas, line breaks and formula injection", () => {
  const output = makeCsv(
    [
      {
        name: 'A, "quoted" student\nsecond line',
        amount: 12.5,
        comment: "=1+1",
      },
      { name: "Normal", amount: -4, comment: "  @SUM(A1:A2)" },
    ],
    [
      { key: "name", label: "Student" },
      { key: "amount", label: "Amount" },
      { key: "comment", label: "Comment" },
    ],
    { Filters: 'status="active", from=2026-01-01' },
  );
  assert.match(output, /"A, ""quoted"" student\nsecond line"/);
  assert.match(output, /"'=1\+1"/);
  assert.match(output, /"'-4"/);
  assert.match(output, /"'\s+@SUM\(A1:A2\)"/);
  assert.match(output, /"Exported at"/);
  assert.match(output, /"Filters","status=""active"", from=2026-01-01"/);
});
