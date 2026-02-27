import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const RAZORPAY_KEY = "rzp_test_SLBq0gDi6V7ADV";
const API_URL = "http://localhost:4000/api";

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function App() {
  const [slot, setSlot] = useState({
    occupied: false,
    entryTime: null,
    elapsedSeconds: 0,
    costRupees: 0,
    paid: false,
    lastPaymentId: null,
    mqttConnected: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [localElapsed, setLocalElapsed] = useState(0);
  const timerRef = useRef(null);
  const resultRef = useRef(null);

  // ─── Poll slot status from backend ────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/slot-status`);
      const data = await res.json();
      setSlot(data);
      if (data.occupied && data.entryTime) {
        setLocalElapsed(data.elapsedSeconds);
      }
    } catch {
      // backend not reachable
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); // poll every 3s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ─── Local timer ticks every second for smooth display ────
  useEffect(() => {
    if (slot.occupied && slot.entryTime && !slot.paid) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - slot.entryTime) / 1000);
        setLocalElapsed(elapsed);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [slot.occupied, slot.entryTime, slot.paid]);

  // ─── Load Razorpay SDK ────────────────────────────────────
  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (document.getElementById("razorpay-sdk")) return resolve(true);
      const script = document.createElement("script");
      script.id = "razorpay-sdk";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  // ─── Handle Payment ───────────────────────────────────────
  const handlePay = async () => {
    setLoading(true);
    setResult(null);

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      setResult({ type: "error", message: "Failed to load Razorpay SDK." });
      setLoading(false);
      return;
    }

    try {
      // Create order — backend calculates exact cost at this moment
      const res = await fetch(`${API_URL}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Order creation failed");
      }
      const order = await res.json();

      const options = {
        key: RAZORPAY_KEY,
        amount: order.amount,
        currency: order.currency,
        name: "Smart Parking",
        description: `Parking Fee — ${formatTime(order.elapsedSeconds)} parked`,
        order_id: order.id,
        prefill: {
          name: "Driver",
          email: "driver@smartparking.com",
          contact: "9999999999",
        },
        theme: { color: "#6C63FF" },
        handler: async (response) => {
          try {
            const verifyRes = await fetch(`${API_URL}/verify-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const data = await verifyRes.json();

            if (data.success) {
              setResult({
                type: "success",
                message: "Payment Successful! Gate is opening...",
                paymentId: response.razorpay_payment_id,
                amount: order.costRupees,
              });
              // Refresh slot status
              setTimeout(fetchStatus, 1000);
            } else {
              setResult({ type: "error", message: "Signature verification failed!" });
            }
          } catch {
            setResult({ type: "error", message: "Verification request failed." });
          }
          setLoading(false);
          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
        },
        modal: {
          ondismiss: () => {
            setResult({ type: "warning", message: "Payment cancelled." });
            setLoading(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (resp) => {
        setResult({
          type: "error",
          message: `Payment Failed: ${resp.error.description}`,
        });
        setLoading(false);
      });
      rzp.open();
    } catch (err) {
      setResult({ type: "error", message: err.message });
      setLoading(false);
    }
  };

  // ─── Simulate parking (dev/testing helper) ────────────────
  const simulatePark = async () => {
    await fetch(`${API_URL}/simulate/park`, { method: "POST" });
    fetchStatus();
  };

  const simulateLeave = async () => {
    await fetch(`${API_URL}/simulate/leave`, { method: "POST" });
    setResult(null);
    fetchStatus();
  };

  const currentCost = localElapsed * 1; // ₹1/sec
  const isGateOpen = slot.paid;

  return (
    <div className="app">
      {/* Animated background */}
      <div className="bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">🅿️</span>
          <h1 className="logo-text">Smart Parking</h1>
        </div>
        <div className="header-right">
          <span className={`mqtt-dot ${slot.mqttConnected ? "connected" : ""}`} />
          <span className="badge">TEST MODE</span>
        </div>
      </header>

      <main className="main">

        {/* ─── Slot Status Card ─────────────────────────────── */}
        <section className={`slot-card ${slot.occupied ? "occupied" : "available"} ${isGateOpen ? "gate-open" : ""}`}>
          <div className="slot-indicator">
            <div className={`slot-dot ${slot.occupied ? "red" : "green"}`} />
            <span className="slot-label">Slot 1</span>
          </div>
          <div className="slot-status-text">
            {isGateOpen
              ? "✅ PAID — Gate Open"
              : slot.occupied
                ? "🚗 Vehicle Parked"
                : "🟢 Available"}
          </div>
        </section>

        {/* ─── Timer & Cost (only when occupied & not paid) ─── */}
        {slot.occupied && !isGateOpen && (
          <section className="timer-section">
            <div className="timer-card">
              <span className="timer-label">Time Parked</span>
              <div className="timer-display">{formatTime(localElapsed)}</div>
            </div>
            <div className="cost-card">
              <span className="cost-label">Amount Due</span>
              <div className="cost-display">
                <span className="rupee">₹</span>
                <span className="cost-amount">{currentCost}</span>
              </div>
              <span className="cost-rate">@ ₹1/sec</span>
            </div>
          </section>
        )}

        {/* ─── Pay Button ──────────────────────────────────── */}
        {slot.occupied && !isGateOpen && (
          <button
            className="pay-btn"
            disabled={loading || currentCost < 1}
            onClick={handlePay}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                Processing...
              </span>
            ) : (
              <>Pay ₹{currentCost} &amp; Open Gate</>
            )}
          </button>
        )}

        {/* ─── Gate Open Success ────────────────────────────── */}
        {isGateOpen && (
          <section className="gate-section" ref={resultRef}>
            <div className="gate-anim">
              <div className="gate-bar left" />
              <div className="gate-bar right" />
            </div>
            <h2 className="gate-title">🚪 Gate is Open!</h2>
            <p className="gate-sub">Drive through safely. Have a nice day!</p>
            {slot.lastPaymentId && (
              <p className="payment-id">Payment ID: <code>{slot.lastPaymentId}</code></p>
            )}
          </section>
        )}

        {/* ─── Result Card (errors / warnings) ─────────────── */}
        {result && result.type !== "success" && (
          <section className={`result-card ${result.type}`} ref={resultRef}>
            <span className="result-icon">
              {result.type === "warning" ? "⚠️" : "❌"}
            </span>
            <p className="result-msg">{result.message}</p>
          </section>
        )}

        {/* ─── Success Result ──────────────────────────────── */}
        {result && result.type === "success" && !isGateOpen && (
          <section className="result-card success" ref={resultRef}>
            <span className="result-icon">✅</span>
            <div>
              <p className="result-msg">{result.message}</p>
              <p className="result-sub">Amount: ₹{result.amount} · ID: {result.paymentId}</p>
            </div>
          </section>
        )}

        {/* ─── Not Parked State ─────────────────────────────── */}
        {!slot.occupied && (
          <section className="empty-state">
            <div className="empty-icon">🅿️</div>
            <h2>No Vehicle Parked</h2>
            <p>Slot 1 is currently available. Park your vehicle to start the meter.</p>
          </section>
        )}

        {/* ─── Test Card Reference ─────────────────────────── */}
        <section className="section test-section">
          <h2><span className="section-icon">💳</span> Test Payment Info</h2>
          <div className="test-cards">
            <div className="test-card">
              <h4>Card Payment</h4>
              <p><strong>Number:</strong> <code>4111 1111 1111 1111</code></p>
              <p><strong>Expiry:</strong> Any future date</p>
              <p><strong>CVV:</strong> Any 3 digits</p>
            </div>
            <div className="test-card">
              <h4>UPI</h4>
              <p><strong>UPI ID:</strong> <code>success@razorpay</code></p>
            </div>
          </div>
        </section>

        {/* ─── Simulate Controls (Dev Only) ────────────────── */}
        <section className="section simulate-section">
          <h2><span className="section-icon">🧪</span> Simulate <span className="optional">(dev testing)</span></h2>
          <p className="sim-desc">Use these buttons to simulate vehicle entry/exit without ESP32 hardware.</p>
          <div className="sim-btns">
            <button className="sim-btn park" onClick={simulatePark} disabled={slot.occupied}>
              🚗 Simulate Park
            </button>
            <button className="sim-btn leave" onClick={simulateLeave} disabled={!slot.occupied}>
              🚪 Simulate Leave
            </button>
          </div>
        </section>

      </main>

      <footer className="footer">
        <p>🔒 Test Mode — No real money is charged</p>
      </footer>
    </div>
  );
}

export default App;
