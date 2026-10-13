-- AUTO-GENERATED from config/event.config.json — re-run `npm run build` after editing it.
-- Upsert, so re-applying never wipes registrations.

INSERT INTO events (id, name, dates, start_date, end_date, venue, description, active, sort_order)
VALUES
  ('kicc-visitors-open', 'General KICC Visitor Registration', 'Open daily', '2026-10-12', '2027-12-31', 'KICC Main Reception', 'Standing registration for members of the public and business visitors touring the KICC precinct.', 1, 1),
  ('biz-invest-expo-2026', 'KICC Business & Investment Expo 2026', '18 – 20 November 2026', '2026-11-18', '2026-11-20', 'Tsavo Ballroom', 'Three days of trade exhibitions, investor roundtables and B2B matchmaking.', 1, 2),
  ('ea-tourism-forum-2026', 'East Africa Tourism & Hospitality Forum', '3 – 4 December 2026', '2026-12-03', '2026-12-04', 'Lenana Hall', 'Regional tourism boards, hotel groups and travel operators.', 1, 3),
  ('nairobi-tech-summit-2027', 'Nairobi Tech & Innovation Summit', '21 January 2027', '2027-01-21', '2027-01-21', 'Aberdare Hall', 'Startups, investors and policy makers across East Africa''s technology sector.', 1, 4),
  ('agri-business-conf-2027', 'Kenya Agri-Business Conference', '12 – 13 February 2027', '2027-02-12', '2027-02-13', 'Tsavo Ballroom', 'Value-chain finance, agritech and export readiness.', 1, 5),
  ('health-medtech-congress-2027', 'Continental Health & MedTech Congress', '9 – 11 March 2027', '2027-03-09', '2027-03-11', 'Mount Kenya Hall', 'Public health agencies, hospital groups and medical device manufacturers.', 1, 6)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  dates = VALUES(dates),
  start_date = VALUES(start_date),
  end_date = VALUES(end_date),
  venue = VALUES(venue),
  description = VALUES(description),
  sort_order = VALUES(sort_order);
