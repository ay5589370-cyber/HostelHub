function safeCell(value) {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function makeCsv(rows, columns, metadata = {}) {
  const lines = [];
  lines.push(
    `${safeCell("Exported at")},${safeCell(new Date().toISOString())}`,
  );
  for (const [key, value] of Object.entries(metadata))
    lines.push(`${safeCell(key)},${safeCell(value)}`);
  lines.push("");
  lines.push(columns.map((column) => safeCell(column.label)).join(","));
  for (const row of rows)
    lines.push(columns.map((column) => safeCell(row[column.key])).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(filename, rows, columns, metadata = {}) {
  const blob = new Blob(["\uFEFF", makeCsv(rows, columns, metadata)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
