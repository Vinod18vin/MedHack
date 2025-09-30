require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const Twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/** ------------------------- Environment Variables ------------------------- **/
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const HOSPITAL_KEY = process.env.HOSPITAL_KEY;

/** ------------------------- Google Sheets Auth ------------------------- **/
const auth = new google.auth.GoogleAuth({
  keyFile: './service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

/** ------------------------- Nodemailer ------------------------- **/
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

/** ------------------------- SHA-256 & AES ------------------------- **/
function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

const algorithm = 'aes-256-cbc';
const key = crypto.createHash('sha256').update(String(PRIVATE_KEY)).digest('base64').substr(0, 32);
const iv = Buffer.alloc(16, 0);

function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function decrypt(encrypted) {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** ------------------------- Google Sheets Utilities ------------------------- **/
async function appendRow(rowValues) {
  const client = await auth.getClient();
  const sheetsApi = google.sheets({ version: 'v4', auth: client });
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [rowValues] }
  });
}

async function getLastHash() {
  const client = await auth.getClient();
  const sheetsApi = google.sheets({ version: 'v4', auth: client });
  const resp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!D2:D'
  });
  const rows = resp.data.values || [];
  return rows.length ? rows[rows.length - 1][0] : null;
}

async function findRowByAppointmentId(appointmentId) {
  const client = await auth.getClient();
  const sheetsApi = google.sheets({ version: 'v4', auth: client });
  const resp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A2:F'
  });
  const rows = resp.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] && String(row[0]).trim() === String(appointmentId).trim()) return { row, sheetRowNumber: i + 2 };
  }
  return null;
}

function isValidHospitalKey(providedKey) {
  const provided = Buffer.from(String(providedKey));
  const actual = Buffer.from(String(HOSPITAL_KEY));
  if (provided.length !== actual.length) {
    const maxLen = Math.max(provided.length, actual.length);
    const p = Buffer.alloc(maxLen); provided.copy(p);
    const a = Buffer.alloc(maxLen); actual.copy(a);
    return crypto.timingSafeEqual(p, a);
  }
  return crypto.timingSafeEqual(provided, actual);
}

/** ------------------------- Twilio Setup ------------------------- **/
const twilioClient = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function getLangCode(language) {
  if (language === 'Hindi') return 'hi-IN';
  if (language === 'Marathi') return 'mr-IN';
  return 'en-US';
}

function getQuestionText(question, language) {
  const texts = {
    name: { English: 'Please say your full name', Hindi: 'कृपया अपना पूरा नाम बताएं', Marathi: 'कृपया आपले पूर्ण नाव सांगा' },
    age: { English: 'Please say your age', Hindi: 'कृपया अपनी आयु बताएं', Marathi: 'कृपया आपले वय सांगा' },
    email: { English: 'Please say your email address', Hindi: 'कृपया अपना ईमेल पता बताएं', Marathi: 'कृपया आपला ईमेल पत्ता सांगा' },
    symptoms: { English: 'Please describe your symptoms', Hindi: 'कृपया अपने लक्षण बताएं', Marathi: 'कृपया आपले लक्षण सांगा' },
    doctor: { English: 'Press 1 for Dr. A. Press 2 for Dr. B.', Hindi: 'डॉ. ए के लिए 1 दबाएँ। डॉ. बी के लिए 2 दबाएँ।', Marathi: 'डॉ. A साठी 1 दाबा. डॉ. B साठी 2 दाबा.' },
    mode: { English: 'Press 1 for Online. Press 2 for Offline.', Hindi: 'ऑनलाइन के लिए 1 दबाएँ। ऑफ़लाइन के लिए 2 दबाएँ।', Marathi: 'ऑनलाइन साठी 1 दाबा. ऑफलाइन साठी 2 दाबा.' },
    thank: { English: 'Thank you! Your appointment is recorded.', Hindi: 'धन्यवाद! आपकी अपॉइंटमेंट रिकॉर्ड हो गई है।', Marathi: 'धन्यवाद! आपली अपॉइंटमेंट नोंदवली गेली आहे.' }
  };
  return texts[question][language];
}

/** ------------------------- Transcript Cleaning ------------------------- **/
function fixEmailTranscript(transcript) {
  return transcript.toLowerCase().replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '').replace(/[.,;:!?]+$/g, '');
}

function cleanTranscript(transcript) {
  return transcript.trim().replace(/[.,;:!?]+$/g, '');
}

