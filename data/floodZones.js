/**
 * floodZones.js — Bengaluru waterlogging-prone zones.
 *
 * A small hardcoded dataset that adds a hyperlocal travel-risk layer to
 * the generated plan, without requiring a full GIS/municipal dataset
 * integration for this hackathon build. Documented as a deliberate scope
 * decision — see README → Assumptions.
 */
const FLOOD_PRONE_ZONES = [
  { name: 'Silk Board Junction', risk: 'high' },
  { name: 'Bellandur', risk: 'high' },
  { name: 'KR Puram', risk: 'high' },
  { name: 'Yelahanka', risk: 'medium' },
  { name: 'Koramangala 80 Feet Road', risk: 'medium' },
  { name: 'Hebbal Underpass', risk: 'high' },
];

module.exports = FLOOD_PRONE_ZONES;
