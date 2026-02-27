# 🅿️ Smart Parking Payment System

A real-time parking payment system built with **React + Express** that integrates with **ESP32 hardware via MQTT** and **Razorpay** for payments.

## How It Works

1. 🚗 Vehicle parks → ESP32 sends MQTT message (`slot_1: "occupied"`)
2. ⏱️ Backend starts a timer (₹1/sec)
3. 📱 Driver scans QR code → opens web app
4. 💰 Driver sees live timer + cost → clicks **Pay**
5. 💳 Razorpay checkout opens → payment completed
6. 🚪 Backend publishes `payment=1` to MQTT → ESP32 opens the gate

---

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone git@github.com:inventor-biswa/SMART_PARKING-.git
cd SMART_PARKING-
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure MQTT Broker

Open `server.js` and update these lines with your MQTT broker details:

```javascript
const MQTT_BROKER = "mqtt://YOUR_BROKER_IP:1883";
const MQTT_USER = "your_username";
const MQTT_PASS = "your_password";
```

### 4. Configure Razorpay (optional)

If you have your own Razorpay test keys, update these in `server.js` and `src/App.jsx`:

```javascript
// server.js
const KEY_ID = "rzp_test_XXXXXXXXXXXX";
const KEY_SECRET = "XXXXXXXXXXXXXXXX";

// src/App.jsx
const RAZORPAY_KEY = "rzp_test_XXXXXXXXXXXX";
```

### 5. Start the Backend

```bash
npm run server
```

This starts the Express server on **http://localhost:4000** and connects to your MQTT broker.

### 6. Start the Frontend

Open a **new terminal** and run:

```bash
npm run dev
```

This starts the React app on **http://localhost:5173**.

### 7. Open in browser

Go to **http://localhost:5173** — you're ready!

---

## 🧪 Testing Without ESP32

The app has built-in **Simulate** buttons at the bottom of the page:

- **🚗 Simulate Park** — Simulates a vehicle parking (starts the timer)
- **🚪 Simulate Leave** — Simulates the vehicle leaving (resets everything)

### Test Payment Credentials

| Method | Details |
|--------|---------|
| **Card** | `4111 1111 1111 1111`, any future expiry, any 3-digit CVV |
| **UPI** | `success@razorpay` |
| **Netbanking** | Select any bank (auto-succeeds in test mode) |

---

## 📡 MQTT Topics

| Topic | Direction | Payload |
|-------|-----------|---------|
| `smart parking` | ESP32 → Backend | `{"slot_1":"occupied","vehicle_present":1}` |
| `smart parking` | ESP32 → Backend | `{"slot_1":"available","vehicle_present":0}` |
| `payment` | Backend → ESP32 | `1` (on successful payment) |

---

## 📁 Project Structure

```
├── server.js          # Express backend (MQTT + Razorpay)
├── src/
│   ├── App.jsx        # React payment UI
│   ├── App.css        # Styling (dark theme)
│   ├── main.jsx       # Entry point
│   └── index.css      # Global styles
├── package.json
└── index.html
```

---

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Express.js + Node.js
- **Payments:** Razorpay
- **IoT Communication:** MQTT
- **Hardware:** ESP32

---

## ⚠️ Notes

- This uses **Razorpay TEST mode** — no real money is charged.
- Make sure your MQTT broker is running and accessible before starting the backend.
- Both the backend (port 4000) and frontend (port 5173) must be running simultaneously.
