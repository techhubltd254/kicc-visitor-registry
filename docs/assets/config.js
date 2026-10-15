/* AUTO-GENERATED from config/event.config.json — do not edit by hand. */
/* Run `npm run build` after changing the config. */
window.KICC_CONFIG = {
  "site": {
    "name": "KICC Visitor Registration",
    "organisation": "The Kenyatta International Convention Centre",
    "shortName": "KICC",
    "tagline": "Africa's Premier Meeting Venue",
    "address": "Harambee Avenue, Nairobi, Kenya",
    "supportEmail": "events@kicc.co.ke",
    "supportPhone": "+254 (0)20 326 1000",
    "url": "https://kiccvisitorsregistration.co.ke",
    "logo": "assets/logo.svg",
    "favicon": "assets/favicon.svg"
  },
  "brand": {
    "red": "#962228",
    "redDark": "#6E1820",
    "redSoft": "#F4E7E8",
    "gold": "#EAA816",
    "goldSoft": "#FDF4E1",
    "navy": "#0B2536",
    "navySoft": "#123449",
    "ink": "#12202B",
    "muted": "#5C6B76",
    "line": "#E4DFD7",
    "bg": "#F7F4EF",
    "ok": "#1E7A4B"
  },
  "hero": {
    "eyebrow": "Visitor & Delegate Registration",
    "title": "Register to visit KICC",
    "subtitle": "Complete the short form to secure your visitor pass. Your registration number and QR badge are issued instantly — show them at the accreditation desk on arrival.",
    "chips": [
      "KICC, Nairobi · Harambee Avenue",
      "Free delegate registration",
      "QR badge issued instantly"
    ]
  },
  "features": {
    "duplicateEmailBlock": true,
    "emailConfirmation": true,
    "qrBadge": true,
    "doorCheckIn": true,
    "tidcSync": false,
    "requireIdNumber": false,
    "rateLimitPerHour": 12
  },
  "registration": {
    "open": true,
    "closedMessage": "Registration for this event is currently closed. Please contact the KICC events desk.",
    "idPrefix": "KICC",
    "consentText": "I consent to KICC processing the details above for event accreditation, security clearance and attendance records, in line with the Kenya Data Protection Act, 2019.",
    "privacyUrl": "/privacy.html",
    "categories": [
      "Delegate",
      "Speaker / Panellist",
      "VIP Guest",
      "Exhibitor",
      "Media / Press",
      "Student",
      "Service Provider",
      "Government Official"
    ],
    "dayOptions": [
      "All days",
      "Day 1 only",
      "Day 2 only",
      "Day 3 only"
    ],
    "countries": [
      "Kenya",
      "Uganda",
      "Tanzania",
      "Rwanda",
      "Burundi",
      "South Sudan",
      "Ethiopia",
      "Somalia",
      "South Africa",
      "Nigeria",
      "Ghana",
      "Egypt",
      "United Kingdom",
      "United States",
      "United Arab Emirates",
      "India",
      "China",
      "Germany",
      "France",
      "Netherlands",
      "Canada",
      "Australia",
      "Japan",
      "Brazil",
      "Other"
    ]
  },
  "checkin": {
    "gates": [
      "Main Entrance",
      "Tsavo Ballroom",
      "Lenana Hall",
      "Aberdare Hall",
      "VIP Lounge",
      "Media Centre"
    ]
  },
  "integrations": {
    "tidc": {
      "enabled": false,
      "verified": false
    }
  }
};