/** ------------------------- Core Appointment Submission ------------------------- **/
async function submitAppointmentCore({ name, age, email, symptoms, doctor, mode, language }) {
  if (!name || !email) throw new Error("Missing required fields (name/email)");

  const sensitiveData = { age, email, symptoms, doctor, mode, language };
  const encryptedData = encrypt(JSON.stringify(sensitiveData));

  const concat = `${name}${JSON.stringify(sensitiveData)}`;
  const hash = sha256(concat);
  const prevHash = await getLastHash() || 'GENESIS';
  const id = 'APPT-' + Math.floor(Math.random() * 1000000);

  const appointmentTimestamp = new Date();
  appointmentTimestamp.setDate(appointmentTimestamp.getDate() + 1);
  appointmentTimestamp.setHours(Math.floor(Math.random() * 8) + 9);
  appointmentTimestamp.setMinutes(Math.floor(Math.random() * 60));

  const istOffset = 5.5 * 60;
  const appointmentIST = new Date(appointmentTimestamp);
  appointmentIST.setMinutes(appointmentIST.getMinutes() + istOffset);
  const appointmentISTString = appointmentIST.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });

  let qrContent = `Appointment ID: ${id}\nDate/Time (IST): ${appointmentISTString}\nMode: ${mode}`;
  if (mode.toLowerCase() === 'online') qrContent += `\nVideo Call Link: https://videocallwithdoc.com/${id}`;
  const qrPath = `./${id}-qr.png`;
  await QRCode.toFile(qrPath, qrContent, { width: 300 });

  let htmlContent = `<p>Hello <b>${name}</b>,</p>
  <p>Your appointment is <b>confirmed</b>.</p>
  <p><b>Appointment ID:</b> ${id}</p>
  <p><b>Date/Time (IST):</b> ${appointmentISTString}</p>
  <p><b>Mode:</b> ${mode}</p>`;

  if (mode.toLowerCase() === 'online') {
    htmlContent += `<p><b>Video Call Link:</b> <a href="https://videocallwithdoc.com/${id}">Join Meeting</a></p>`;
  }

  // --- Reschedule button ---
  htmlContent += `<p><a href="${process.env.SERVER_URL}/reschedule/${id}" style="display:inline-block;padding:10px 20px;background-color:#007bff;color:#fff;text-decoration:none;border-radius:5px;">Reschedule Appointment</a></p>`;

  await transporter.sendMail({ from: EMAIL_USER, to: email, subject: 'Your Hospital Appointment', html: htmlContent, attachments: [{ filename: 'appointment-qr.png', path: qrPath }] });

  await appendRow([id, name, encryptedData, hash, prevHash, appointmentISTString]);

  return { id, hash, prevHash, appointmentTime: appointmentISTString };
}

