## Project Overview

**VocalisChain Schedule** is an advanced healthcare solution developed to solve the critical barrier of access for **illiterate or non-tech-savvy users** while guaranteeing the **security and integrity** of medical records. Our platform provides a unified, "omni-channel" system where patients can book appointments using either a modern mobile form or an automated, multi-lingual voice call, with all transactions secured using cryptographic hashing.

This project showcases a comprehensive, end-to-end application integrating complex AI, voice, mobile development, and decentralized security concepts.

## 🌟 Key Innovations

* **Universal Accessibility (Voice-Enabled Forms):** Illiterate users initiate a voice call that intelligently walks them through the form-filling process in their native language (Hindi, Marathi, English).
* **AI-Driven Triage:** The system utilizes **Deepgram STT** for accurate transcription and internal **AI logic** (Node.js classification) to analyze symptoms and automatically assign the patient to the most appropriate doctor/specialty.
* **Decentralized Data Security (VocalisChain):** All appointment data is secured using **SHA-256 hashing** linked to the previous record, creating an immutable, auditable chain that verifies data integrity. Sensitive PII is further protected via **AES-256 encryption**.
* **Resilient Mobile Frontend:** The Kotlin Android app features robust error handling, including **double-click prevention (debouncing)** and custom logic to ensure the form clears automatically upon successful, verified submission.

## 🛠️ Technology Stack

| Component | Technology | Role in System |
| :--- | :--- | :--- |
| **Mobile Frontend** | **Kotlin (Android)** | Provides the sleek, professional **SmartAppointment** UI, form validation, and external service triggering. |
| **Backend/Core Logic** | **Node.js / Express** | Central API for request routing, security hashing, encryption/decryption, and housing the AI triage logic. |
| **Voice & Transcription** | **Twilio TwiML / Deepgram API** | Manages interactive voice response (IVR) dialogue and provides high-accuracy, multi-lingual Speech-to-Text (STT). |
| **Data Integrity (Chain)** | **SHA-256 Cryptography** | Creates the blockchain-like hash chain to ensure record immutability. |
| **Data Privacy** | **AES-256 Encryption** | Encrypts sensitive PII before storage in the database. |
| **Database** | **Google Sheets (as Ledger)** | Used for persistent, auditable record storage (acting as a basic ledger). |

## ✨ Features Implemented

* **Omni-Channel Submission:** Supports form via Android App and data capture via automated Voice Call.
* **Intelligent Routing:** AI classification of symptoms directs the patient to the correct specialist.
* **Transactional Security:** Each record is cryptographically verified to prevent tampering.
* **Real-time Notifications:** Instant email confirmations with Appointment ID and QR Code upon successful booking.
* **Professional UI/UX:** Modern Material Design, card-based layouts, and responsive interaction patterns in the Android app.

---



