"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  practiceCsvExamples,
  readPracticeCsv,
  rehearsalCsv,
} from "@/lib/synthetic-csv";

export function PracticeCsvPicker({
  selectedCase,
  locked,
  onSelection,
}: {
  selectedCase?: string;
  locked: boolean;
  onSelection: (caseId?: string) => void;
}) {
  const descriptionId = useId();
  const [downloadCase, setDownloadCase] = useState<string>(
    practiceCsvExamples[0].id,
  );
  const [downloadUrl, setDownloadUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([rehearsalCsv(downloadCase)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [downloadCase]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  function clear() {
    generation.current++;
    setReading(false);
    setError("");
    onSelection(undefined);
  }
  async function select(file?: File) {
    if (locked || !file) return;
    const current = ++generation.current;
    onSelection(undefined);
    setError("");
    setReading(true);
    try {
      const caseId = await readPracticeCsv(file);
      if (current === generation.current) onSelection(caseId);
    } catch (failure) {
      if (current === generation.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Practice file unavailable. Select it again.",
        );
    } finally {
      if (current === generation.current) setReading(false);
    }
  }
  return (
    <div className="practice-csv-picker">
      <p className="fine" id={descriptionId}>
        Download a practice CSV below, then select that unchanged file. It is
        checked only in this browser; file contents and filenames are never sent
        to the server. Do not select resident files. Reloading clears the file
        selection, not an import already saved to the campaign.
      </p>
      <label className="import-label">
        Practice CSV to download
        <select
          value={downloadCase}
          onChange={(event) => setDownloadCase(event.target.value)}
        >
          {practiceCsvExamples.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {downloadUrl && (
        <a
          className="practice-csv-download"
          href={downloadUrl}
          download={`jco-practice-${downloadCase}.csv`}
        >
          Download practice CSV
        </a>
      )}
      <label className="visually-hidden">
        Select practice CSV
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".csv,text/csv"
          disabled={locked}
          aria-describedby={descriptionId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            // Do not keep filenames or File objects in React/browser storage.
            event.currentTarget.value = "";
            void select(file);
          }}
        />
      </label>
      <div className="practice-csv-select">
        <button
          disabled={locked}
          aria-describedby={descriptionId}
          onClick={() => fileInput.current?.click()}
        >
          {selectedCase ? "Choose another practice CSV" : "Choose practice CSV"}
        </button>
      </div>
      <p role="status" className="fine">
        {reading
          ? "Checking practice file on this device…"
          : selectedCase
            ? `Practice file recognized: ${practiceCsvExamples.find(({ id }) => id === selectedCase)?.label}. Validate below before importing.`
            : "No practice file selected."}
      </p>
      {(selectedCase || reading || error) && (
        <button disabled={locked} onClick={clear}>
          Clear file selection
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