/** ------------------------- Manual Appointment ------------------------- **/
app.post('/submitAppointment', async (req, res) => {
  try {
    const { name, age, email, symptoms, doctor, mode, language } = req.body;
    if (!name || !email) return res.status(400).json({ ok: false, error: 'Name and Email required' });

    const result = await submitAppointmentCore({ name, age, email, symptoms, doctor, mode, language });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Manual flow error:", err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/** ------------------------- Voice Flow ------------------------- **/
app.locals.voiceAnswers = {}; // Global store for all active calls

app.post('/triggerCall', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: 'Phone number required' });

  try {
    const call = await twilioClient.calls.create({
      url: `${process.env.SERVER_URL}/voice`,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    res.json({ ok: true, sid: call.sid });
  } catch (err) {
    console.error("Trigger call error:", err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

// Voice route
app.post('/voice', (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  const gather = twiml.gather({ input: 'dtmf', numDigits: 1, action: '/languageSelected' });
  gather.say('Press 1 for English. Press 2 for Hindi. Press 3 for Marathi.');
  res.type('text/xml'); res.send(twiml.toString());
});

app.post('/languageSelected', (req,res)=>{
  const digit = req.body.Digits;
  let language = 'English';
  if(digit==='2') language='Hindi';
  if(digit==='3') language='Marathi';
  const langCode = getLangCode(language);

  // ensure per-call storage
  if(!app.locals.voiceAnswers[req.body.CallSid]) app.locals.voiceAnswers[req.body.CallSid] = {};

  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say({ language: langCode }, `You selected ${language}`);
  twiml.gather({ input:'speech', action:`/collectAnswer?question=name&language=${language}`, speechTimeout:'auto' })
      .say({ language: langCode }, getQuestionText('name', language));
  res.type('text/xml'); res.send(twiml.toString());
});

app.post('/collectAnswer', async (req,res)=>{
  const { question, language } = req.query;
  const recordingUrl = req.body.RecordingUrl;
  const langCode = getLangCode(language);
  let transcript = '';

  // ensure per-call storage
  if(!app.locals.voiceAnswers[req.body.CallSid]) app.locals.voiceAnswers[req.body.CallSid] = {};

  try {
    if(recordingUrl){
      const response = await axios.post('https://api.deepgram.com/v1/listen', 
        { url: recordingUrl, language: langCode.split('-')[0], punctuate:true, model:'general' },
        { headers: { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type':'application/json' } }
      );
      transcript = response.data?.results?.channels[0]?.alternatives[0]?.transcript || '';
    } else if(req.body.SpeechResult){
      transcript = req.body.SpeechResult;
    }

    transcript = transcript.toLowerCase();
    if(question==='email' && transcript) transcript = fixEmailTranscript(transcript);
    else transcript = cleanTranscript(transcript);

  } catch(err){ console.error('Deepgram STT error:', err); }

  app.locals.voiceAnswers[req.body.CallSid][question] = transcript;
  console.log(`Collected [${question}] = ${transcript}`);

  const twiml = new Twilio.twiml.VoiceResponse();
  switch(question){
    case 'name':
      twiml.gather({ input:'speech', action:`/collectAnswer?question=age&language=${language}`, speechTimeout:'auto' })
          .say({ language: langCode }, getQuestionText('age', language));
      break;
    case 'age':
      twiml.gather({ input:'speech', action:`/collectAnswer?question=email&language=${language}`, speechTimeout:'auto' })
          .say({ language: langCode }, getQuestionText('email', language));
      break;
    case 'email':
      twiml.gather({ input:'speech', action:`/collectAnswer?question=symptoms&language=${language}`, speechTimeout:'auto' })
          .say({ language: langCode }, getQuestionText('symptoms', language));
      break;
    case 'symptoms':
      const gatherDoctor = twiml.gather({ input:'dtmf', numDigits:1, action:`/doctorSelected?language=${language}` });
      gatherDoctor.say({ language: langCode }, getQuestionText('doctor', language));
      break;
  }
  res.type('text/xml'); res.send(twiml.toString());
});

app.post('/doctorSelected', (req,res)=>{
  const { language } = req.query;
  const digit = req.body.Digits;
  const doctor = digit==='2'?'Dr. Kiran':'Dr. Ravi';
  const langCode = getLangCode(language);

  if(!app.locals.voiceAnswers[req.body.CallSid]) app.locals.voiceAnswers[req.body.CallSid] = {};
  app.locals.voiceAnswers[req.body.CallSid]['doctor'] = doctor;

  console.log("Doctor selected:", doctor);

  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say({ language: langCode }, `You selected ${doctor}`);
  const gatherMode = twiml.gather({ input:'dtmf', numDigits:1, action:`/modeSelected?language=${language}` });
  gatherMode.say({ language: langCode }, getQuestionText('mode', language));
  res.type('text/xml'); res.send(twiml.toString());
});

app.post('/modeSelected', async (req,res)=>{
  const { language } = req.query;
  const digit = req.body.Digits;
  const mode = digit==='2'?'offline':'online';
  const langCode = getLangCode(language);

  if(!app.locals.voiceAnswers[req.body.CallSid]) app.locals.voiceAnswers[req.body.CallSid] = {};
  const callData = app.locals.voiceAnswers[req.body.CallSid];
  callData['mode'] = mode;
  callData['language'] = language;

  console.log("Final Voice Call Data:", callData);

  try{
    const result = await submitAppointmentCore({
      name: callData['name'],
      age: callData['age'],
      email: callData['email'],
      symptoms: callData['symptoms'],
      doctor: callData['doctor'],
      mode: callData['mode'],
      language: callData['language']
    });
    console.log("Appointment stored from voice:", result);

    delete app.locals.voiceAnswers[req.body.CallSid]; // clean up

    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.say({ language: langCode }, `You selected ${mode}. ${getQuestionText('thank', language)}`);
    res.type('text/xml'); res.send(twiml.toString());
  } catch(err){
    console.error("Error saving appointment from voice:", err); 
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.say({ language: langCode }, "Sorry, an error occurred while saving your appointment.");
    res.type('text/xml'); res.send(twiml.toString());
  }
});

// ------------------------- Get Appointment by ID ------------------------- //
app.post('/getAppointment', async (req, res) => {
  try {
    const { appointmentId, hospitalKey } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ ok: false, error: "appointmentId is required" });
    }

    const result = await findRowByAppointmentId(appointmentId);
    if (!result) {
      return res.status(404).json({ ok: false, error: "Appointment not found" });
    }

    const [id, name, encryptedData, hash, prevHash, time] = result.row;

    // Default restricted message
    let OriginalData = "INVALID KEY";

    // Only decrypt if valid hospital key is provided
    if (hospitalKey && isValidHospitalKey(hospitalKey)) {
      try {
        const decryptedString = decrypt(encryptedData);
        OriginalData = JSON.parse(decryptedString); // Convert to JSON object
      } catch (err) {
        OriginalData = "Decryption failed";
      }
    }

    res.json({
      ok: true,
      appointmentId: id,
      name,
      OriginalData,
      hash,
      prevHash,
      appointmentTime: time,
      sheetRowNumber: result.sheetRowNumber
    });
  } catch (err) {
    console.error("getAppointment error:", err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/** ------------------------- Start Server ------------------------- **/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
