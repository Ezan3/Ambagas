import { useEffect, useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";

const STORAGE_KEY = "ambagas-state-v1";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeTrip() {
  return {
    id: crypto.randomUUID(),
    date: todayISO(),
    label: "",
    kmPerLiter: "",
    distanceKm: "",
  };
}

function formatCurrency(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `PHP ${safe.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value, digits = 2) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-PH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4 || 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function validateState(raw) {
  const gasPrice = Number(raw?.gasPrice);
  const splitCount = Number(raw?.splitCount);
  const trips = Array.isArray(raw?.trips) ? raw.trips : [];

  return {
    gasPrice: gasPrice > 0 ? String(gasPrice) : "",
    splitCount: Number.isInteger(splitCount) && splitCount >= 1 ? String(splitCount) : "1",
    trips: trips
      .map((t) => ({
        id: typeof t.id === "string" && t.id ? t.id : crypto.randomUUID(),
        date: typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayISO(),
        label: typeof t.label === "string" ? t.label : "",
        kmPerLiter: Number(t.kmPerLiter) > 0 ? String(Number(t.kmPerLiter)) : "",
        distanceKm: Number(t.distanceKm) > 0 ? String(Number(t.distanceKm)) : "",
      }))
      .filter((t) => t.date),
  };
}

function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
      }
      ctx.putImageData(imgData, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded."));
    };
    image.src = url;
  });
}

function extractOcrCandidates(rawText) {
  const text = rawText.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  const kmPerLiterCandidates = [];
  const kplPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:km\s*\/\s*l|km\s*per\s*l)/gi,
    /(?:km\s*\/\s*l|km\s*per\s*l)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi,
  ];
  kplPatterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      kmPerLiterCandidates.push(Number(match[1]));
    }
  });

  const distanceCandidates = [];
  const distancePatterns = [
    /(\d+(?:\.\d+)?)\s*km\b/gi,
    /(?:distance|trip)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi,
  ];
  distancePatterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const segment = lower.slice(Math.max(0, match.index - 8), match.index + 12);
      if (!/\/\s*l|per\s*l|km\/l|km l/.test(segment)) {
        distanceCandidates.push(Number(match[1]));
      }
    }
  });

  const unique = (arr) => [...new Set(arr.filter((n) => Number.isFinite(n) && n > 0))];
  return {
    rawText: text,
    kmPerLiterCandidates: unique(kmPerLiterCandidates),
    distanceCandidates: unique(distanceCandidates),
  };
}

function App() {
  const [gasPrice, setGasPrice] = useState("");
  const [splitCount, setSplitCount] = useState("1");
  const [trips, setTrips] = useState([makeTrip()]);
  const [shareLink, setShareLink] = useState("");
  const [shareWarn, setShareWarn] = useState("");
  const [loadError, setLoadError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const [ocrState, setOcrState] = useState({
    running: false,
    progress: 0,
    targetTripId: null,
    extracted: null,
    confidence: null,
    message: "",
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get("data");
    if (data) {
      try {
        const parsed = JSON.parse(fromBase64Url(data));
        const validated = validateState(parsed);
        setGasPrice(validated.gasPrice);
        setSplitCount(validated.splitCount);
        setTrips(validated.trips.length ? validated.trips : [makeTrip()]);
        return;
      } catch (error) {
        setLoadError("Shared link is invalid. Loaded a clean state instead.");
        setGasPrice("");
        setSplitCount("1");
        setTrips([makeTrip()]);
        return;
      }
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const validated = validateState(parsed);
        setGasPrice(validated.gasPrice);
        setSplitCount(validated.splitCount);
        setTrips(validated.trips.length ? validated.trips : [makeTrip()]);
      } catch {
        setLoadError("Saved local data was invalid and has been ignored.");
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        gasPrice,
        splitCount,
        trips,
      })
    );
  }, [gasPrice, splitCount, trips]);

  const computedTrips = useMemo(() => {
    const gp = Number(gasPrice);
    return trips.map((trip) => {
      const kmPerLiter = Number(trip.kmPerLiter);
      const distanceKm = Number(trip.distanceKm);
      const litersUsed = kmPerLiter > 0 && distanceKm > 0 ? distanceKm / kmPerLiter : 0;
      const tripCost = gp > 0 ? litersUsed * gp : 0;
      const phpPerKm = distanceKm > 0 ? tripCost / distanceKm : 0;
      return {
        ...trip,
        litersUsed,
        tripCost,
        phpPerKm,
      };
    });
  }, [trips, gasPrice]);

  const totals = useMemo(() => {
    const totalDistance = computedTrips.reduce((sum, t) => sum + (Number(t.distanceKm) || 0), 0);
    const totalLiters = computedTrips.reduce((sum, t) => sum + t.litersUsed, 0);
    const totalCost = computedTrips.reduce((sum, t) => sum + t.tripCost, 0);
    const overallPhpPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;
    const split = Math.max(1, parseInt(splitCount || "1", 10));
    const eachPays = split > 0 ? totalCost / split : totalCost;
    return {
      totalDistance,
      totalLiters,
      totalCost,
      overallPhpPerKm,
      eachPays,
    };
  }, [computedTrips, splitCount]);

  function updateTrip(id, field, value) {
    setTrips((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  function addTrip() {
    setTrips((prev) => [...prev, makeTrip()]);
  }

  function removeTrip(id) {
    setTrips((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length ? next : [makeTrip()];
    });
  }

  function duplicateTrip(id) {
    const source = trips.find((t) => t.id === id);
    if (!source) return;
    setTrips((prev) => [
      ...prev,
      {
        ...source,
        id: crypto.randomUUID(),
        date: source.date || todayISO(),
      },
    ]);
  }

  function resetAll() {
    if (!window.confirm("Reset all trips and inputs?")) return;
    setGasPrice("");
    setSplitCount("1");
    setTrips([makeTrip()]);
    setShareLink("");
    setShareWarn("");
    setCopyStatus("");
  }

  function buildShareLink() {
    const payload = JSON.stringify({ gasPrice, splitCount, trips });
    const encoded = toBase64Url(payload);
    const url = `${window.location.origin}${window.location.pathname}?data=${encoded}`;
    setShareLink(url);
    setShareWarn(url.length > 2000 ? "Warning: link is long and may not work in some apps." : "");
  }

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Clipboard failed. Copy manually from the field.");
    }
  }

  function openFilePicker(targetTripId) {
    if (ocrState.running) return;
    setOcrState((prev) => ({ ...prev, targetTripId, message: "", extracted: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setOcrState((prev) => ({
      ...prev,
      running: true,
      progress: 0,
      message: "",
      extracted: null,
      confidence: null,
    }));

    try {
      const canvas = await preprocessImage(file);
      const result = await Tesseract.recognize(canvas, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setOcrState((prev) => ({ ...prev, progress: Math.round((m.progress || 0) * 100) }));
          }
        },
      });
      const extracted = extractOcrCandidates(result.data.text || "");
      const confidence = Number(result.data.confidence || 0);
      const noValueFound =
        extracted.kmPerLiterCandidates.length === 0 && extracted.distanceCandidates.length === 0;

      setOcrState((prev) => ({
        ...prev,
        running: false,
        extracted: {
          ...extracted,
          kmPerLiter: extracted.kmPerLiterCandidates[0] ? String(extracted.kmPerLiterCandidates[0]) : "",
          distanceKm: extracted.distanceCandidates[0] ? String(extracted.distanceCandidates[0]) : "",
        },
        confidence,
        message:
          confidence < 50 || noValueFound
            ? "Could not confidently detect values. Please input manually."
            : "",
      }));
    } catch {
      setOcrState((prev) => ({
        ...prev,
        running: false,
        extracted: {
          rawText: "",
          kmPerLiterCandidates: [],
          distanceCandidates: [],
          kmPerLiter: "",
          distanceKm: "",
        },
        confidence: 0,
        message: "Couldn't detect, please input manually.",
      }));
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  }

  function closeOcrReview() {
    setOcrState({
      running: false,
      progress: 0,
      targetTripId: null,
      extracted: null,
      confidence: null,
      message: "",
    });
  }

  function applyOcrToTrip() {
    const extracted = ocrState.extracted;
    if (!extracted) return;
    const kpl = Number(extracted.kmPerLiter);
    const dist = Number(extracted.distanceKm);
    if (!(kpl > 0) || !(dist > 0)) {
      setOcrState((prev) => ({ ...prev, message: "Both values must be greater than 0." }));
      return;
    }

    if (ocrState.targetTripId === "new") {
      const newTrip = makeTrip();
      newTrip.kmPerLiter = String(kpl);
      newTrip.distanceKm = String(dist);
      setTrips((prev) => [...prev, newTrip]);
    } else {
      setTrips((prev) =>
        prev.map((t) =>
          t.id === ocrState.targetTripId
            ? { ...t, kmPerLiter: String(kpl), distanceKm: String(dist) }
            : t
        )
      );
    }
    closeOcrReview();
  }

  const splitAsInt = parseInt(splitCount || "1", 10);
  const isGasPriceValid = Number(gasPrice) > 0;
  const isSplitValid = Number.isInteger(splitAsInt) && splitAsInt >= 1;
  const enteredKpl = Number(ocrState.extracted?.kmPerLiter);
  const enteredDistance = Number(ocrState.extracted?.distanceKm);
  const outOfRangeKpl = enteredKpl > 0 && (enteredKpl < 3 || enteredKpl > 60);
  const outOfRangeDistance =
    enteredDistance > 0 && (enteredDistance < 0.1 || enteredDistance > 1000);

  return (
    <div className="app">
      <header className="app-header">
        <h1>AmbaGas</h1>
        <p>Fair fuel splits, no awkward singilan.</p>
      </header>

      {loadError ? <div className="alert error">{loadError}</div> : null}

      <section className="panel">
        <h2>Global Inputs</h2>
        <div className="grid">
          <label>
            Gas Price (PHP/L)
            <input
              type="number"
              min="0"
              step="0.01"
              value={gasPrice}
              onChange={(e) => setGasPrice(e.target.value)}
              placeholder="e.g. 51.20"
            />
          </label>
          <label>
            Split Count
            <input
              type="number"
              min="1"
              step="1"
              value={splitCount}
              onChange={(e) => setSplitCount(e.target.value)}
            />
          </label>
        </div>
        {(!isGasPriceValid || !isSplitValid) && (
          <div className="alert warn">Enter valid gas price and split count to get accurate totals.</div>
        )}
      </section>

      <section className="totals panel sticky">
        <h2>Totals</h2>
        <div className="totals-grid">
          <div>Total Distance: {formatNumber(totals.totalDistance, 2)} km</div>
          <div>Total Liters: {formatNumber(totals.totalLiters, 2)} L</div>
          <div>Total Cost: {formatCurrency(totals.totalCost)}</div>
          <div>Overall PHP/km: {formatCurrency(totals.overallPhpPerKm)}</div>
        </div>
        <div className="big-pay">Each person pays: {formatCurrency(totals.eachPays)}</div>
      </section>

      <section className="panel">
        <div className="row">
          <h2>Trips</h2>
          <div className="actions">
            <button onClick={addTrip}>Add Trip</button>
            <button onClick={() => openFilePicker("new")} disabled={ocrState.running}>
              Import Trip from Photo
            </button>
            <button className="danger" onClick={resetAll}>
              Reset All
            </button>
          </div>
        </div>

        {computedTrips.map((trip, idx) => (
          <article className="trip-card" key={trip.id}>
            <div className="row">
              <strong>Date: {trip.date || "N/A"}</strong>
              <div className="actions">
                <button onClick={() => duplicateTrip(trip.id)}>Duplicate</button>
                <button onClick={() => openFilePicker(trip.id)} disabled={ocrState.running}>
                  Import from Photo
                </button>
                <button className="danger" onClick={() => removeTrip(trip.id)}>
                  Remove
                </button>
              </div>
            </div>
            <div className="grid">
              <label>
                Date
                <input
                  type="date"
                  value={trip.date}
                  onChange={(e) => updateTrip(trip.id, "date", e.target.value)}
                />
              </label>
              <label>
                Label (optional)
                <input
                  type="text"
                  value={trip.label}
                  onChange={(e) => updateTrip(trip.id, "label", e.target.value)}
                  placeholder={`Trip ${idx + 1}`}
                />
              </label>
              <label>
                km/L
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trip.kmPerLiter}
                  onChange={(e) => updateTrip(trip.id, "kmPerLiter", e.target.value)}
                />
              </label>
              <label>
                Distance (km)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trip.distanceKm}
                  onChange={(e) => updateTrip(trip.id, "distanceKm", e.target.value)}
                />
              </label>
            </div>
            <div className="outputs">
              <div>Liters Used: {formatNumber(trip.litersUsed, 3)} L</div>
              <div>Trip Cost: {formatCurrency(trip.tripCost)}</div>
              <div>PHP per km: {formatCurrency(trip.phpPerKm)}</div>
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Share</h2>
        <div className="actions">
          <button onClick={buildShareLink}>Generate Share Link</button>
          <button onClick={copyShareLink} disabled={!shareLink}>
            Copy Link
          </button>
        </div>
        <input type="text" readOnly value={shareLink} placeholder="Share link appears here..." />
        {shareWarn ? <div className="alert warn">{shareWarn}</div> : null}
        {copyStatus ? <div className="alert">{copyStatus}</div> : null}
      </section>

      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="image/*,.heic,.HEIC,.heif,.HEIF"
        onChange={handleFileChange}
      />

      {(ocrState.running || ocrState.extracted) && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>OCR Review</h3>
            {ocrState.running ? (
              <div>
                <p>Processing image locally... {ocrState.progress}%</p>
                <progress value={ocrState.progress} max="100" />
              </div>
            ) : (
              <div>
                <p>
                  OCR Confidence:{" "}
                  {ocrState.confidence != null ? `${formatNumber(ocrState.confidence, 1)}%` : "N/A"}
                </p>
                {ocrState.message ? <div className="alert warn">{ocrState.message}</div> : null}
                <div className="grid">
                  <label>
                    km/L
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ocrState.extracted?.kmPerLiter || ""}
                      onChange={(e) =>
                        setOcrState((prev) => ({
                          ...prev,
                          extracted: { ...prev.extracted, kmPerLiter: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Distance (km)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ocrState.extracted?.distanceKm || ""}
                      onChange={(e) =>
                        setOcrState((prev) => ({
                          ...prev,
                          extracted: { ...prev.extracted, distanceKm: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="hint">
                  km/L expected range: 3 to 60. Distance expected range: 0.1 to 1000. Values outside
                  range are allowed with manual confirmation.
                </div>
                {(outOfRangeKpl || outOfRangeDistance) && (
                  <div className="alert warn">
                    Value is outside expected range. You can still apply if this is correct.
                  </div>
                )}
                <div className="candidates">
                  <p>Detected km/L candidates: {ocrState.extracted?.kmPerLiterCandidates.join(", ") || "None"}</p>
                  <p>
                    Detected distance candidates:{" "}
                    {ocrState.extracted?.distanceCandidates.join(", ") || "None"}
                  </p>
                </div>
                <details>
                  <summary>Raw OCR Text</summary>
                  <pre>{ocrState.extracted?.rawText || "(empty)"}</pre>
                </details>
                <div className="actions">
                  <button onClick={applyOcrToTrip}>Apply to Trip</button>
                  <button className="secondary" onClick={closeOcrReview}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
