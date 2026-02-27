import Razorpay from "razorpay";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import mqtt from "mqtt";

const app = express();
app.use(cors());
app.use(express.json());

// ─── Razorpay Test Credentials ───────────────────────────────
const KEY_ID = "rzp_test_SLBq0gDi6V7ADV";
const KEY_SECRET = "bXjhr0e8pS2FDN6aVFsBkpcJ";

const razorpay = new Razorpay({
    key_id: KEY_ID,
    key_secret: KEY_SECRET,
});

// ─── MQTT Config ─────────────────────────────────────────────
const MQTT_BROKER = "mqtt://XX.XXX.XX.XXX:1883";
const MQTT_USER = "XXXCXXXXXXC";
const MQTT_PASS = "XCXXXXXX";
const MQTT_TOPIC_PARKING = "smart parking";
const MQTT_TOPIC_PAYMENT = "payment";

// ─── Slot State ──────────────────────────────────────────────
const RATE_PER_SECOND = 1; // ₹1 per second

let slotState = {
    occupied: false,
    entryTime: null,      // timestamp in ms when vehicle parked
    paid: false,          // whether payment was made for current session
    lastPaymentId: null,
};

// ─── MQTT Client ─────────────────────────────────────────────
const mqttClient = mqtt.connect(MQTT_BROKER, {
    username: MQTT_USER,
    password: MQTT_PASS,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
});

mqttClient.on("connect", () => {
    console.log(`✅ MQTT Connected to ${MQTT_BROKER}`);
    mqttClient.subscribe(MQTT_TOPIC_PARKING, (err) => {
        if (err) {
            console.error("❌ MQTT Subscribe error:", err);
        } else {
            console.log(`📡 Subscribed to topic: "${MQTT_TOPIC_PARKING}"`);
        }
    });
});

mqttClient.on("error", (err) => {
    console.error("❌ MQTT Error:", err.message);
});

mqttClient.on("reconnect", () => {
    console.log("🔄 MQTT Reconnecting...");
});

mqttClient.on("message", (topic, payload) => {
    const message = payload.toString();
    console.log(`📨 MQTT [${topic}]: ${message}`);

    if (topic === MQTT_TOPIC_PARKING) {
        try {
            const data = JSON.parse(message);

            if (data.slot_1 === "occupied" && data.vehicle_present === 1) {
                if (!slotState.occupied) {
                    // Vehicle just parked
                    slotState.occupied = true;
                    slotState.entryTime = Date.now();
                    slotState.paid = false;
                    slotState.lastPaymentId = null;
                    console.log(`🚗 Vehicle PARKED at ${new Date(slotState.entryTime).toLocaleTimeString()}`);
                }
            } else if (data.slot_1 === "available" && data.vehicle_present === 0) {
                // Vehicle left
                console.log("🚗 Vehicle LEFT — slot available");
                slotState.occupied = false;
                slotState.entryTime = null;
                slotState.paid = false;
                slotState.lastPaymentId = null;
            }
        } catch (e) {
            console.error("❌ Failed to parse MQTT message:", e.message);
        }
    }
});

// ─── API: Get Slot Status ────────────────────────────────────
app.get("/api/slot-status", (req, res) => {
    if (!slotState.occupied || !slotState.entryTime) {
        return res.json({
            occupied: slotState.occupied,
            entryTime: null,
            elapsedSeconds: 0,
            costRupees: 0,
            paid: slotState.paid,
            lastPaymentId: slotState.lastPaymentId,
            mqttConnected: mqttClient.connected,
        });
    }

    const elapsedMs = Date.now() - slotState.entryTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const costRupees = elapsedSeconds * RATE_PER_SECOND;

    res.json({
        occupied: true,
        entryTime: slotState.entryTime,
        elapsedSeconds,
        costRupees,
        paid: slotState.paid,
        lastPaymentId: slotState.lastPaymentId,
        mqttConnected: mqttClient.connected,
    });
});

// ─── API: Create Razorpay Order ──────────────────────────────
app.post("/api/create-order", async (req, res) => {
    try {
        // Calculate cost at the moment of order creation
        if (!slotState.occupied || !slotState.entryTime) {
            return res.status(400).json({ error: "No vehicle currently parked" });
        }

        const elapsedMs = Date.now() - slotState.entryTime;
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const costRupees = Math.max(elapsedSeconds * RATE_PER_SECOND, 1); // minimum ₹1

        const options = {
            amount: costRupees * 100, // Razorpay expects paise
            currency: "INR",
            receipt: `parking_slot1_${Date.now()}`,
            notes: {
                slot: "slot_1",
                entry_time: new Date(slotState.entryTime).toISOString(),
                duration_seconds: elapsedSeconds,
            },
        };

        const order = await razorpay.orders.create(options);
        console.log(`✅ Order created: ${order.id} | ₹${costRupees} (${elapsedSeconds}s)`);
        res.json({ ...order, costRupees, elapsedSeconds });
    } catch (err) {
        console.error("❌ Order creation failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// ─── API: Verify Payment & Publish MQTT ──────────────────────
app.post("/api/verify-payment", (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature === razorpay_signature) {
            console.log(`✅ Payment verified: ${razorpay_payment_id}`);

            // Mark as paid
            slotState.paid = true;
            slotState.lastPaymentId = razorpay_payment_id;

            // 🚪 Publish to MQTT "payment" topic → ESP32 opens gate
            if (mqttClient.connected) {
                mqttClient.publish(MQTT_TOPIC_PAYMENT, "1", { qos: 1 }, (err) => {
                    if (err) {
                        console.error("❌ MQTT Publish error:", err);
                    } else {
                        console.log(`🚪 MQTT Published to "${MQTT_TOPIC_PAYMENT}": 1 → GATE OPENING`);
                    }
                });
            } else {
                console.warn("⚠️ MQTT not connected — could not publish payment signal");
            }

            res.json({
                success: true,
                message: "Payment verified! Gate is opening...",
                payment_id: razorpay_payment_id,
            });
        } else {
            console.log("❌ Signature mismatch");
            res.status(400).json({ success: false, message: "Invalid signature" });
        }
    } catch (err) {
        console.error("❌ Verification failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// ─── API: Simulate Vehicle Entry (for testing without ESP32) ─
app.post("/api/simulate/park", (req, res) => {
    slotState.occupied = true;
    slotState.entryTime = Date.now();
    slotState.paid = false;
    slotState.lastPaymentId = null;
    console.log(`🧪 [SIMULATE] Vehicle parked at ${new Date().toLocaleTimeString()}`);
    res.json({ message: "Simulated: Vehicle parked", entryTime: slotState.entryTime });
});

app.post("/api/simulate/leave", (req, res) => {
    slotState.occupied = false;
    slotState.entryTime = null;
    slotState.paid = false;
    slotState.lastPaymentId = null;
    console.log("🧪 [SIMULATE] Vehicle left");
    res.json({ message: "Simulated: Vehicle left" });
});

// ─── Start Server ────────────────────────────────────────────
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`\n🚀 Smart Parking Backend running at http://localhost:${PORT}`);
    console.log(`   Razorpay Key: ${KEY_ID} (TEST)`);
    console.log(`   MQTT Broker:  ${MQTT_BROKER}`);
    console.log(`   Rate:         ₹${RATE_PER_SECOND}/sec\n`);
});
